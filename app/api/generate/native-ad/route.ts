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
// Model: MODEL_FAST (Sonnet 4.6). Prompt-cached prefix on KB+brand docs.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL_FAST, GENERATION_RULES } from '@/lib/anthropic';
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
🚫 RULE #0 BIS — IMAGE: THE PRODUCT IS NEVER VISIBLE. AT ALL.
─────────────────────────────────────────────

ABSOLUTE BAN — the product, its packaging, its bottle, its tube, its jar,
its box, its pillow, its mask, its capsule, its label, its branding,
its logo, or ANY recognizable form of it MUST NOT APPEAR in the image.
Not centered. Not in the background. Not on a shelf. Not in a hand.
Not on a table. Not blurred behind a person. NEVER. PERIOD.

If you write a Nanobanana prompt that contains words like "bottle",
"jar", "pillow", "mask", "tube", "capsule", "softgel", "pill", "package",
"box", "label", "supplement bottle", or the brand/product name as the
subject of the image — the image FAILS. Rewrite before emitting.

─── STEP 1 — PICK THE NARRATIVE MOMENT FIRST ───────────────────────

Before writing a single word of the Nanobanana prompt, identify ONE
specific moment from the ad copy you just wrote. Pick from:

  • SUFFERING MOMENT — the protagonist in the lived pain, before the solution
    (e.g. lying awake at 2 AM, staring at a mirror, slumped in a chair)
  • DISCOVERY MOMENT — the chance encounter or the screen at 1 AM
    (e.g. reading a forgotten card, late-night phone in bed, conversation by a pool)
  • PROOF OBJECT — a worn, used, transformed everyday object that PROVES the
    story (NOT the product) — e.g. an old cookbook, a torn pillow, a CPAP
    machine in a bin, an empty wineglass, a worn-out sock
  • INTIMATE DOMESTIC SCENE — a candid moment in a home: a couple in bed,
    a parent eating alone, hands on a kitchen counter, a closed bedroom door
  • BODY DETAIL / VISCERAL PROOF — a close-up of a body part that carries
    the problem: skin under harsh light, swollen ankles, hands trembling,
    eye bags in a morning mirror
  • MEDICAL / SEMI-CLINICAL IMAGERY — scan, X-ray, lab strip, annotated
    diagram with "A" / "B" labels (these annotations ARE allowed)
  • AUTHORITY FIGURE PORTRAIT — the unexpected expert from the story:
    a retired pharmacist, a foreign doctor, an elderly artisan — captured
    candidly, never posed

The 7 reference ads in the KB consistently use 4 archetypes — use them
as anchors, not constraints:
  - Scène de vie intime (couple/parent in domestic moment)
  - Visage authentique (close-up of unmade face, no makeup, harsh light)
  - Objet-preuve usagé (worn artifact carrying the story)
  - Imagerie médicale (scan, diagram with labels)

You are FREE to invent a fifth archetype if it serves the story better,
as long as the subject is NEVER the product.

─── STEP 2 — SELF-VALIDATE BEFORE WRITING THE PROMPT ───────────────

Once you've picked the moment, ask yourself:

  Q1: "Is the subject of my image the product, its packaging, or anything
       that looks like it would be sold in a store?"
       → If YES → THROW AWAY and pick a different moment.

  Q2: "Could this image stand alone on Reddit/Facebook with no caption
       and look like a real person's post — not an ad?"
       → If NO → rewrite.

  Q3: "Does it trigger ONE of the 4 reflexes? (what is this / could be me /
       yuck-wow / not an ad)"
       → If NO → rewrite.

─── STEP 3 — WRITE THE PROMPT ──────────────────────────────────────

Only after passing Q1/Q2/Q3, write the Nanobanana prompt. Rules:

- The FIRST noun after "1:1 square format," must be a HUMAN, a SCENE,
  a BODY DETAIL, a PROOF OBJECT, or a MEDICAL VIEW. Never the product.
- 5 systemic principles from SOP §6 must be activated by the prompt:
  visual friction / radical authenticity / intimate intrusion /
  visceral proof / focus displacement.
- iPhone-authentic look: natural/ambient light, grain OK, imperfect
  framing OK, no studio lighting, no professional model, no retouch,
  no Instagram filter, no text on image, no logo, no brand name.
- Format: ALWAYS 1:1 square. Never 4:5, never 16:9.

GOOD prompt example (subject = body detail, focus displacement):
  "1:1 square format, extreme close-up of a 56-year-old woman's lower
  face in a bathroom mirror at 7 AM, harsh overhead light, vertical
  lines around the lips visible, no makeup, slight grain, iPhone photo
  feel, candid expression of mild frustration, no text, no logo, no
  studio lighting, no professional model, no product visible."

BAD prompt example (DO NOT WRITE THIS — product is the subject):
  "1:1 square format, an elegant pillow on a bed, soft morning light,
  product visible in the center..."  ← FAILS Q1.

If you find yourself reaching for the product as the subject because
"I have to show what we sell" — STOP. The whole point of the SOP is
that NOT showing the product is what makes the ad feel native. The
copy already sells the product. The image's only job is to stop the
scroll with a non-ad-looking moment.

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

**Subject category** : [un seul choix parmi cette liste — pas de réécriture libre]
- suffering_moment
- discovery_moment
- proof_object (ATTENTION: l'objet-preuve N'EST PAS le produit — c'est un
  artefact secondaire qui matérialise l'histoire : vieux livre, oreiller
  défoncé, machine CPAP au rebut, etc.)
- intimate_domestic_scene
- body_detail
- medical_imagery
- authority_portrait

**Concept de l'image** :
[Une ou deux phrases. Le moment précis du récit illustré (cite la phrase
ou le bloc d'où il vient). Confirme explicitement: "Le produit n'apparaît
PAS dans l'image."]

**Prompt Nanobanana** :
\`\`\`
[Prompt complet en anglais, prêt à coller dans Nano-Banana 2.

OBLIGATIONS:
- Doit commencer par "1:1 square format,"
- Le PREMIER nom après le format doit être un humain, une scène, un détail
  corporel, un objet-preuve secondaire, ou une vue médicale — JAMAIS le
  produit, son packaging, sa bouteille, son tube, son oreiller, son masque,
  sa capsule, son flacon.
- Doit inclure explicitement à la fin du prompt: "no text on image, no
  logo, no studio lighting, no professional model, no Instagram filter,
  no product visible, no packaging, no brand name."
- Doit décrire: cadrage exact, lumière (naturelle/ambiante uniquement),
  expression / posture, détails sensoriels, grain photo / look iPhone.
- Le prompt doit être généré DYNAMIQUEMENT à partir du moment du récit
  choisi — pas un template recopié.]
\`\`\`

**Pourquoi cette image fonctionne** :
[2-3 lignes:
1. Quel(s) principe(s) du SOP §6 sont activés (friction visuelle /
   authenticité radicale / intrusion intime / preuve viscérale /
   déplacement du focus).
2. Quel(s) réflexe(s) parmi les 4 elle déclenche (c'est quoi ce truc /
   ça pourrait être moi / beurk-wow / c'est pas une pub).
3. Confirmation que le produit n'est pas dans l'image et pourquoi cette
   absence renforce l'effet.]`;

  const anthropic = getAnthropic();
  const encoder = new TextEncoder();

  let fullOutput = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = anthropic.messages.stream({
          model: MODEL_FAST,
          // 32k = comfortable ceiling for very long native ads (5000+ words)
          // plus the IMAGE BRIEF. Sonnet 4.6 supports up to 64k output tokens.
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
