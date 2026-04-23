import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  _: Request,
  { params }: { params: { id: string; docId: string } }
) {
  await prisma.brandDocument.delete({ where: { id: params.docId } });
  return NextResponse.json({ ok: true });
}
