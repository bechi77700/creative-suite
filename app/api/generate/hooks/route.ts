import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import type { VideoAnalysis } from '@/lib/gemini-video';

export const maxDuration = 300;

// Compact rendering of the Gemini analysis — only the parts that matter for
// hook cloning (first 2-3 seconds, on-screen text, hook mechanism, tone).
function renderAnalysisForHook(a: VideoAnalysis): string {
  const firstShots = (a.shots || [])
    .slice(0, 4)
    .map((s, i) => `  ${i + 1}. [${s.t}] ${s.type} · ${s.camera} · ${s.subject}${s.vo ? ` — VO: "${s.vo}"` : ''}${s.onScreen ? ` — text: "${s.onScreen}"` : ''}`)
    .join('\n');
  const onScreen = (a.onScreenTextTimeline || [])
    .slice(0, 4)
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

FIRST SHOTS (the hook window):
${firstShots || '  (none extracted)'}

OPENING ON-SCREEN TEXT:
${onScreen || '  (none)'}

PACING: ${a.pacing}
MUSIC: ${a.music}
PSYCHOLOGICAL ANGLE: ${a.psychologicalAngle}

REFERENCE AXES TAGGING:
${axesLines}`;
}

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, mode, script, instructions, videoAnalysis } = body as {
    projectId: string;
    mode: 'from_brand' | 'from_script' | 'from_video';
    script?: string;
    instructions?: string;
    videoAnalysis?: VideoAnalysis | null;
  };
  // Clamp count to a sane range; default to 6 (matches new UI default).
  const requestedCount = Number(body.count);
  const count = Number.isFinite(requestedCount)
    ? Math.min(48, Math.max(1, Math.round(requestedCount)))
    : 6;

  if (mode === 'from_video' && !videoAnalysis) {
    return NextResponse.json(
      { error: 'A reference video analysis is required for "From Reference Video" mode.' },
      { status: 400 },
    );
  }

  const project = await prisma.brandProject.findUnique({
    where: { id: projectId },
    include: { documents: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!project.documents.some((d) => d.type === 'saint_graal_doc')) {
    return NextResponse.json({ error: 'Saint Graal document required before generating.' }, { status: 403 });
  }

  const globalKnowledge = await prisma.globalKnowledge.findMany();
  const brandContext = project.documents.map((d) => `[${d.type.toUpperCase()} — ${d.name}]`).join('\n');
  const knowledgeContext = globalKnowledge.map((k) => `[${k.category.toUpperCase()} — ${k.name}]`).join('\n');

  const instructionsSection = instructions?.trim()
    ? `\nUSER INSTRUCTIONS (mandatory — apply these to the generation):\n${instructions}`
    : '';

  // ---------- branch: clone hook from reference video ----------
  if (mode === 'from_video' && videoAnalysis) {
    const promptText = `${GENERATION_RULES}

You are running the **Clone Hook from Video** SOP for Meta Ads (lives in the brand's Knowledge Base as "clone-hook-from-video-sop.md"). The user uploaded a reference hook video — either their own winner or a competitor's ad — and wants ${count} hook${count !== 1 ? 's' : ''} that clone the **mechanism** and adapt the **content** to their brand.

Core principle: clone the mechanism (the WHY it stops the scroll), adapt the content (product, noun, claim) to the brand. Mechanism is sacred — never swap to a different one mid-batch.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}

─────────────────────────────────────────────
REFERENCE HOOK VIDEO
─────────────────────────────────────────────
${renderAnalysisForHook(videoAnalysis)}
${instructionsSection}

─────────────────────────────────────────────
CLOSED CATALOG OF HOOK MECHANISMS — pick ONE, never invent
─────────────────────────────────────────────
- curiosity gap — declare a result without explaining it
- contrarian statement — say the opposite of what people expect
- stat shock — open on a hard number
- stranger-stop — direct call-out + camera lock
- problem amplification — push the pain to its worst version in 2 seconds
- declarative claim — flat assertion of an outcome
- reaction shot opener — face reacting to something off-camera before any words
- before-state shock — show the worst version of the before, no context
- qualifier callout — narrow the audience hard
- question-bait — open on a question the viewer needs the answer to
- visual-first cold open — pure image, 1-2 seconds of silence, intrigue first

─────────────────────────────────────────────
HARD RULES (non-negotiable)
─────────────────────────────────────────────
1. Mechanism is sacred. Identify the reference's mechanism, then ALL ${count} generated hooks use that SAME mechanism. No mixing.
2. Vary the *content*, not the *form*. Same number of words ±20%. Same shot type. Same tone (intimate / authoritative / peer / urgent — match the reference).
3. Translate vertical-specific elements 1:1. Reference noun → brand-equivalent noun. Function survives, noun shifts.
4. No invented brand facts. Pull product specifics from the brand's Saint Graal / docs only. If the reference uses a number/claim that doesn't map to the brand, use a structurally equivalent claim from the Saint Graal OR write around the absence with a generic verb / structural placeholder.
5. Visual MUST be specified for every hook (shot type, subject, motion, lighting).
6. Match on-screen text behavior. If the reference has text in the first 2s, every generated hook has text. If not, none.
7. No CTA, no body, no script — hooks only (the 2-3 second opener).
8. Aggressive US direct response. No softening. No "improving" the reference — clone, don't improve.

─────────────────────────────────────────────
OUTPUT FORMAT — exact, mandatory
─────────────────────────────────────────────
Start the response IMMEDIATELY with the Reference Hook Read line. No preamble, no "Here are your hooks…" filler.

**Reference hook read:** <one mechanism tag from the catalog> · <2-3 word visual signature> · <tone>

Then output exactly ${count} hook${count !== 1 ? 's' : ''}, each in this exact format. The \`## Hook N\` header IS MANDATORY — the downstream parser keys on it.

## Hook 1

**Mechanism:** <one tag from the catalog — same as Reference Hook Read>

**Spoken / written:**
<the literal words the viewer hears or reads — 1-2 sentences max>

**Visual:**
<what's on screen during these 2-3 seconds — be specific: shot type, subject, motion, lighting>

**On-screen text:** <verbatim, or "—" if none>

(repeat through Hook ${count})

PROHIBITIONS (auto-fail):
- ❌ Switching mechanism mid-batch
- ❌ Skipping the Visual section
- ❌ Inventing brand facts not in the Saint Graal
- ❌ Keeping any literal element of the reference's product / vertical
- ❌ Adding a CTA, body, or anything beyond the 2-3 second hook
- ❌ Meta-commentary ("I hope this helps", "Let me know if you want variations")`;

    const maxTokens = Math.min(8000, Math.max(2000, count * 280));

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: promptText }],
    });

    const output = (response.content[0] as { type: string; text: string }).text;

    const generation = await prisma.generation.create({
      data: {
        projectId,
        module: 'hook',
        inputs: JSON.stringify({
          mode,
          count,
          instructions,
          referenceFormat: videoAnalysis.format,
          referenceDuration: videoAnalysis.duration,
        }),
        output,
      },
    });

    return NextResponse.json({ output, generationId: generation.id });
  }

  // ---------- branch: from_brand / from_script (existing behavior) ----------
  const modeSection =
    mode === 'from_script'
      ? `MODE: From existing script\n\nSCRIPT:\n${script}`
      : `MODE: From brand knowledge only (no script provided)`;

  const prompt = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}

${modeSection}${instructionsSection}

Generate ${count} diverse hook ideas for Meta Ads cold traffic. Mix of:
- Written hooks (on-screen text / spoken opening lines)
- Visual hook ideas (what the camera shows in the first 2 seconds)

HOOK RULES:
- Full creative freedom: WTF, serious, original, provocative, emotional — all valid
- Goal: pattern interrupt + stop scroll in 2 seconds
- No self-censorship
- Make them feel impossible to scroll past

For EACH hook output exactly:

**[NUMBER]. [HOOK TEXT or VISUAL DESCRIPTION]**
Type: [Written Hook / Visual Hook]
Stop Scroll Potential: [1-10]/10
Originality: [1-10]/10
Why it works: [one line psychological explanation]

---

No preamble. Start directly with Hook #1.`;

  // ~200 tokens per hook is a generous budget for the structured output above.
  const maxTokens = Math.min(8000, Math.max(1500, count * 220));

  const response = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const output = (response.content[0] as { type: string; text: string }).text;

  const generation = await prisma.generation.create({
    data: {
      projectId,
      module: 'hook',
      inputs: JSON.stringify(body),
      output,
    },
  });

  return NextResponse.json({ output, generationId: generation.id });
}
