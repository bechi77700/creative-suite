import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';
import { buildCachedUserContent } from '@/lib/prompt-cache';
import { buildGlobalKnowledgeBlock, buildBrandDocumentsBlock } from '@/lib/knowledge';

export const maxDuration = 300;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: Request) {
  const { projectId, format, length } = await req.json();

  const project = await prisma.brandProject.findUnique({
    where: { id: projectId },
    include: { documents: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const saintGraal = project.documents.find((d) => d.type === 'saint_graal_doc');
  if (!saintGraal) {
    return NextResponse.json({ error: 'Saint Graal document required before generating.' }, { status: 403 });
  }

  const globalKnowledge = await prisma.globalKnowledge.findMany();
  const brandContext = buildBrandDocumentsBlock(project.documents);
  const knowledgeContext = buildGlobalKnowledgeBlock(globalKnowledge, 'video');

  const saintGraalContent = saintGraal.content
    ? Buffer.from(saintGraal.content, 'base64').toString('utf-8')
    : '(content not available)';

  const stablePrefix = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}

SAINT GRAAL DOCUMENT (full content):
${saintGraalContent}`;

  const variableSuffix = `VIDEO FORMAT: ${format}
TARGET LENGTH: ${length}

─────────────────────────────────────────────
TASK
─────────────────────────────────────────────
Read the Saint Graal document above carefully.
Extract and propose EVERY distinct video ad angle, narrative, pain point, or positioning strategy you find in it.
Do not limit yourself — if there are 8, output 8. If there are 15, output 15. Cover all of them.
Then, if you see powerful angles that the document implies but does not explicitly state, add those too — label them "(implied)".

For each angle, output:
**[NUMBER]. [ANGLE NAME]**
- Core idea: [one sentence]
- Why it works: [psychological mechanism]
- Hook preview: [first 2-3 seconds in words]

Make them diverse: mix pain points, mechanism, results, social proof, story, comparison. Aggressive US direct response only.`;

  const anthropic = getAnthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const messageStream = anthropic.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: buildCachedUserContent(stablePrefix, variableSuffix),
          }],
        });

        for await (const chunk of messageStream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(encoder.encode(sse('text', { text: chunk.delta.text })));
          }
        }

        controller.enqueue(encoder.encode(sse('done', {})));
        controller.close();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[video-angles stream] ERROR:', message);
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
