import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import type { VideoAnalysis } from '@/lib/gemini-video';

export const maxDuration = 300;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Same renderer as iterate-video — keeps the Gemini analysis compact for the
// Claude prompt while preserving the parts that drive the SOP (verbatim VO,
// shots, axes tagging).
function renderAnalysis(a: VideoAnalysis): string {
  const shots = (a.shots || [])
    .map((s, i) => `  ${i + 1}. [${s.t}] ${s.type} · ${s.camera} · ${s.subject}${s.vo ? ` — VO: "${s.vo}"` : ''}${s.onScreen ? ` — text: "${s.onScreen}"` : ''}`)
    .join('\n');
  const onScreen = (a.onScreenTextTimeline || [])
    .map((o) => `  ${o.t}: "${o.text}"`).join('\n');
  const axesLines = Object.entries(a.axes || {})
    .map(([k, v]) => `  - ${k}: ${v}`).join('\n');

  return `STRUCTURED VIDEO ANALYSIS (auto-extracted by Gemini from the reference video):

Duration: ${a.duration}s
Format: ${a.format}

HOOK (${a.hook.timing}):
  Visual: ${a.hook.visual}
  Audio: ${a.hook.audio}
  On-screen: ${a.hook.onScreen}
  Stop-scroll mechanism: ${a.hook.stopScrollMechanism}

SHOTS:
${shots || '  (none extracted)'}

VOICE-OVER (verbatim, full):
${a.voiceOverFull}

ON-SCREEN TEXT TIMELINE:
${onScreen || '  (none)'}

PACING: ${a.pacing}
MUSIC: ${a.music}
PSYCHOLOGICAL ANGLE: ${a.psychologicalAngle}
NARRATIVE STRUCTURE: ${a.narrativeStructure}
CTA (${a.cta.timing} · ${a.cta.type}): "${a.cta.text}"

REFERENCE AXES TAGGING:
${axesLines}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      videoAnalysis,
      additionalContext = '',
      count,
    }: {
      projectId: string;
      videoAnalysis: VideoAnalysis;
      additionalContext?: string;
      count?: number;
    } = body;

    if (!videoAnalysis) {
      return new Response(JSON.stringify({ error: 'A video analysis is required (upload a reference video first).' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
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
    const n = Math.max(1, Math.min(10, count || 3));

    const additionalBlock = additionalContext.trim()
      ? `\nADDITIONAL CONTEXT FROM USER (apply as a high-priority constraint):\n${additionalContext.trim()}`
      : '';

    const promptText = `${GENERATION_RULES}

You are running the **Clone & Adapt** SOP for a Meta Ads VIDEO SCRIPT. Follow the SOP that lives in the brand's Knowledge Base ("clone-and-adapt-video-sop.md") — it defines the mandatory two-phase output (Structural Autopsy + Adapted Scripts), the ±10% word-count rule, the same-blocks-same-order rule, the Copy DNA preservation, and the no-fabrication-of-brand-facts rule.

The reference is from a DIFFERENT vertical / different product than the user's brand — that's expected. We are NOT cloning the product. We are cloning the **mechanism that made the ad work**: structure, pacing, copy DNA, persuasive architecture.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}

─────────────────────────────────────────────
REFERENCE VIDEO
─────────────────────────────────────────────
${renderAnalysis(videoAnalysis)}

─────────────────────────────────────────────
GENERATION CONFIG
─────────────────────────────────────────────
Number of adapted scripts to produce: ${n}
Output language: English (US market)
${additionalBlock}

─────────────────────────────────────────────
HARD RULES (from the SOP — non-negotiable)
─────────────────────────────────────────────
- Same blocks, same order, same names as the reference (HOOK / LEAD / PROBLEM / PROOF / DEMO / TESTIMONY / OBJECTION / OFFER / CTA — pick those that actually fit).
- Same word counts per block (±10%).
- Same total length (±10%).
- Same Copy DNA: sentence length, tone, tense, person, rhetorical devices.
- Same hook MECHANISM, not the same hook content (curiosity gap → curiosity gap, never curiosity gap → question).
- Pull product specifics from the brand's Saint Graal / project documents only. NEVER invent claims, prices, ingredients, results, or guarantees.
- Translate vertical-specific elements 1:1 (e.g. reference: "my skin texture changed" → adapted for haircare: "my hair density changed"). The function survives; only the noun shifts.
- Tag every block with the same labels in both phases.
- Aggressive US direct response — no softening, no hedging.
- Pure spoken words and on-screen text only — no camera directions inside script blocks.

─────────────────────────────────────────────
OUTPUT FORMAT — exact, mandatory
─────────────────────────────────────────────
Start the response IMMEDIATELY with "## Phase 1 — Autopsy". No preamble, no "Here's the analysis…" filler.

## Phase 1 — Autopsy

(Hard cap: 250 words for the entire autopsy. Operational only — no marketing fluff.)

#### Why It Works
(3 to 5 bullets. Each bullet names a specific persuasive mechanism with the timestamp where it fires.)

#### Skeleton
(Numbered list of every script block in the reference, in order, with: block name, timestamp range, word count, function — one short sentence.)

#### Copy DNA
(3 to 6 bullets: avg sentence length, tone, tense, person, devices used, vocabulary register.)

#### Verbatim Transcript
(The full voice-over, word for word, with structural tags inline like [HOOK], [LEAD], [PROOF], [OFFER], [CTA].)

## Phase 2 — Adapted Scripts

Then output exactly ${n} adapted scripts, each as a structural twin of the reference. Use this exact format:

${Array.from({ length: n }, (_, i) => `
### Script ${i + 1} — <one-line angle description, max 12 words>
**Total:** ~<seconds>s · ~<words> words

[HOOK · <timestamp> · <wordcount> words]
<text>

[LEAD · <timestamp> · <wordcount> words]
<text>

[<NEXT BLOCK> · <timestamp> · <wordcount> words]
<text>

(...continue with every block from the reference's skeleton, in the same order...)

[CTA · <timestamp> · <wordcount> words]
<text>
`).join('\n')}

Repeat for every script ${n > 1 ? `(Script 1 through Script ${n})` : ''}, keeping the skeleton frozen and varying only the angle / opening line / proof point.`;

    const anthropic = getAnthropic();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        let fullText = '';
        try {
          const messageStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 4000 + n * 1000,
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
              module: 'clone-and-adapt-video',
              inputs: JSON.stringify({
                referenceFormat: videoAnalysis.format,
                referenceDuration: videoAnalysis.duration,
                additionalContext,
                count: n,
              }),
              output: fullText,
            },
          });

          controller.enqueue(encoder.encode(sse('done', { generationId: generation.id })));
          controller.close();
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error('[clone-and-adapt-video stream] ERROR:', message);
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
    console.error('[clone-and-adapt-video] ERROR:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
