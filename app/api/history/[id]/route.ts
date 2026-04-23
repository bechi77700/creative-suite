import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  try {
    await prisma.generation.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
