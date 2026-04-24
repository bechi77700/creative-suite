import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// GET /api/winners?projectId=xxx&type=hook|video_script|static|iterate
// List winners for a project, optionally filtered by asset type.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');
  const type = searchParams.get('type');

  if (!projectId) {
    return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  }

  const winners = await prisma.winner.findMany({
    where: {
      projectId,
      ...(type ? { assetType: type } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(winners);
}

// POST /api/winners — create or replace a winner for a given (generationId, assetKey)
// Body: { projectId, generationId, assetType, assetKey, content, imageUrl?, meta? }
export async function POST(req: Request) {
  const body = await req.json();
  const { projectId, generationId, assetType, assetKey, content, imageUrl, meta } = body;

  if (!projectId || !assetType || !assetKey || (typeof content !== 'string')) {
    return NextResponse.json(
      { error: 'projectId, assetType, assetKey and content are required' },
      { status: 400 },
    );
  }

  // Upsert keyed on (generationId, assetKey). When generationId is null we
  // can't enforce the unique key — fall back to plain create so multiple
  // standalone winners can coexist.
  if (generationId) {
    const winner = await prisma.winner.upsert({
      where: {
        generationId_assetKey: { generationId, assetKey },
      },
      create: {
        projectId,
        generationId,
        assetType,
        assetKey,
        content,
        imageUrl: imageUrl || null,
        meta: meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
      },
      update: {
        content,
        imageUrl: imageUrl || null,
        meta: meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
      },
    });
    return NextResponse.json(winner);
  }

  const winner = await prisma.winner.create({
    data: {
      projectId,
      assetType,
      assetKey,
      content,
      imageUrl: imageUrl || null,
      meta: meta ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
    },
  });
  return NextResponse.json(winner);
}

// DELETE /api/winners?generationId=xxx&assetKey=yyy — remove a single winner
// without needing its row id (handy when toggling from a generation page).
export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const generationId = searchParams.get('generationId');
  const assetKey = searchParams.get('assetKey');

  if (!generationId || !assetKey) {
    return NextResponse.json(
      { error: 'generationId and assetKey required' },
      { status: 400 },
    );
  }

  await prisma.winner.deleteMany({
    where: { generationId, assetKey },
  });
  return NextResponse.json({ ok: true });
}
