import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function PATCH(_: Request, { params }: { params: { id: string } }) {
  const gen = await prisma.generation.findUnique({ where: { id: params.id } });
  if (!gen) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const updated = await prisma.generation.update({
    where: { id: params.id },
    data: { isWinner: !gen.isWinner },
  });
  return NextResponse.json(updated);
}
