import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';

const NANOBANANA_FORMAT = `NANOBANANA PROMPT FORMAT — use exactly this structure for every prompt:
[Subject / Action]
+ [Art Style / Medium]
+ [Lighting / Atmosphere]
+ [Camera / Angle]
+ [Composition & Layout Details]
+ [Brand Color Instructions — use brand colors from project documents]
+ [Product Representation — always write: "use uploaded product photo as visual reference"]
+ [Specific Text: "Exact headline or claim" in "Font style description"]
+ [Clarity & Legibility Constraints]
--ar [Aspect Ratio — choose freely: 1:1 / 4:5 / 9:16 — pick what best serves the format]`;

function buildKnowledgeContext(globalKnowledge: { category: string; name: string }[]) {
  const staticAds = globalKnowledge.filter((k) => k.category === 'static_ads');
  const rest = globalKnowledge.filter((k) => k.category !== 'static_ads');
  return [
    ...staticAds.map((k) => `[STATIC ADS REFERENCE — ${k.name}]`),
    ...rest.map((k) => `[${k.category.toUpperCase()} — ${k.name}]`),
  ].join('\n');
}

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const { projectId, product, count, mode, angle, additionalContext, imageBase64, imageMimeType } = body;

  const [project, globalKnowledge] = await Promise.all([
    prisma.brandProject.findUnique({ where: { id: projectId }, include: { documents: true } }),
    prisma.globalKnowledge.findMany(),
  ]);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!project.documents.some((d) => d.type === 'saint_graal_doc')) {
    return NextResponse.json({ error: 'Saint Graal document required before generating.' }, { status: 403 });
  }

  const brandContext = project.documents.map((d) => `[${d.type.toUpperCase()} — ${d.name}]`).join('\n');
  const knowledgeContext = buildKnowledgeContext(globalKnowledge);
  const n = Math.max(1, parseInt(count) || 1);

  const diversityRule = n > 1 ? `
MANDATORY DIVERSITY RULES — batch of ${n} prompts:
- Every prompt MUST use a completely different visual format and composition
- Vary freely: dark vs light, text-heavy vs image-hero, split vs full-bleed, minimal vs layered
- Examples of different formats: before/after split, mechanism diagram, bold text statement, testimonial card, product hero with claim, comparison grid, quote overlay, lifestyle scene, infographic strip
- Never repeat the same composition structure in the same batch
- If angle is the same across all, the FORMAT must make each one feel like a different ad` : '';

  let output: string;

  // ──────────────────────────────────────────────
  // MODE A — CLONE & ADAPT
  // ──────────────────────────────────────────────
  if (mode === 'clone') {
    if (!imageBase64 || !imageMimeType) {
      return NextResponse.json({ error: 'Image required for Clone & Adapt mode' }, { status: 400 });
    }

    const promptText = `${GENERATION_RULES}

You are the world's best creative strategist for Meta Ads. You have been given a competitor ad screenshot.

BRAND: ${project.name}
PRODUCT: ${product}
${additionalContext ? `OPTIONAL INSTRUCTIONS FROM USER: ${additionalContext}` : ''}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none uploaded yet)'}

BRAND DOCUMENTS:
${brandContext || '(none uploaded yet)'}

${NANOBANANA_FORMAT}
${diversityRule}

─────────────────────────────────────────────
TASK
─────────────────────────────────────────────
Step 1: Perform a DEEP AUDIT of the competitor ad in the image.
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
+ [Product Representation — use uploaded product photo as visual reference]
+ [Specific Text: "Exact headline" in "Font style"]
+ [Clarity & Legibility Constraints]
--ar [ratio]
\`\`\`

**Rationale:** [one sentence — what from the competitor structure this preserves and why]
`).join('\n')}`;

    const visionContent: Anthropic.MessageParam['content'] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: imageMimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: imageBase64,
        },
      },
      { type: 'text', text: promptText },
    ];

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 4000 + n * 500,
      messages: [{ role: 'user', content: visionContent }],
    });

    output = (response.content[0] as { type: string; text: string }).text;

  // ──────────────────────────────────────────────
  // MODE B — FROM SCRATCH
  // ──────────────────────────────────────────────
  } else {
    const angleInstruction = angle?.trim()
      ? `MARKETING ANGLE: "${angle}" — all ${n} prompts must be on this angle, each with a completely different visual format.`
      : `MARKETING ANGLE: Not specified — you choose the most powerful angle(s) based on the brand knowledge and product. If generating multiple prompts, you may vary angles to find the strongest.`;

    const scratchPrompt = `${GENERATION_RULES}

You are the world's best creative strategist for Meta Ads cold traffic on the US market.

BRAND: ${project.name}
PRODUCT: ${product}
${angleInstruction}
${additionalContext ? `ADDITIONAL CONTEXT: ${additionalContext}` : ''}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none uploaded yet)'}

BRAND DOCUMENTS:
${brandContext || '(none uploaded yet)'}

${NANOBANANA_FORMAT}
${diversityRule}

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
+ [Product Representation — use uploaded product photo as visual reference]
+ [Specific Text: "Exact headline" in "Font style"]
+ [Clarity & Legibility Constraints]
--ar [ratio]
\`\`\`

**Rationale:** [one sentence — why this format for this angle and this market]
`).join('\n')}`;

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 2500 + n * 500,
      messages: [{ role: 'user', content: scratchPrompt }],
    });

    output = (response.content[0] as { type: string; text: string }).text;
  }

  const generation = await prisma.generation.create({
    data: {
      projectId,
      module: 'static',
      inputs: JSON.stringify({ product, count: n, mode, angle: angle || null, additionalContext }),
      output,
    },
  });

  return NextResponse.json({ output, generationId: generation.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[static-brief] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
