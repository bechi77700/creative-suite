import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const items = await prisma.globalKnowledge.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  const category = formData.get('category') as string;

  if (!file || !category) return NextResponse.json({ error: 'file and category required' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const content = buffer.toString('base64');

  const item = await prisma.globalKnowledge.create({
    data: {
      name: file.name,
      category,
      mimeType: file.type,
      content,
      size: file.size,
    },
  });
  return NextResponse.json(item, { status: 201 });
}
