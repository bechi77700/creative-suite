// Native Ads — headline generator (SOP §7).
//
// Generates 5-10 headline variants for a native ad. Two modes:
//   - 'from_copy'   → an ad copy already exists; mine its angle + mechanic
//                     and produce headlines that complement it.
//   - 'standalone'  → no copy yet; user supplies brand + angle + context.
//
// Each variant is tagged with the systemic principle it activates
// (A audience filter / B foreign authority / C mystery accusation /
//  D quoted contradiction / E radical reframing / F fortuitous discovery).
//
// Non-streaming — output is short. Returns JSON.
//
// Contract:
//   POST {
//     projectId,
//     mode: 'from_copy' | 'standalone',
//     adCopy?,                   // required when mode='from_copy'
//     brand?, angle?, context?,  // hints for both modes
//     count?,                    // 5-10, default 8
//   }
//   → { headlines: [{ index, principle, principleCode, text }], generationId }
//
// Model: MODEL_FAST (Sonnet 4.6). Same Saint Graal gate + KB injection
// as the long-form route, but a much smaller prompt.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL_FAST, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

export const maxDuration = 120;

interface Headline {
  index: number;
  principle: string;
  principleCode: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | string;
  text: string;
}

const PRINCIPLE_LABELS: Record<string, string> = {
  A: "Filtre d'audience",
  B: 'Autorité étrangère/inattendue',
  C: 'Mystère / accusation',
  D: 'Citation rapportée',
  E: 'Recadrage radical',
  F: 'Découverte fortuite',
};

// Parse the model output into structured headlines. Expected line shape:
//   1. [A] Read this if you have a dog 👆
//   2. [C] Le problème que les médecins ignorent
// Accepts loose variations: brackets/parens, dot/parens after number, etc.
function parseHeadlines(raw: string): Headline[] {
  const out: Headline[] = [];
  const lines = raw.split('\n');
  const re = /^\s*(\d+)[.)]\s*[\[\(]\s*([A-F])\s*[\]\)]\s*(.+?)\s*$/i;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    const index = parseInt(m[1], 10);
    const code = m[2].toUpperCase();
    const text = m[3].trim().replace(/^["“]|["”]$/g, '');
    if (!text) continue;
    out.push({
      index,
      principleCode: code,
      principle: PRINCIPLE_LABELS[code] ?? code,
      text,
    });
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      mode,
      adCopy,
      brand,
      angle,
      context,
      count = 8,
    } = body as {
      projectId: string;
      mode: 'from_copy' | 'standalone';
      adCopy?: string;
      brand?: string;
      angle?: string;
      context?: string;
      count?: number;
    };

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });
    }
    if (mode !== 'from_copy' && mode !== 'standalone') {
      return NextResponse.json({ error: 'mode must be from_copy or standalone.' }, { status: 400 });
    }
    if (mode === 'from_copy' && !adCopy?.trim()) {
      return NextResponse.json({ error: 'adCopy is required in from_copy mode.' }, { status: 400 });
    }
    if (mode === 'standalone' && !angle?.trim()) {
      return NextResponse.json({ error: 'angle is required in standalone mode.' }, { status: 400 });
    }

    const project = await prisma.brandProject.findUnique({
      where: { id: projectId },
      include: { documents: true },
    });
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const saintGraal = project.documents.find((d) => d.type === 'saint_graal_doc');
    if (!saintGraal) {
      return NextResponse.json(
        { error: 'Saint Graal document required before generating.' },
        { status: 403 },
      );
    }

    const globalKnowledge = await prisma.globalKnowledge.findMany();
    const brandContext = buildBrandDocumentsBlock(project.documents);
    const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, 'native');

    const saintGraalContent = saintGraal.content
      ? Buffer.from(saintGraal.content, 'base64').toString('utf-8')
      : '(content not available)';

    const stablePrefix = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE (NATIVE ADS SOP — §7 covers headlines):
${knowledgeContext || '(none — upload NATIVE_ADS_COMPLETE.md into the native_ads KB category)'}

BRAND DOCS:
${brandContext || '(none)'}

SAINT GRAAL DOCUMENT:
${saintGraalContent}`;

    const sourceBlock =
      mode === 'from_copy'
        ? `─────────────────────────────────────────────
SOURCE — EXISTING NATIVE AD COPY
─────────────────────────────────────────────
${adCopy?.trim()}

