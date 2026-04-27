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

- Line break after almost every sentence.
- 1 sentence = 1 paragraph in roughly 80% of the copy.
- Maximum 2-3 short sentences grouped together if they form a single micro-thought.
- Impact lines (2-3 words) stand alone on their own line: "Rien." / "Three years." / "À vie." / "Quietly."
- Dialogues line by line, one paragraph per line of dialogue.
- Enumerations as individual paragraphs, not comma-separated lists.

VALIDATION TEST: scroll the output mentally on a phone. If it looks like a
blog article (dense paragraphs of 3+ glued sentences), REWRITE IT before
emitting. If it looks like a long organic Facebook/Reddit post, ship it.

If you produce dense paragraphs, the ad fails — even if the content is great.

─────────────────────────────────────────────
🚫 RULE #0 BIS — IMAGE: PRODUCT IS NEVER THE STAR
─────────────────────────────────────────────
- No packshot. No product staging. No hero shot. No centered product.
- Subject = the problem, a moment of the story, a visceral proof, an
  intimate scene, an authority figure. NEVER the product itself.
- The product may appear in the background as an everyday object (rare
  exception), but never centered.
- The image must trigger ONE of these 4 reflexes in the scroller:
  • "C'est quoi ce truc ?"  (visual friction / curiosity)
  • "Ça pourrait être moi"  (immediate identification)
  • "Beurk / wow"           (visceral reaction)
  • "C'est pas une pub"     (radical authenticity, disarms the ad filter)
- If none of the 4 reflexes fire → the image fails.
- Photo must respect the 5 systemic principles from SOP §6: visual friction,
  radical authenticity, intimate intrusion, visceral proof, focus displacement.
- Format: 1:1 square OR 4:5 vertical. NEVER 16:9. iPhone-authentic look —
  grain OK, imperfect framing OK, natural light, no studio, no filter, no
  text on image, no logo, no pro model.

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
[Une ou deux phrases. Le moment du récit illustré (souffrance / découverte / preuve / scène intime / détail mécaniste). PAS le produit. Précise quel(s) principe(s) du SOP §6 sont activés et quel(s) réflexe(s) sont visés.]

**Prompt Nanobanana** :
\`\`\`
[Prompt complet en anglais, prêt à coller dans Nano-Banana 2. Détails de
cadrage (square 1:1 OR 4:5 vertical), lumière naturelle, éléments de scène,
expression du personnage, look photo amateur / iPhone authentique. Inclure
explicitement: no text on image, no logo, no studio lighting, no pro model,
no product packshot. Le prompt doit être généré dynamiquement à partir du
moment du récit choisi — pas un template.]
\`\`\`

**Pourquoi cette image fonctionne** :
[2-3 lignes — quel(s) principe(s) du SOP §6 (friction visuelle / authenticité radicale / intrusion intime / preuve viscérale / déplacement du focus) et quel(s) réflexe(s) parmi les 4 elle déclenche.]`;

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
