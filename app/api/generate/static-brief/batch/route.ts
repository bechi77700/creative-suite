import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';

interface BatchRow {
  angle: string;
  design_family: string;
  hook_type: string;
  audience: string;
  version: string;
}

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
  const brandContext = project.documents
    .map((d) => `[${d.type.toUpperCase()} — ${d.name}]`)
    .join('\n');
  const knowledgeContext = globalKnowledge.map((k) => `[${k.category.toUpperCase()} — ${k.name}]`).join('\n');

  const results: { version: string; output: string; generationId: string }[] = [];

  for (const row of rows) {
    const prompt = `${GENERATION_RULES}

BRAND: ${project.name}
PRODUCT: ${product}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}

Generate a complete STATIC AD BRIEF:
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
      messages: [{ role: 'user', content: prompt }],
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