The headlines you generate must build on the angle, mechanic, and tone of
the copy above — they are the entry point to THIS specific ad, not a
generic batch. Mine the hook, the bascule, the authority, the mechanism.`
        : `─────────────────────────────────────────────
SOURCE — STANDALONE BRIEF (no ad copy yet)
─────────────────────────────────────────────
${brand?.trim() ? `BRAND: ${brand.trim()}\n` : ''}ANGLE: ${angle?.trim()}
${context?.trim() ? `\nCONTEXT: ${context.trim()}` : ''}`;

    const clamped = Math.max(5, Math.min(10, Math.floor(count)));

    const variableSuffix = `─────────────────────────────────────────────
TASK — GENERATE NATIVE-AD HEADLINES (SOP §7)
─────────────────────────────────────────────

${sourceBlock}

─────────────────────────────────────────────
RULES — apply SOP §7 strictly
─────────────────────────────────────────────

1. LANGUAGE — infer from the Saint Graal market. Match the brand's market
   language (FR for French brands, EN for US brands, etc.). One language
   per response.

2. LENGTH — every headline is 3 to 12 words. Ideally 5-8.

3. NO PRODUCT, NO BRAND — never name the product or mention the obvious
   product category. Speak about the problem, the moment, or the revelation.

4. NO MARKETING SPEAK — no superlatives, no "Découvrez/Profitez/Bénéficiez",
   no "revolutionary", no "#1", no aggressive numeric promises ("Lose 10kg
   in 30 days"), no slogans, no exclamation marks (one max, very rare).

5. ONE EMOJI MAX — and only the cursor 👆 or similar, never marketing emojis
   (🔥💯⭐). Skip emojis entirely if not pertinent.

6. HUMAN VOICE — must read like an organic Reddit/Facebook post title from a
   real person, not an ad headline. Conversational, affirmative, quoted, or
   incomplete-tension phrases are good.

7. ONE PRINCIPLE PER HEADLINE — each variant uses ONE of these 6 systemic
   principles from SOP §7 as its primary trigger:
     A — Filtre d'audience (talks to a specific subgroup: "If you have a dog…")
     B — Autorité étrangère/inattendue ("The Japanese secret to…")
     C — Mystère / accusation autorité officielle ("What your dentist won't tell you")
     D — Citation rapportée + contradiction ("'Irreversible,' they said.")
     E — Recadrage radical d'un symptôme banalisé ("Your snoring isn't just noise.")
     F — Découverte fortuite ("I found a note in a 1961 cookbook.")

8. DIVERSITY — across the ${clamped} variants, cover at least 4 different
   principles (don't return 8 audience-filter headlines). Lead with the
   principles best suited to this brand and angle.

9. FINAL TEST — every variant must trigger ONE of the 4 reflexes:
   "ça me concerne" / "quoi-pourquoi" / "un secret/vérité cachée" / "c'est pas une pub".
   If a headline doesn't fire any of those, replace it before emitting.

─────────────────────────────────────────────
OUTPUT FORMAT — strict, machine-parsed
─────────────────────────────────────────────

Output exactly ${clamped} lines, one headline per line, in this format:

1. [A] First headline text here
2. [B] Second headline text here
3. [C] Third headline text here
…

Rules for the output:
- The bracket letter is the principle code (A/B/C/D/E/F).
- No quotes around the headline.
- No commentary, no preamble, no trailing notes.
- No blank lines between items.
- Exactly ${clamped} headlines, numbered 1 to ${clamped}.

Begin now.`;

    const response = await getAnthropic().messages.create({
      model: MODEL_FAST,
      max_tokens: 1500,
      messages: [
        {
          role: 'user',
          content: buildCachedUserContent(stablePrefix, variableSuffix),
        },
      ],
    });

    const raw = (response.content[0] as { type: string; text: string }).text;
    const headlines = parseHeadlines(raw);

    if (headlines.length === 0) {
      return NextResponse.json(
        {
          error: 'Could not parse any headlines from the model response.',
          raw,
        },
        { status: 502 },
      );
    }

    const generation = await prisma.generation.create({
      data: {
        projectId,
        module: 'native_headlines',
        inputs: JSON.stringify({ mode, brand, angle, context, count: clamped, hasAdCopy: !!adCopy }),
        output: raw,
      },
    });

    return NextResponse.json({ headlines, generationId: generation.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[native-headlines] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
