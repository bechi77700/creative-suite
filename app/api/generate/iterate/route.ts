import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES, STATIC_PRODUCT_RULE } from '@/lib/anthropic';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';
import { buildCachedUserContent } from '@/lib/prompt-cache';

export const maxDuration = 300;

const NANOBANANA_FORMAT = `NANOBANANA PROMPT FORMAT — use exactly this structure for every prompt:
[Subject / Action]
+ [Art Style / Medium]
+ [Lighting / Atmosphere]
+ [Camera / Angle]
+ [Composition & Layout Details]
+ [Brand Color Instructions — use brand colors from project documents]
+ [Product Representation — write ONLY: "use the uploaded product photo as the strict visual reference for the product — reproduce it exactly as shown, do NOT reinterpret, restyle, or redesign it." NEVER add a description of the product (no material, color of the product, parts, components, or descriptive adjectives). You MAY append a short positioning/lighting/scale instruction if it does not describe the product itself.]
+ [Specific Text: "Exact headline or claim" in "Font style description"]
+ [Clarity & Legibility Constraints]
--ar [Aspect Ratio — choose freely: 1:1 / 4:5 / 9:16]`;

// Strategy → instruction text fed to Claude
const STRATEGY_INSTRUCTIONS: Record<string, string> = {
  'hook': 'HOOK VARIATION — Keep the visual format, composition, and structure identical. Generate completely new headlines/hooks that test different psychological triggers (urgency, curiosity, fear, status, transformation, etc.).',
  'format': 'FORMAT SWAP — Keep the message, headline, and angle exactly. Change the visual format and composition entirely (split-screen → product hero / before-after → mechanism diagram / etc.).',
  'angle': 'ANGLE PIVOT — Keep the visual structure and composition. Change the psychological angle: if original was pain-based, try desire-based. If logical, try emotional. If problem-aware, try solution-aware.',
  'social-proof': 'SOCIAL PROOF SWAP — Keep everything except the credibility element. Swap the proof type: number → expert endorsement → testimonial → media logo → user count → before-after photo proof.',
  'pain-promise': 'PAIN/PROMISE INTENSIFICATION — Keep the structure and angle. Push the emotional lever HARDER. Make the pain more visceral, the promise more extreme, the urgency more immediate. No softening.',
  'demographic': 'DEMOGRAPHIC PIVOT — Keep the visual format and core message. Adapt the copy and visual cues to a different sub-segment of the target market (e.g. lipedema → post-pregnancy → menopause → desk job).',
  'cta': 'CTA / URGENCY VARIATION — Keep everything except the call-to-action and urgency mechanism. Test new CTAs (Buy 1 Get 1 / Free shipping today / Limited stock / Risk-free trial / etc.).',
};

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      originalPrompt = '',
      referenceImageBase64,
      referenceMimeType,
      referenceImages,
      strategies = [],
      otherInstructions = '',
      count,
    }: {
      projectId: string;
      originalPrompt?: string;
      referenceImageBase64?: string;
      referenceMimeType?: string;
      referenceImages?: Array<{ base64: string; mimeType?: string }>;
      strategies?: string[];
      otherInstructions?: string;
      count?: number;
    } = body;

    // Normalize all refs (new array shape + legacy single fields)
    const refs: Array<{ base64: string; mimeType: string }> = [];
    if (Array.isArray(referenceImages)) {
      for (const r of referenceImages) {
        if (r?.base64) refs.push({ base64: r.base64, mimeType: r.mimeType || 'image/jpeg' });
      }
    }
    if (referenceImageBase64) {
      refs.push({ base64: referenceImageBase64, mimeType: referenceMimeType || 'image/jpeg' });
    }

    const hasPrompt = !!originalPrompt?.trim();
    const hasImage = refs.length > 0;
    if (!hasPrompt && !hasImage) {
      return new Response(JSON.stringify({ error: 'Provide a reference image, an original prompt, or both.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (strategies.length === 0 && !otherInstructions.trim()) {
      return new Response(
        JSON.stringify({ error: 'Pick at least one strategy or write custom instructions' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const [project, globalKnowledge] = await Promise.all([
      prisma.brandProject.findUnique({ where: { id: projectId }, include: { documents: true } }),
      prisma.globalKnowledge.findMany(),
    ]);
    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const brandContext = buildBrandDocumentsBlock(project.documents);
    const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge);
    const n = Math.max(1, Math.min(20, count || 3));

    const strategyBlock = strategies
      .map((s) => STRATEGY_INSTRUCTIONS[s])
      .filter(Boolean)
      .map((line, i) => `${i + 1}. ${line}`)
      .join('\n');

    const otherBlock = otherInstructions.trim()
      ? `\nADDITIONAL CUSTOM ITERATION INSTRUCTIONS FROM USER (apply these as the most important constraint):\n${otherInstructions.trim()}`
      : '';

    const refImageDescriptor = refs.length === 1 ? 'a reference image' : `${refs.length} reference images`;
    const sourceBlock = hasPrompt && hasImage
      ? `─────────────────────────────────────────────
ORIGINAL WINNING PROMPT (do NOT change its core DNA — only iterate along the chosen axes)
─────────────────────────────────────────────
\`\`\`
${originalPrompt.trim()}
\`\`\`

${refImageDescriptor[0].toUpperCase() + refImageDescriptor.slice(1)} of the original winning creative ${refs.length === 1 ? 'is' : 'are'} also attached above. Use BOTH the prompt and the image${refs.length === 1 ? '' : 's'} as the source of truth for what's already working.`
      : hasPrompt
      ? `─────────────────────────────────────────────
ORIGINAL WINNING PROMPT (do NOT change its core DNA — only iterate along the chosen axes)
─────────────────────────────────────────────
\`\`\`
${originalPrompt.trim()}
\`\`\``
      : `─────────────────────────────────────────────
ORIGINAL WINNING CREATIVE (${refImageDescriptor} attached above — analyze ${refs.length === 1 ? 'it' : 'them'} carefully)
─────────────────────────────────────────────
The user did NOT provide a written prompt. Look at the attached reference image${refs.length === 1 ? '' : 's'} and treat ${refs.length === 1 ? 'it' : 'them'} as the winning creative${refs.length === 1 ? '' : 's'}. Identify visual structure, headline, hook, layout, color treatment, and psychological angle. Each iteration must keep the winning DNA visible in ${refs.length === 1 ? 'this image' : 'these images'}.`;

    const stablePrefix = `${GENERATION_RULES}

You are iterating on a Meta Ads static creative that has ALREADY been validated as a winner.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}

${NANOBANANA_FORMAT}
${STATIC_PRODUCT_RULE}`;

    const variableSuffix = `${sourceBlock}

─────────────────────────────────────────────
ITERATION STRATEGIES TO APPLY
─────────────────────────────────────────────
${strategyBlock || '(none — use only the custom instructions below)'}
${otherBlock}

─────────────────────────────────────────────
CORE RULES
─────────────────────────────────────────────
- Each iteration must keep what already works (the "winning DNA"). Only vary along the requested axes.
- Iterations should feel like SIBLINGS of the original, not unrelated new ads.
- Each iteration must clearly differ from the others on the chosen axis.
- ${n} iterations total.

─────────────────────────────────────────────
OUTPUT — use exactly this structure, nothing else:
─────────────────────────────────────────────

${Array.from({ length: n }, (_, i) => `
## ITERATION ${i + 1}

**Iterates on:** [name the axis(es) varied — e.g. "Hook variation: urgency angle" / "Format swap: now a comparison grid"]

\`\`\`
[Subject / Action]
+ [Art Style / Medium]
+ [Lighting / Atmosphere]
+ [Camera / Angle]
+ [Composition & Layout Details]
+ [Brand Color Instructions]
+ [Product Representation — exactly: "use the uploaded product photo as the strict visual reference for the product — reproduce it exactly as shown, do NOT reinterpret, restyle, or redesign it." Optionally followed by a positioning/lighting/scale instruction. NEVER describe the product itself.]
+ [Specific Text: "Exact headline" in "Font style"]
+ [Clarity & Legibility Constraints]
--ar [ratio]
\`\`\`

**What changed vs original:** [one sentence — what specifically you modified and why this should test well]
`).join('\n')}`;

    const anthropic = getAnthropic();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          const images = refs.map((ref) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: ref.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              data: ref.base64,
            },
          }));

          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 2500 + n * 500,
            messages: [{
              role: 'user',
              content: buildCachedUserContent(stablePrefix, variableSuffix, images),
            }],
          });

          for await (const chunk of messageStream) {
            if (
              chunk.type === 'content_block_delta' &&
              chunk.delta.type === 'text_delta'
            ) {
              const text = chunk.delta.text;
              fullText += text;
              controller.enqueue(encoder.encode(sse('text', { text })));
            }
          }

          const generation = await prisma.generation.create({
            data: {
              projectId,
              module: 'iterate',
              inputs: JSON.stringify({
                originalPrompt,
                referenceImageCount: refs.length,
                strategies,
                otherInstructions,
                count: n,
              }),
              output: fullText,
            },
          });

          controller.enqueue(encoder.encode(sse('done', { generationId: generation.id })));
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[iterate stream] ERROR:', message);
          controller.enqueue(encoder.encode(sse('error', { error: message })));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[iterate] ERROR:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
