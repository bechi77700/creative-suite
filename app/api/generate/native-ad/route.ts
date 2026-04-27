// Native Ads generator — long-form (1500-3500 words) editorial-style ads.
//
// Streams a complete native ad in the architecture defined by the
// NATIVE_ADS_COMPLETE.md SOP (uploaded by the user into the `native_ads`
// KB category). Output ends with a separate "IMAGE BRIEF" block that
// gives a Nanobanana prompt for the accompanying organic-feeling image.
//
// Contract:
//   POST { projectId, product, additionalContext? }
//   → SSE stream: event "text" { text }, event "done" {}, event "error"
//   → On done, persists a Generation row (module: 'native', type: 'native_ad').
//
// Notes:
// - MODEL_SMART (Opus) — long-form strategy + narrative. No funnel / language
//   selector: brand+market come from Saint Graal; native ads default to TOFU.
// - Saint Graal is required, same gate as video/static.
// - Prompt cache on KB+SOP+brand docs (the heavy stable prefix).

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

${additionalContext?.trim() ? `ADDITIONAL CONTEXT / ANGLE DIRECTION:\n${additionalContext.trim()}\n` : ''}
─────────────────────────────────────────────
RULES (non-negotiable)
─────────────────────────────────────────────
1. FOLLOW THE SOP. The NATIVE ADS SOP in the knowledge base above defines the
   mechanics (4 pillars, 9-block architecture, voice, image rules). Apply the
   PRINCIPLES — do not copy the references verbatim. Invent a new character,
   a new pivot moment, a new mechanism story.

2. LANGUAGE & MARKET. Infer the language and market from the Saint Graal.
   The ad must read as if written by a native speaker of that market, in the
   register of an editorial / first-person testimonial — not an ad.

3. AWARENESS. Default to TOFU (problem-aware → solution-aware). The reader
   does not yet know your product. The ad earns the click by telling a story,
   not by pitching.

4. LENGTH. 1500–3500 words. Long enough to immerse, short enough to finish.

5. STRUCTURE. Use the 9-block architecture from the SOP (A → I), but adapt
   block order/length to the product. Block headers in the output are OK
   (markdown ## A — Hook narratif, etc.) — they help downstream editing.

6. DO NOT mention the product brand by name before block F (mechanism reveal).
   The first half is pure story / authority / discovery.

7. NO generic claims. Every benefit must be tied to a specific scene, a
   specific person (named, age, location), a specific moment of bascule.

8. CTA must feel earned, not pushed. Mirror the references: a soft pivot to
   "here's where I got it / here's the link" — not "BUY NOW LIMITED OFFER".

─────────────────────────────────────────────
OUTPUT FORMAT
─────────────────────────────────────────────

# [TITRE / HEADLINE DE LA NATIVE AD]
*Sous-titre éditorial style si pertinent*

## A — Hook narratif
[...]

## B — Mise en scène personnelle
[...]

## C — Le parcours d'échec
[...]

## D — Le moment de bascule
[...]

## E — La rencontre avec l'autorité / la découverte
[...]

## F — Le mécanisme révélé
[Premier endroit où le produit / la marque peut apparaître]

## G — La transformation / les preuves
[...]

## H — La validation sociale / l'élargissement
[...]

## I — La pivot CTA douce
[...]

---

# IMAGE BRIEF (pour Nanobanana)

**Concept de l'image** :
[Une phrase qui décrit la scène — doit être cohérente avec le hook et le bloc B. Organique, pas studio. Voir SOP §6 sur l'imagerie.]

**Prompt Nanobanana** :
\`\`\`
[Prompt complet, anglais, prêt à coller dans Nanobanana — détails de cadrage,
lumière naturelle, éléments de scène, expression du personnage, style photo
amateur / journalistique. Pas de texte sur l'image. Pas de logo.]
\`\`\`

**Pourquoi cette image fonctionne** :
[2-3 lignes — quel pilier psychologique elle active, pourquoi elle ne ressemble pas à une pub.]`;

  const anthropic = getAnthropic();
  const encoder = new TextEncoder();

  let fullOutput = '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = anthropic.messages.stream({
          model: MODEL_SMART,
          max_tokens: 8000,
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
