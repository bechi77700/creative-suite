// Native Ads — alternative image brief generator.
//
// Given an existing native-ad copy (and optionally the briefs already
// generated for it), this route asks Claude to produce a NEW image brief
// that:
//   - Picks a DIFFERENT moment from the story than the previous briefs
//   - Activates a DIFFERENT réflexe / principle from SOP §6
//   - Strictly follows the SOP (KB-injected, single source of truth)
//
// This is NOT an iteration of the same image — it's a fresh image type
// based on the same ad copy.
//
// Contract:
//   POST { projectId, adCopy, previousBriefs?: { concept, prompt, why }[] }
//   → JSON { concept, prompt, why }
//
// Model: MODEL_SMART. Prompt-cached prefix on KB+brand docs.

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL_SMART, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

export const maxDuration = 120;

interface PrevBrief {
  concept?: string;
  prompt?: string;
  why?: string;
}

export async function POST(req: Request) {
  const { projectId, adCopy, previousBriefs } = (await req.json()) as {
    projectId: string;
    adCopy: string;
    previousBriefs?: PrevBrief[];
  };

  if (!projectId || !adCopy?.trim()) {
    return NextResponse.json(
      { error: 'projectId and adCopy are required.' },
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
GLOBAL KNOWLEDGE (includes the NATIVE ADS SOP — §6 STANDARDISATION DES IMAGES is the source of truth here):
${knowledgeContext || '(none — upload NATIVE_ADS_COMPLETE.md into the native_ads KB category)'}

BRAND DOCS:
${brandContext || '(none)'}

SAINT GRAAL DOCUMENT:
${saintGraalContent}`;

  const previousBlock =
    previousBriefs && previousBriefs.length > 0
      ? `─────────────────────────────────────────────
IMAGES DÉJÀ GÉNÉRÉES POUR CETTE AD COPY (à NE PAS répéter)
─────────────────────────────────────────────

${previousBriefs
  .map(
    (b, i) => `── Image #${i + 1} ──
Concept : ${b.concept ?? '(n/a)'}
Prompt  : ${b.prompt ?? '(n/a)'}
Pourquoi : ${b.why ?? '(n/a)'}`,
  )
  .join('\n\n')}

⚠️ La nouvelle image doit illustrer un AUTRE moment du récit ou une AUTRE preuve mentionnée dans l'ad copy. Elle doit activer un réflexe / principe DIFFÉRENT de ceux ci-dessus (cf. SOP §6).
`
      : '';

  const variableSuffix = `─────────────────────────────────────────────
TASK — INVENTE UN NOUVEAU IMAGE BRIEF POUR CETTE NATIVE AD
─────────────────────────────────────────────

AD COPY (la native ad publiée, source de vérité pour les moments à illustrer) :
"""
${adCopy.trim()}
"""

${previousBlock}─────────────────────────────────────────────
RULES — APPLIQUE LE SOP §6 STRICTEMENT
─────────────────────────────────────────────

Le SOP NATIVE ADS (§6 — "STANDARDISATION DES IMAGES") ci-dessus est la
seule source de vérité. Applique-le sans le diluer :

- Les 4 réflexes (§6 "LE SYSTÈME UNIVERSEL") — au moins UN doit être
  déclenché. Choisis-en un DIFFÉRENT des images précédentes si possible.
- Les 5 principes systémiques (§6 "LES 5 PRINCIPES…") — y compris
  Principe 5 : "Le sujet de l'image n'est jamais le produit."
- La méthode 5 étapes (§6 "COMMENT INVENTER UNE IMAGE…") :
    1. Choisis D'ABORD un moment du récit (ou une preuve mentionnée)
       de l'ad copy ci-dessus — un moment DIFFÉRENT de ceux déjà
       illustrés.
    2. Identifie le(s) réflexe(s) et principe(s) du SOP §6 que tu vas
       activer.
    3. Invente l'image en respectant ces principes (liberté créative
       totale dans ce cadre — n'invente pas de règles).
- Les règles photo absolues (§6) — pas de packshot, pas de logo, pas
  de texte sur l'image (sauf labels médicaux A/B/flèches), pas de
  filtre Instagram, pas de modèle pro, pas de lumière studio, look
  "iPhone authentique".
- Format : 1:1 carré (verrouillé pour ce générateur).

Logique copy↔image (§6) : l'image illustre UN moment du récit ou UNE
preuve mentionnée dans l'ad copy — jamais le produit lui-même de
façon directe. Une image = une idée.

─────────────────────────────────────────────
OUTPUT FORMAT — STRICTEMENT CE FORMAT, RIEN D'AUTRE
─────────────────────────────────────────────

**Concept de l'image** :
[1-2 phrases — quel moment du récit / quelle preuve tu illustres, et
pourquoi tu choisis CE moment plutôt qu'un autre.]

**Prompt Nanobanana** :
\`\`\`
[Prompt complet en anglais, prêt à coller dans Nano-Banana 2. Doit
commencer par "1:1 square format,". Décrit le cadrage, la lumière
naturelle, la scène, l'expression, le look photo iPhone authentique
(grain, framing imparfait OK). Suit les règles photo absolues du
SOP §6.]
\`\`\`

**Pourquoi cette image fonctionne** :
[2-3 lignes — quel(s) principe(s) du SOP §6 sont activés et quel(s)
réflexe(s) parmi les 4 elle déclenche. Mentionne explicitement en
quoi elle est DIFFÉRENTE des images précédentes.]`;

  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: MODEL_SMART,
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: buildCachedUserContent(stablePrefix, variableSuffix),
        },
      ],
    });

    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();

    // Parse the same 3 fields the main route emits.
    const concept = extractField(
      text,
      /\*\*Concept[^*]*\*\*\s*:?\s*([\s\S]*?)(?=\*\*Prompt|\*\*Pourquoi|$)/i,
    );
    const promptCodeMatch = text.match(
      /\*\*Prompt[^*]*\*\*\s*:?\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/i,
    );
    const prompt = promptCodeMatch
      ? promptCodeMatch[1].trim()
      : extractField(text, /\*\*Prompt[^*]*\*\*\s*:?\s*([\s\S]*?)(?=\*\*Pourquoi|$)/i);
    const why = extractField(text, /\*\*Pourquoi[^*]*\*\*\s*:?\s*([\s\S]*?)$/i);

    if (!prompt) {
      return NextResponse.json(
        { error: 'Model returned no usable Nanobanana prompt.', raw: text },
        { status: 502 },
      );
    }

    return NextResponse.json({ concept, prompt, why, raw: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[native-ad/alt-image] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function extractField(src: string, re: RegExp): string {
  const m = src.match(re);
  if (!m) return '';
  return m[1].replace(/^```[a-zA-Z0-9_-]*\n?|```$/g, '').trim();
}
