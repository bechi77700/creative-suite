import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import type { VideoAnalysis } from '@/lib/gemini-video';

export const maxDuration = 300;

// 10-axis catalog — MUST stay in sync with iterate-video-sop.md and the
// VideoIteratePanel.tsx ITERATE_VIDEO_AXES list.
const AXIS_CATALOG = [
  'Format', 'Concept', 'Angle', 'Message', 'Hook', 'Body',
  'Montage vidéo', 'Awareness', 'Acteur', 'Lieu',
] as const;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Render the structured analysis as a compact text block we can paste into
// the Claude prompt. Keeps token usage reasonable while preserving the parts
// that matter for sibling generation (axes tags + structure + verbatim VO).
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

CURRENT AXES TAGGING (the values below define the WINNING DNA — preserve every axis you don't explicitly vary):
${axesLines}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      originalScript,
      videoAnalysis = null,
      axes = [],
      otherInstructions = '',
      count,
    }: {
      projectId: string;
      originalScript: string;
      videoAnalysis?: VideoAnalysis | null;
      axes?: string[];
      otherInstructions?: string;
      count?: number;
    } = body;

    // Either a pasted script OR a video analysis is required.
    const hasScript = !!originalScript?.trim();
    const hasVideo = !!videoAnalysis;
    if (!hasScript && !hasVideo) {
      return new Response(JSON.stringify({ error: 'Provide a reference script or upload a video.' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // Validate axes against the catalog.
    const validAxes = (axes || []).filter((a): a is typeof AXIS_CATALOG[number] =>
      (AXIS_CATALOG as readonly string[]).includes(a),
    );
    if (validAxes.length > 2) {
      return new Response(JSON.stringify({ error: 'Max 2 axes per generation.' }), {
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
    const n = Math.max(1, Math.min(20, count || 4));

    // Mode: Auto vs User-directed (per SOP)
    const isAuto = validAxes.length === 0;
    const modeBlock = isAuto
      ? `MODE: **AUTO** — The user has NOT specified which axes to vary. You must pick a useful spread across siblings. Each sibling varies 1 to 2 axes from the catalog (no more), and the spread across the ${n} siblings should cover meaningfully different axis combinations (don't pick the same axis for all siblings).`
      : `MODE: **USER-DIRECTED** — The user has explicitly chosen the axes to vary: **${validAxes.join(' + ')}**. Every sibling MUST vary ONLY these axes — never any others. Every other axis stays identical to the reference's tagging.`;

    const referenceBlock = hasVideo
      ? renderAnalysis(videoAnalysis!)
      : `REFERENCE WINNING SCRIPT (verbatim):

${originalScript.trim()}`;

    const otherBlock = otherInstructions.trim()
      ? `\nADDITIONAL CUSTOM INSTRUCTIONS FROM USER (apply as a high-priority constraint — if the user opens the door to new claims, use the inline tag [NEW CLAIM] on each new factual claim you add):\n${otherInstructions.trim()}`
      : '';

    const promptText = `${GENERATION_RULES}

You are running the **Iterate Video** SOP for a Meta Ads VIDEO SCRIPT that has ALREADY been validated as a winner. Follow the SOP that lives in the brand's Knowledge Base ("iterate-video-sop.md") — it defines the 10-axis closed catalog, Auto vs User-directed mode, the 1-2 axes-per-sibling rule, and the required output format.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}

─────────────────────────────────────────────
REFERENCE
─────────────────────────────────────────────
${referenceBlock}

─────────────────────────────────────────────
ITERATION CONFIG
─────────────────────────────────────────────
${modeBlock}
Number of siblings to generate: ${n}
${otherBlock}

─────────────────────────────────────────────
HARD RULES (from the SOP)
─────────────────────────────────────────────
- Closed catalog of axes (no inventions): ${AXIS_CATALOG.join(' · ')}.
- Each sibling varies 1 OR 2 axes — never more.
- Every axis NOT in the varied list must remain identical to the reference's tagging.
- Each sibling must clearly differ from the others (different axis combos when in Auto mode; different angles within the same axes when in User-directed mode).
- Aggressive US direct response — no softening, no hedging.
- Pure spoken words and on-screen text only — NO camera directions, NO "[cut to]", NO editor instructions inside the script blocks.
- No new factual claims unless the user's custom instructions explicitly opened that door — and even then, tag them inline with [NEW CLAIM].
- Pull all brand specifics (price, ingredients, results, guarantees) from the brand's Saint Graal / project documents only.

─────────────────────────────────────────────
OUTPUT FORMAT — exact, mandatory
─────────────────────────────────────────────
Start the response with a one-line **Winner Autopsy** of max 200 words:

## Winner Autopsy
- **Why it works:** 2-3 bullets, each pointing at a concrete persuasive mechanism with timestamps.
- **Current axes tagging:** one-line summary of the reference's tagging across the 10 axes.

Then output exactly ${n} siblings, each in this exact form (the "## Sibling N" headings are MANDATORY and must be on their own line):

${Array.from({ length: n }, (_, i) => `
## Sibling ${i + 1} — Varied axes: <axis 1>[, <axis 2>]

**Hypothesis:** <one short sentence — why this variation should test well>

### HOOK
<spoken words for the first 2-3 seconds>

### BODY
<the full body of the script, tagged blocks if useful (LEAD / PROOF / DEMO / OBJECTION / OFFER) inside>

### CTA
<the closing call to action — spoken or on-screen>

**What changed vs reference:** <one sentence specifying the modification on each varied axis>
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
              inputs: JSON.stringify({
                originalScript,
                hasVideoAnalysis: hasVideo,
                axes: validAxes,
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
