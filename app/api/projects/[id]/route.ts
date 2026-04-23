import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const project = await prisma.brandProject.findUnique({
    where: { id: params.id },
    include: { documents: { orderBy: { createdAt: 'desc' } } },
  });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(project);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  await prisma.brandProject.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const type = formData.get('type') as string;

  if (!file || !type) return NextResponse.json({ error: 'file and type required' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const content = buffer.toString('base64');

  const doc = await prisma.brandDocument.create({
    data: {
      projectId: params.id,
      name: file.name,
      type,
      mimeType: file.type,
      content,
      size: file.size,
    },
  });
  return NextResponse.json(doc, { status: 201 });
}
