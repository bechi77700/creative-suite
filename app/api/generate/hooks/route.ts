import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
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
  const { projectId, mode, script, instructions, videoAnalysis, videoSource } = body as {
    projectId: string;
    mode: 'from_brand' | 'from_script' | 'from_video';
    script?: string;
    instructions?: string;
    videoAnalysis?: VideoAnalysis | null;
    videoSource?: 'own' | 'competitor' | null;
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
    const source: 'own' | 'competitor' = videoSource === 'own' ? 'own' : 'competitor';

    const sourceBlock = source === 'own'
      ? `SOURCE: own brand
This reference is ONE OF OUR OWN ads. The product, brand name, claims, numbers, ingredients, proof points and vertical-specific nouns are OURS — keep them. We are multiplying winners, not reinventing them.

What you CAN keep verbatim from the reference:
- The product
- The brand name
- The exact claims, numbers, ingredients, guarantees
- The proof points / testimonials
- The vertical-specific nouns

What you SHOULD vary across the ${count} hook${count !== 1 ? 's' : ''}:
- The wording (rephrase, sharpen, shorten, lengthen, flip the order)
- The visual treatment (camera angle, motion, lighting, on-screen text styling)
- The opening beat (different first frame / first word / cold open)
- Same mechanism stays unless the user instruction explicitly asks for "different angles".`
      : `SOURCE: competitor
This reference is from ANOTHER brand. We are NOT cloning their product, claims, or vertical. We are cloning the MECHANISM that makes the hook stop scrolls, and adapting it to OUR brand.

What you must NEVER carry over from the reference:
- The product
- The brand name
- Any factual claim, number, ingredient, guarantee
- The vertical-specific nouns (translate them 1:1 to our vertical — function survives, noun shifts)

What you DO clone:
- The hook mechanism (the WHY it stops the scroll)
- The pacing of the opening 2-3 seconds
- The pairing of audio + visual pattern
- The on-screen text behavior
- The tone (intimate / authoritative / peer / urgent)`;

    const stablePrefix = `${GENERATION_RULES}

You are running the **Clone Hook from Video** SOP for Meta Ads (lives in the brand's Knowledge Base as "clone-hook-from-video-sop.md"). The user uploaded a reference hook video and wants hooks based on it.

BRAND: ${project.name}

GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}

BRAND DOCUMENTS:
${brandContext || '(none)'}`;

    const variableSuffix = `Number of hooks requested: ${count}

─────────────────────────────────────────────
${sourceBlock}
─────────────────────────────────────────────

─────────────────────────────────────────────
REFERENCE HOOK VIDEO
─────────────────────────────────────────────
${renderAnalysisForHook(videoAnalysis)}
${instructionsSection}

─────────────────────────────────────────────
MECHANISM — open vocabulary, internally consistent
─────────────────────────────────────────────
Identify the mechanism the reference uses and label it with a short, specific tag. Common tags include curiosity gap, contrarian statement, stat shock, stranger-stop, problem amplification, declarative claim, reaction shot opener, before-state shock, qualifier callout, question-bait, visual-first cold open, social proof drop, myth bust, live demo, POV reveal, text-message screenshot — but the vocabulary is OPEN. If the reference uses a mechanic that doesn't match a common tag, invent a short 2-4 word descriptive tag for it.

The constraint is **internal consistency**: identify the mechanism ONCE, then every one of the ${count} generated hook${count !== 1 ? 's' : ''} uses that SAME mechanism. Don't switch mid-batch.

─────────────────────────────────────────────
FORM — match the reference, don't force a coupling
─────────────────────────────────────────────
A hook can be:
- **Spoken / written only** (a line of VO or on-screen text — no specific visual direction)
- **Visual only** (a striking image / gesture / motion — no spoken or written words)
- **Both** (paired text + visual)

Match the reference's form:
- Reference text-only → all hooks text-only.
- Reference visual-only → all hooks visual-only.
- Reference mixed → batch can mix.

For each field that doesn't apply to a given hook, write \`—\` (em dash). Do NOT pad with generic visuals just to fill the slot.

─────────────────────────────────────────────
HARD RULES (non-negotiable)
─────────────────────────────────────────────
1. Mechanism is locked across the batch. Identify once, reuse for all ${count} hook${count !== 1 ? 's' : ''}.
2. Match the reference's form (see above). Don't force visuals onto text-only hooks or vice versa.
3. Tone matches the reference (intimate stays intimate, aggressive stays aggressive).
4. Source-specific carry-over rules (above) are non-negotiable.
5. No fabricated brand facts. Pull from Saint Graal / brand docs only. ${source === 'competitor' ? 'If the reference uses a claim that doesn\'t exist in the brand\'s docs, write around it with a generic verb / structural placeholder.' : 'If a claim doesn\'t appear in your KB, tag it `[NEW CLAIM]` and surface it.'}
6. No CTA, no body, no script — 2-3 second opener only.
7. No "improving" the reference. Clone the mechanism, don't redesign it.

─────────────────────────────────────────────
OUTPUT FORMAT — exact, mandatory
─────────────────────────────────────────────
Start the response IMMEDIATELY with the Reference Hook Read line. No preamble.

**Reference hook read:** ${source} · <mechanism tag> · <form: text | visual | mixed> · <tone>

Then output exactly ${count} hook${count !== 1 ? 's' : ''}, each in this exact format. The \`## Hook N\` header IS MANDATORY — the downstream parser keys on it.

## Hook 1

**Mechanism:** <same tag as Reference Hook Read>

**Spoken / written:**
<literal words the viewer hears or reads — 1-2 sentences max — OR "—" if pure-visual>

**Visual:**
<concrete shot description: shot type, subject, motion, lighting — OR "—" if text-only with no specific visual direction>

**On-screen text:** <verbatim, or "—" if none>

(repeat through Hook ${count})

PROHIBITIONS (auto-fail):
- ❌ Switching mechanism mid-batch
- ❌ ${source === 'competitor' ? 'Keeping any literal element of the reference\'s product / vertical / claim' : 'Drifting away from your own product / claims (this is YOUR ad — keep it yours)'}
- ❌ Inventing brand facts not in the Saint Graal
- ❌ Padding a text-only hook with a forced generic visual (use "—" instead)
- ❌ Adding a CTA, body, or anything beyond the 2-3 second hook
- ❌ Meta-commentary ("I hope this helps", "Let me know if you want variations")`;

    const maxTokens = Math.min(8000, Math.max(2000, count * 280));

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: buildCachedUserContent(stablePrefix, variableSuffix),
      }],
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
          videoSource: source,
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

  const stablePrefix2 = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}`;

  const variableSuffix2 = `${modeSection}${instructionsSection}

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
    messages: [{
      role: 'user',
      content: buildCachedUserContent(stablePrefix2, variableSuffix2),
    }],
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
