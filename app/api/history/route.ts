import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  const generations = await prisma.generation.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(generations);
}
