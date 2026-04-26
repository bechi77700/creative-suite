import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES, STATIC_PRODUCT_RULE } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';
import { buildConceptInstruction, type SelectedConcept } from '@/lib/static-ad-concepts';

export const maxDuration = 300;

const NANOBANANA_FORMAT = `NANOBANANA PROMPT FORMAT — use exactly this structure for every prompt:
[Subject / Action]
+ [Art Style / Medium]
+ [Lighting / Atmosphere]
+ [Camera / Angle]
+ [Composition & Layout Details]
+ [Brand Color Instructions — use brand colors from project documents]
+ [Product Representation — write ONLY: "use the uploaded product photo as the strict visual reference for the product — reproduce it exactly as shown, do NOT reinterpret, restyle, or redesign it." NEVER add a description of the product (no material, color of the product, parts, components, or descriptive adjectives). You MAY append a short positioning/lighting/scale instruction (e.g. "centered, slightly tilted toward camera, soft top-left light") if it does not describe the product itself.]
+ [Specific Text: "Exact headline or claim" in "Font style description"]
+ [Clarity & Legibility Constraints]
--ar [Aspect Ratio — choose freely: 1:1 / 4:5 / 9:16 — pick what best serves the format]`;

// Helper to send an SSE event
function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      product,
      count,
      mode,
      angle,
      additionalContext,
      imageBase64,
      imageMimeType,
      competitorImages,
      concept,
    } = body as {
      projectId: string;
      product: string;
      count: number | string;
      mode: 'clone' | 'scratch';
      angle?: string;
      additionalContext?: string;
      imageBase64?: string;
      imageMimeType?: string;
      competitorImages?: Array<{ base64: string; mimeType?: string }>;
      concept?: SelectedConcept | null;
    };

    // Normalize competitor screenshots: new array shape + legacy single fields
    const competitorRefs: Array<{ base64: string; mimeType: string }> = [];
    if (Array.isArray(competitorImages)) {
      for (const r of competitorImages) {
        if (r?.base64) competitorRefs.push({ base64: r.base64, mimeType: r.mimeType || 'image/jpeg' });
      }
    }
    if (imageBase64) {
      competitorRefs.push({ base64: imageBase64, mimeType: imageMimeType || 'image/jpeg' });
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
    if (!project.documents.some((d) => d.type === 'saint_graal_doc')) {
      return new Response(
        JSON.stringify({ error: 'Saint Graal document required before generating.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const brandContext = buildBrandDocumentsBlock(project.documents);
    const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, 'static');
    const n = Math.max(1, parseInt(count) || 1);

    const diversityRule = n > 1 ? `
MANDATORY DIVERSITY RULES — batch of ${n} prompts:
- Every prompt MUST use a completely different visual format and composition
- Vary freely: dark vs light, text-heavy vs image-hero, split vs full-bleed, minimal vs layered
- Examples of different formats: before/after split, mechanism diagram, bold text statement, testimonial card, product hero with claim, comparison grid, quote overlay, lifestyle scene, infographic strip
- Never repeat the same composition structure in the same batch
- If angle is the same across all, the FORMAT must make each one feel like a different ad` : '';

    // ── Build the prompt for the chosen mode ──
    // Split into stablePrefix (cacheable: rules + KB + brand docs + project name)
    // and variableSuffix (per-call: product/angle/count/task).
    const stablePrefix = `${GENERATION_RULES}

${NANOBANANA_FORMAT}
${STATIC_PRODUCT_RULE}

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none uploaded yet)'}

BRAND DOCUMENTS:
${brandContext || '(none uploaded yet)'}`;

    let variableSuffix: string;

    if (mode === 'clone') {
      if (competitorRefs.length === 0) {
        return new Response(JSON.stringify({ error: 'At least one competitor ad screenshot is required for Clone & Adapt mode' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const screenshotDescriptor = competitorRefs.length === 1
        ? 'a competitor ad screenshot'
        : `${competitorRefs.length} competitor ad screenshots`;

      variableSuffix = `You are the world's best creative strategist for Meta Ads. You have been given ${screenshotDescriptor}.${competitorRefs.length > 1 ? ' Audit each one separately, then synthesize the strongest patterns shared across them when generating prompts.' : ''}

PRODUCT: ${product}
${additionalContext ? `OPTIONAL INSTRUCTIONS FROM USER: ${additionalContext}` : ''}
${diversityRule}

─────────────────────────────────────────────
TASK
─────────────────────────────────────────────
Step 1: Perform a DEEP AUDIT of the competitor ad${competitorRefs.length > 1 ? 's (one audit per screenshot, then a short synthesis)' : ' in the image'}.
Step 2: Generate ${n} Nanobanana prompt${n > 1 ? 's' : ''} that reproduce the winning FORMAT and STRUCTURE of that ad — but 100% adapted to the brand above.

CORE RULE: The clone is about FORMAT only.
- Preserve: visual structure, composition type, hierarchy, psychological mechanics
- Swap: brand colors (from brand documents), product visual, copy voice, headlines
- Never reinvent what works structurally

─────────────────────────────────────────────
OUTPUT — use exactly this structure, nothing else:
─────────────────────────────────────────────

## COMPETITOR AD AUDIT

**Visual Hierarchy:** [what the eye sees first → second → third → last. Describe the exact flow.]
**Design Elements:** [color palette, font weight/style, image treatment, contrast level, whitespace]
**Copy Breakdown:** [extract every visible text element. Label each as: Hook / Promise / CTA / Social Proof / etc.]
**Psychological Angle:** [identify the core mechanism: pain relief / fear / urgency / status / curiosity / ease / authority / transformation]
**Why It Works:** [2-3 sentences. What makes this structure effective for cold traffic? What does the viewer feel?]

---
${Array.from({ length: n }, (_, i) => `
## PROMPT ${i + 1}

**Format:** [name of the visual format — e.g. "Before/After Split" / "Bold Statement" / "Product Hero + Claim"]

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

**Rationale:** [one sentence — what from the competitor structure this preserves and why]
`).join('\n')}`;
    } else {
      const angleInstruction = angle?.trim()
        ? `MARKETING ANGLE: "${angle}" — all ${n} prompts must be on this angle, each with a completely different visual format.`
        : `MARKETING ANGLE: Not specified — you choose the most powerful angle(s) based on the brand knowledge and product. If generating multiple prompts, you may vary angles to find the strongest.`;

      // Concept selection (scratch mode only). When a family is locked,
      // it becomes the spine of the batch — overrides the diversity rule
      // because the concept itself dictates the format.
      const conceptBlock = buildConceptInstruction(concept);

      variableSuffix = `You are the world's best creative strategist for Meta Ads cold traffic on the US market.

PRODUCT: ${product}
${angleInstruction}
${additionalContext ? `ADDITIONAL CONTEXT: ${additionalContext}` : ''}
${conceptBlock}
${conceptBlock ? '' : diversityRule}

─────────────────────────────────────────────
TASK
─────────────────────────────────────────────
Generate ${n} Nanobanana prompt${n > 1 ? 's' : ''} for Meta Ads cold traffic static ads.
For each prompt, you choose the visual format, composition, mood, and structure freely — based on what you know converts on Meta Ads and what fits the brand.
${n > 1 ? `Each of the ${n} prompts must use a completely different visual format. No two prompts should look like the same type of ad.` : ''}

─────────────────────────────────────────────
OUTPUT — use exactly this structure, nothing else:
─────────────────────────────────────────────

${Array.from({ length: n }, (_, i) => `
## PROMPT ${i + 1}

**Format:** [name of the visual format — e.g. "Before/After Split" / "Bold Text Statement" / "Lifestyle Hero" / "Mechanism Diagram"]

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

**Rationale:** [one sentence — why this format for this angle and this market]
`).join('\n')}`;
    }

    const images = mode === 'clone'
      ? competitorRefs.map((r) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: r.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: r.base64,
          },
        }))
      : undefined;

    const messages: Anthropic.MessageParam[] = [{
      role: 'user',
      content: buildCachedUserContent(stablePrefix, variableSuffix, images),
    }];

    const maxTokens = mode === 'clone' ? 4000 + n * 500 : 2500 + n * 500;
    const anthropic = getAnthropic();

    // Build the SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: maxTokens,
            messages,
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

          // Save full output to DB after stream completes
          const generation = await prisma.generation.create({
            data: {
              projectId,
              module: 'static',
              inputs: JSON.stringify({ product, count: n, mode, angle: angle || null, additionalContext, concept: concept || null }),
              output: fullText,
            },
          });

          controller.enqueue(encoder.encode(sse('done', { generationId: generation.id })));
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[static-brief stream] ERROR:', message);
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
    console.error('[static-brief] ERROR:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
