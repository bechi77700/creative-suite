import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      projectId,
      originalScript,
      currentIteration,
      feedback,
    }: {
      projectId: string;
      originalScript: string;
      currentIteration: string;
      feedback: string;
    } = body;

    if (!originalScript?.trim() || !currentIteration?.trim()) {
      return NextResponse.json({ error: 'originalScript and currentIteration are required' }, { status: 400 });
    }

    const [project, globalKnowledge] = await Promise.all([
      prisma.brandProject.findUnique({ where: { id: projectId }, include: { documents: true } }),
      prisma.globalKnowledge.findMany(),
    ]);
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

    const brandContext = buildBrandDocumentsBlock(project.documents);
    const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, 'video');

    const stablePrefix = `${GENERATION_RULES}

You are regenerating ONE video-script iteration based on user feedback.

BRAND: ${project.name}
GLOBAL KNOWLEDGE BASE:
${knowledgeContext || '(none)'}
BRAND DOCUMENTS:
${brandContext || '(none)'}`;

    const variableSuffix = `─────────────────────────────────────────────
ORIGINAL WINNING SCRIPT (the source of truth — keep its DNA)
─────────────────────────────────────────────
${originalScript.trim()}

─────────────────────────────────────────────
CURRENT ITERATION (the version the user wants improved)
─────────────────────────────────────────────
${currentIteration.trim()}

─────────────────────────────────────────────
USER FEEDBACK (apply this as the most important constraint)
─────────────────────────────────────────────
${feedback?.trim() || '(no specific feedback — just produce a stronger alternative version)'}

─────────────────────────────────────────────
RULES
─────────────────────────────────────────────
- Stay a sibling of the ORIGINAL — do not drift into a completely different concept.
- Address the user's feedback directly.
- NO editor instructions, no camera directions — pure spoken words and on-screen text only.
- Aggressive US direct response.

OUTPUT — exactly this structure, nothing else:

**Iterates on:** [name the axis(es) varied — one short line]

### HOOK
[spoken words for the first 2-3 seconds]

### BODY
[the full body]

### CTA
[the closing call to action]

**What changed vs the previous version:** [one sentence]`;

    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: buildCachedUserContent(stablePrefix, variableSuffix),
      }],
    });

    const output = (response.content[0] as { type: string; text: string }).text;

    await prisma.generation.create({
      data: {
        projectId,
        module: 'iterate-video',
        inputs: JSON.stringify({ originalScript, currentIteration, feedback, regen: true }),
        output,
      },
    });

    return NextResponse.json({ output });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[iterate-video/regenerate] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
