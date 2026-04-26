import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL_FAST, GENERATION_RULES, STATIC_PRODUCT_RULE } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, type KnowledgeModule } from '@/lib/knowledge';

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  const { generationId } = body;

  const original = await prisma.generation.findUnique({
    where: { id: generationId },
    include: { project: { include: { documents: true } } },
  });
  if (!original) return NextResponse.json({ error: 'Generation not found' }, { status: 404 });

  const globalKnowledge = await prisma.globalKnowledge.findMany();

  const moduleLabel =
    original.module === 'static' ? 'STATIC AD BRIEF' :
    original.module === 'video' ? 'VIDEO SCRIPT' : 'HOOK SET';

  const isStatic = original.module === 'static' || original.module === 'iterate';
  const knowledgeModule: KnowledgeModule =
    original.module === 'video' ? 'video' :
    original.module === 'hooks' ? 'hooks' : 'static';
  const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, knowledgeModule);
  const stablePrefix = `${GENERATION_RULES}
${isStatic ? STATIC_PRODUCT_RULE : ''}

BRAND: ${original.project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}`;

  const variableSuffix = `ORIGINAL ${moduleLabel}:
${original.output}

ORIGINAL INPUTS: ${original.inputs}

Generate 5 VARIATIONS of this ${moduleLabel}. Each variation must:
- Keep the same module type and format structure
- Change the angle, hook, tone, or approach significantly
- Be independently runnable (no reference to "like the original")
- Stay as aggressive and direct as the original

Label each variation clearly:

## VARIATION 1
[full content]

## VARIATION 2
[full content]

...and so on through VARIATION 5.`;

  const response = await getAnthropic().messages.create({
    model: MODEL_FAST,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: buildCachedUserContent(stablePrefix, variableSuffix),
    }],
  });

  const output = (response.content[0] as { type: string; text: string }).text;

  const generation = await prisma.generation.create({
    data: {
      projectId: original.projectId,
      module: original.module,
      inputs: JSON.stringify({ variationOf: generationId, originalInputs: original.inputs }),
      output,
    },
  });

  return NextResponse.json({ output, generationId: generation.id });
}
