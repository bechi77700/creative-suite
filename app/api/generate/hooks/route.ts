import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAnthropic, MODEL, GENERATION_RULES } from '@/lib/anthropic';

export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, mode, script, instructions } = body;
  // Clamp count to a sane range; default to 12 for backward compat.
  const requestedCount = Number(body.count);
  const count = Number.isFinite(requestedCount)
    ? Math.min(48, Math.max(1, Math.round(requestedCount)))
    : 12;

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

  const modeSection =
    mode === 'from_script'
      ? `MODE: From existing script\n\nSCRIPT:\n${script}`
      : `MODE: From brand knowledge only (no script provided)`;

  const instructionsSection = instructions?.trim()
    ? `\nUSER INSTRUCTIONS (mandatory — apply these to the generation):\n${instructions}`
    : '';

  const prompt = `${GENERATION_RULES}

BRAND: ${project.name}
GLOBAL KNOWLEDGE: ${knowledgeContext || '(none)'}
BRAND DOCS: ${brandContext || '(none)'}

${modeSection}${instructionsSection}

Generate ${count} diverse hook ideas for Meta Ads cold traffic. Mix of:
- Written hooks (on-screen text / spoken opening lines)
- Visual hook ideas (what the camera shows in the first 2 seconds)

HOOK RULES:
- Full creative freedom: WTF, serious, original, provocative, emotional — all valid
- Goal: pattern interrupt + stop scroll in 2 seconds
- No self-censorship
- Make them feel impossible to scroll past

For EACH hook output exactly:

**[NUMBER]. [HOOK TEXT or VISUAL DESCRIPTION]**
Type: [Written Hook / Visual Hook]
Stop Scroll Potential: [1-10]/10
Originality: [1-10]/10
Why it works: [one line psychological explanation]

---

No preamble. Start directly with Hook #1.`;

  // ~200 tokens per hook is a generous budget for the structured output above.
  const maxTokens = Math.min(8000, Math.max(1500, count * 220));

  const response = await getAnthropic().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });

  const output = (response.content[0] as { type: string; text: string }).text;

  const generation = await prisma.generation.create({
    data: {
      projectId,
      module: 'hook',
      inputs: JSON.stringify(body),
      output,
    },
  });

  return NextResponse.json({ output, generationId: generation.id });
}
