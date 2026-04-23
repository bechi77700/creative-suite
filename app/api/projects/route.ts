import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const projects = await prisma.brandProject.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { documents: true, generations: true } },
    },
  });
  return NextResponse.json(projects);
}

export async function POST(req: Request) {
  const { name } = await req.json();
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });
  const project = await prisma.brandProject.create({ data: { name: name.trim() } });
  return NextResponse.json(project, { status: 201 });
}
