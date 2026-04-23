import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';

export const maxDuration = 300;

// Strategy → instruction text fed to Claude (video-script flavored)
const STRATEGY_INSTRUCTIONS: Record<string, string> = {
  'hook': 'HOOK VARIATION — Keep the body and CTA exactly the same. Generate completely new opening hooks (first 2-3 seconds) that test different psychological triggers (urgency, curiosity, fear, status, transformation, callout, pattern interrupt, etc.).',
  'angle': 'ANGLE PIVOT — Keep the same structure (hook → body → CTA) and length. Change the psychological angle: pain-based ↔ desire-based, logical ↔ emotional, problem-aware ↔ solution-aware.',
  'pain-promise': 'PAIN/PROMISE INTENSIFICATION — Keep the structure and angle. Push the emotional lever HARDER. Make the pain more visceral, the promise more extreme, the urgency more immediate. No softening.',
  'demographic': 'DEMOGRAPHIC PIVOT — Keep the structure and core message. Adapt the language, references, and pain points to a different sub-segment of the target market.',
  'cta': 'CTA / URGENCY VARIATION — Keep the hook and body. Test new CTAs / urgency mechanisms (Buy 1 Get 1 / free shipping today / limited stock / risk-free trial / scarcity / countdown / social proof close / etc.).',
  'length': 'LENGTH ADJUSTMENT — Keep the message and angle. Produce a notably tighter, punchier version (every word earns its place) — or, if the original is short, a longer version that builds more belief.',
  'tone': 'TONE SHIFT — Keep the structure. Change the voice (educational → confrontational / friendly → urgent / authoritative → peer-to-peer / informative → entertaining).',
  'format': 'FORMAT SWAP — Keep the message. Change the script format entirely (talking-head testimonial → POV unboxing → before/after split / reaction / story-time / problem-solution demo / etc.).',
};

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      originalScript,
      strategies = [],
      otherInstructions = '',
      count,
    }: {
      projectId: string;
      originalScript: string;
      strategies?: string[];
      otherInstructions?: string;
      count?: number;
    } = body;

    if (!originalScript?.trim()) {
      return new Response(JSON.stringify({ error: 'Original script is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
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
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const brandContext = project.documents.map((d) => `[${d.type.toUpperCase()} — ${d.name}]`).join('\n');
    const knowledgeContext = globalKnowledge.map((k) => `[${k.category.toUpperCase()} — ${k.name}]`).join('\n');
    const n = Math.max(1, Math.min(20, count || 3));

    const strategyBlock = strategies
      .map((s) => STRATEGY_INSTRUCTIONS[s])
      .filter(Boolean)
      .map((line, i) => `${i + 1}. ${line}`)
      .join('\n');

    const otherBlock = otherInstructions.trim()
      ? `\nADDITIONAL CUSTOM ITERATION INSTRUCTIONS FROM USER (apply these as the most important constraint):\n${otherInstructions.trim()}`
      : '';

    const promptText = `${GENERATION_RULES}

You are iterating on a Meta Ads VIDEO SCRIPT that has ALREADY been validated as a winner.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}

─────────────────────────────────────────────
ORIGINAL WINNING SCRIPT (do NOT change its core DNA — only iterate along the chosen axes)
─────────────────────────────────────────────
${originalScript.trim()}

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
- NO editor instructions, no camera directions, no "[cut to]" — pure spoken words and on-screen text only.
- Aggressive US direct response — pain points pushed hard.
- ${n} iterations total.

─────────────────────────────────────────────
OUTPUT — use exactly this structure, nothing else (the "## ITERATION N" headings are MANDATORY and must be on their own line):
─────────────────────────────────────────────

${Array.from({ length: n }, (_, i) => `
## ITERATION ${i + 1}

**Iterates on:** [name the axis(es) varied — one short line]

### HOOK
[spoken words for the first 2-3 seconds — the pattern interrupt]

### BODY
[the full body of the script]

### CTA
[the closing call to action]

**What changed vs original:** [one sentence — what specifically you modified and why this should test well]
`).join('\n---\n')}`;

    const anthropic = getAnthropic();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 3000 + n * 800,
            messages: [{ role: 'user', content: promptText }],
          });

          for await (const chunk of messageStream) {
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              const text = chunk.delta.text;
              fullText += text;
              controller.enqueue(encoder.encode(sse('text', { text })));
            }
          }

          const generation = await prisma.generation.create({
            data: {
              projectId,
              module: 'iterate-video',
              inputs: JSON.stringify({ originalScript, strategies, otherInstructions, count: n }),
              output: fullText,
            },
          });

          controller.enqueue(encoder.encode(sse('done', { generationId: generation.id })));
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[iterate-video stream] ERROR:', message);
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
    console.error('[iterate-video] ERROR:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
