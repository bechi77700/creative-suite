import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';

export async function POST(req: Request) {
  try {
  const body = await req.json();
  const { projectId, format, length, angle, additionalContext, previousOutput, feedback } = body;

  const project = await prisma.brandProject.findUnique({
    where: { id: projectId },
    include: { documents: true },
  });
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  if (!project.documents.some((d) => d.type === 'saint_graal_doc')) {
    return NextResponse.json({ error: 'Saint Graal document required before generating.' }, { status: 403 });
  }

  const globalKnowledge = await prisma.globalKnowledge.findMany();
  const brandContext = project.documents.map((d) => `[${d.type.toUpperCase()} — ${d.name}]`).join('\n');
  const knowledgeContext = globalKnowledge.map((k) => `[${k.category.toUpperCase()} — ${k.name}]`).join('\n');

  const wordCount = getApproxWordCount(length);

  const refineSection = previousOutput && feedback?.trim()
    ? `

─────────────────────────────────────────────
REFINEMENT MODE
─────────────────────────────────────────────
You already wrote the script below. Rewrite it applying the user's feedback.
Keep the same hook → body → CTA structure. Keep what works. Only change what
the feedback explicitly asks for, plus surrounding lines that need to flow.

PREVIOUS SCRIPT:
${previousOutput}

USER FEEDBACK (apply these corrections):
${feedback}

Output the FULL rewritten script in the same OUTPUT FORMAT below. Do not
prepend any commentary about what changed.`
    : '';

  const prompt = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}

VIDEO FORMAT: ${format}
TARGET LENGTH: ${length} (~${wordCount} words of spoken script)
ANGLE: ${angle}
${additionalContext ? `ADDITIONAL CONTEXT: ${additionalContext}` : ''}
${refineSection}

Write a complete, ready-to-shoot video ad script.

RULES:
- NO editor instructions, no camera directions, no "[cut to]" — pure spoken words and on-screen text only
- Aggressive US direct response — pain points pushed to maximum
- Hook must stop scroll in the first 2 seconds
- CTA is direct and urgent
- Structure clearly with: HOOK / BODY / CTA sections

OUTPUT FORMAT:

## HOOK
[spoken words for the first 2-3 seconds — the pattern interrupt]

## BODY
[the full body of the script]

## CTA
[the closing call to action]

---
*Approximate word count: ${wordCount} words*`;

  const response = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
  });

  const output = (response.content[0] as { type: string; text: string }).text;

  const generation = await prisma.generation.create({
    data: {
      projectId,
      module: 'video',
      inputs: JSON.stringify(body),
      output,
    },
  });

  return NextResponse.json({ output, generationId: generation.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[video-script] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getApproxWordCount(length: string): string {
  const map: Record<string, string> = {
    '7-15s': '20-40',
    '15-30s': '40-75',
    '30-45s': '75-110',
    '45-60s': '110-150',
    '60-90s': '150-225',
    '90-120s': '225-300',
    '2-3 min': '300-450',
    '3-5 min': '450-750',
  };
  return map[length] || '100-200';
}
