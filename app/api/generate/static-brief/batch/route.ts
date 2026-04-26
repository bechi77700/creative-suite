import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES, STATIC_PRODUCT_RULE, STATIC_VISUAL_DIRECTION_RULE } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

interface BatchRow {
  angle: string;
  design_family: string;
  hook_type: string;
  audience: string;
  version: string;
}

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, product, format, rows } = body as {
    projectId: string;
    product: string;
    format: string;
    rows: BatchRow[];
  };

  const project = await prisma.brandProject.findUnique({
    where: { id: projectId },
    include: { documents: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const globalKnowledge = await prisma.globalKnowledge.findMany();
  const brandContext = buildBrandDocumentsBlock(project.documents);
  const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, 'static');

  const results: { version: string; output: string; generationId: string }[] = [];

  // Stable prefix is built once outside the loop and reused for every row —
  // every row hits the same cache entry, paying ~10% on the prefix from row 2+.
  const stablePrefix = `${GENERATION_RULES}
${STATIC_PRODUCT_RULE}
${STATIC_VISUAL_DIRECTION_RULE}

BRAND: ${project.name}
PRODUCT: ${product}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}`;

  for (const row of rows) {
    const variableSuffix = `Generate a complete STATIC AD BRIEF:
- Format: ${format}
- Angle: ${row.angle}
- Design Family: ${row.design_family}
- Hook Type: ${row.hook_type}
- Audience: ${row.audience}
- Version: ${row.version}

Use the exact output structure:
## CREATIVE BRIEF
**Objective:** ...
**Visual Hierarchy:** ...
**Headline:** [OPTION 1] / [OPTION 2] / [OPTION 3]
**Body Copy:** ...
**Tone:** ...
**What to Avoid:** ...
**Key Insight:** ...

---

## NANOBANANA PROMPT
[full ready-to-paste prompt]
`;

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: buildCachedUserContent(stablePrefix, variableSuffix),
      }],
    });

    const output = (response.content[0] as { type: string; text: string }).text;
    const generation = await prisma.generation.create({
      data: {
        projectId,
        module: 'static',
        inputs: JSON.stringify({ ...row, format, product }),
        output,
      },
    });

    results.push({ version: row.version, output, generationId: generation.id });
  }

  return NextResponse.json({ results });
}
