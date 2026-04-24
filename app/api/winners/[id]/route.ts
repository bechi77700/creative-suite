import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// DELETE /api/winners/[id] — remove a winner row by id (used from the
// Winners library page).
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await prisma.winner.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
