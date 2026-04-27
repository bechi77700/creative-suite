// Native Ads generator — long-form (1500-3500 words) editorial-style ads.
//
// The NATIVE_ADS_COMPLETE.md SOP (uploaded to the `native_ads` KB
// category) is the single source of truth for the mechanic. This route
// hardcodes a thin scaffold ON TOP of the SOP — it restates the 9-block
// architecture (now flexible per SOP v1.1) and the visual-formatting
// rule with extra emphasis, and it pins down a parsing contract so the
// page can split copy from image brief.
//
// Per SOP v1.1, block names are:
//   A — Hook narratif
//   B — Mise en scène personnelle
//   C — Le parcours d'échec
//   D — Le moment de bascule
//   E — La révélation mécaniste (le "WHY")
//   F — La découverte du produit
//   G — La preuve par expérience
//   H — L'adresse directe au lecteur
//   I — Le CTA + projection émotionnelle
//
// Contract:
//   POST { projectId, product, additionalContext? }
//   → SSE stream: event "text" { text }, event "done" {}, event "error"
//   → On done, persists a Generation row (module: 'native').
//
// Model: MODEL_SMART (Opus 4.7). Prompt-cached prefix on KB+brand docs.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL_SMART, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

export const maxDuration = 300;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const { projectId, product, additionalContext } = (await req.json()) as {
    projectId: string;
    product: string;
    additionalContext?: string;
  };

  if (!projectId || !product?.trim()) {
    return NextResponse.json(
      { error: 'projectId and product are required.' },
      { status: 400 },
    );
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
GLOBAL KNOWLEDGE (includes the NATIVE ADS SOP + gold standard references):
${knowledgeContext || '(none — upload NATIVE_ADS_COMPLETE.md into the native_ads KB category)'}

BRAND DOCS:
${brandContext || '(none)'}

SAINT GRAAL DOCUMENT (full content — defines market, persona, voice, claims):
${saintGraalContent}`;

  const variableSuffix = `─────────────────────────────────────────────
TASK — WRITE ONE COMPLETE NATIVE AD
─────────────────────────────────────────────

PRODUCT TO ADVERTISE:
${product.trim()}

${additionalContext?.trim() ? `ADDITIONAL CONTEXT / ANGLE DIRECTION:\n${additionalContext.trim()}\n\n` : ''}─────────────────────────────────────────────
RULES (non-negotiable)
─────────────────────────────────────────────
1. FOLLOW THE SOP. The NATIVE ADS SOP above is the source of truth for the
   mechanic (4 psychological pillars, 9-block architecture, voice, image
   system, anti-patterns). Apply its PRINCIPLES — do not clone the 7 gold
   references. Invent a new character, a new authority, a new pivot moment,
   a new mechanism story.

2. LANGUAGE & MARKET. Infer language and market from the Saint Graal. The ad
   must read as if written by a native speaker of that market, in the
   register of an editorial / first-person testimonial — not an ad.

3. AWARENESS. Default to TOFU (problem-aware → solution-aware). The reader
   does not yet know your product. The ad earns the click by telling a story.

4. LENGTH. 1500–3500 words. Long enough to immerse, short enough to finish.

5. ARCHITECTURE. Use the 9-block scaffold from the SOP (A→I), but the SOP
   is explicit that this scaffold is FLEXIBLE: blocks may be merged, moved,
   or omitted if the story calls for it. Adapt to the product, do not force.

6. DO NOT mention the product or brand by name before the SECOND HALF of
   the ad. The first half is pure story / authority / mechanism setup.

7. NO generic claims. Every benefit ties to a specific scene, a specific
   person (named, age, location), a specific moment of bascule. At least 3
   real brands cited in the parcours d'échec. At least 2 odd, non-rounded
   numbers (47% > 50%). At least one precise hour/date/place at the bascule.

8. CTA must feel earned, not pushed. A soft pivot to "here's where I got it"
   — never "BUY NOW LIMITED OFFER". Optional 1-2 P.S. at the end.

─────────────────────────────────────────────
🔥 RULE #0 — VISUAL FORMATTING (the most important rule of the SOP)
─────────────────────────────────────────────
This is the signature visual of a native ad. NON-NEGOTIABLE.

- DOUBLE line break between sentences — i.e. a fully blank line between
  each sentence (Markdown paragraph break). NOT a single \\n soft break.
- 1 sentence = 1 paragraph in roughly 80% of the copy.
- Maximum 2-3 short sentences grouped together ONLY if they form a single
  micro-thought (rare; default to one-sentence paragraphs).
- Impact lines (2-3 words) stand alone on their own paragraph, separated
  by blank lines above and below: "Rien." / "Three years." / "À vie." / "Quietly."
- Dialogues: one paragraph per line of dialogue, blank line between each.
- Enumerations as individual paragraphs (each separated by a blank line),
  NOT comma-separated lists, NOT bullet lists glued together.

CONCRETE EXAMPLE — what the spacing must look like in the output:

❌ WRONG (single \\n — sentences are visually glued):
Phrase 1
Phrase 2
Phrase 3

✅ RIGHT (double \\n — blank line between every sentence):
Phrase 1

Phrase 2

Phrase 3

VALIDATION TEST: scroll the output mentally on a phone. Every sentence
must be visually isolated by a blank line above and below. If sentences
are stacked without empty lines between them — even if each is on its
own line — that is WRONG and you must rewrite before emitting.

If you produce dense paragraphs OR single-line-break stacking, the ad
fails — even if the content is great.

─────────────────────────────────────────────
🚫 RULE #0 BIS — IMAGE: APPLY SOP §6 STRICTLY
─────────────────────────────────────────────

The NATIVE ADS SOP (§6 — "STANDARDISATION DES IMAGES") above is the
single source of truth for the image. Apply it without softening:

- The 4 réflexes (§6 "LE SYSTÈME UNIVERSEL") — at least one must fire.
- The 5 principes systémiques (§6 "LES 5 PRINCIPES…") — including
  Principe 5: "Le sujet de l'image n'est jamais le produit."
- The 5-step method (§6 "COMMENT INVENTER UNE IMAGE…") — pick the
  moment of the story FIRST, then the principles, then invent the image.
  You have full creative freedom to invent new images as long as the
  principles are respected.
- The règles photo absolues (§6) — no packshot, no logo, no text on
  image (except medical labels A/B/arrows), no Instagram filter, no
  pro model, no studio lighting, "iPhone authentique" look.
- Format: ALWAYS 1:1 square (overrides the SOP's "1:1 ou 4:5" — for
  this generator we lock to 1:1).

Logique de matching copy↔image (§6): l'image illustre UN moment du
récit ou UNE preuve mentionnée — jamais le produit lui-même de façon
directe. Une image = une idée.

─────────────────────────────────────────────
OUTPUT FORMAT
─────────────────────────────────────────────

# [TITRE / HEADLINE DE LA NATIVE AD]
*Sous-titre éditorial style si pertinent*

## A — Hook narratif
[1ère personne, tension ou contradiction immédiate]

## B — Mise en scène personnelle
[Qui parle, enjeu humain, détails ultra-spécifiques — prénoms, âges, lieux, durées]

## C — Le parcours d'échec
[Solutions essayées, prix exacts, marques RÉELLES de la niche, durées précises, coût total cumulé]

## D — Le moment de bascule
[Un événement précis, toujours par hasard, avec heure/date/lieu précis]

## E — La révélation mécaniste (le "WHY")
[Explication scientifique/mécanique vraie ou plausible — pourquoi le problème existe, pourquoi les autres solutions échouent, pourquoi la nouvelle approche fonctionne]

## F — La découverte du produit
[Première mention du produit ICI, jamais avant. Présenté comme alternative invisible que personne ne mentionne. Mentionner versions cheap qui échouent. Justifier le prix par contraste.]

## G — La preuve par expérience
[Récit jour par jour, réactions des proches, données mesurables, validation par autorité tierce]

## H — L'adresse directe au lecteur
[Transition de "je" à "vous". Reconnaissance de la souffrance. "Ce n'est pas votre faute".]

## I — Le CTA + projection émotionnelle
[Projection dans le futur, description sensorielle de la vie après, garantie / risque zéro. Optionnel: 1-2 P.S.]

---

# IMAGE BRIEF (pour Nanobanana)

**Concept de l'image** :
[1-2 phrases — le moment du récit illustré, choisi en suivant la méthode
du SOP §6.]

**Prompt Nanobanana** :
\`\`\`
[Prompt complet en anglais, prêt à coller dans Nano-Banana 2. Doit
commencer par "1:1 square format,". Décrit le cadrage, la lumière
naturelle, la scène, l'expression, le look photo iPhone authentique
(grain, framing imparfait OK). Suit les règles photo absolues du
SOP §6 (no packshot, no logo, no text, no studio, no pro model,
no filtre).]
\`\`\`

**Pourquoi cette image fonctionne** :
[2-3 lignes — quel(s) principe(s) du SOP §6 sont activés et quel(s)
réflexe(s) parmi les 4 elle déclenche.]`;

  const anthropic = getAnthropic();
  const encoder = new TextEncoder();

  let fullOutput = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = anthropic.messages.stream({
          model: MODEL_SMART,
          // 32k = comfortable ceiling for very long native ads (5000+ words)
          // plus the IMAGE BRIEF. Opus 4.7 supports 32k output tokens.
          max_tokens: 32000,
          messages: [
            {
              role: 'user',
              content: buildCachedUserContent(stablePrefix, variableSuffix),
            },
          ],
        });

        for await (const chunk of messageStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            fullOutput += chunk.delta.text;
            controller.enqueue(encoder.encode(sse('text', { text: chunk.delta.text })));
          }
        }

        // Persist the generation so it shows up in /history.
        try {
          const generation = await prisma.generation.create({
            data: {
              projectId,
              module: 'native',
              inputs: JSON.stringify({ product, additionalContext }),
              output: fullOutput,
            },
          });
          controller.enqueue(
            encoder.encode(sse('done', { generationId: generation.id })),
          );
        } catch (persistErr) {
          // Don't fail the whole stream if persistence fails — the user already
          // has the text on screen.
          console.error('[native-ad] persist failed:', persistErr);
          controller.enqueue(encoder.encode(sse('done', {})));
        }

        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[native-ad stream] ERROR:', message);
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
}
