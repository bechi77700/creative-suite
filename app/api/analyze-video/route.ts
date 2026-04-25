import { NextResponse } from 'next/server';
import { analyzeVideo } from '@/lib/gemini-video';

// We accept multipart/form-data with a single field named "video".
// Max 100 MB. Returns the full VideoAnalysis JSON on success.
export const runtime = 'nodejs';
// 5 min — Gemini transcoding can take 30-90s for videos > 1 min, plus
// upload + analysis. The internal helper has its own 4 min poll cap.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(req: Request) {
  if (!process.env.GOOGLE_AI_API_KEY) {
    return NextResponse.json(
      { error: 'GOOGLE_AI_API_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data with a "video" field' },
      { status: 400 },
    );
  }

  const file = form.get('video');
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "video" file in form data' },
      { status: 400 },
    );
  }

  if (!file.type.startsWith('video/')) {
    return NextResponse.json(
      { error: `Unsupported MIME type "${file.type}". Upload a video file (mp4, mov, webm…).` },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `Video too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 400 },
    );
  }

  const t0 = Date.now();
  try {
    console.log(`[analyze-video] received "${file.name}" — ${(file.size / 1024 / 1024).toFixed(1)} MB, ${file.type}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    const analysis = await analyzeVideo(buffer, file.type);
    console.log(`[analyze-video] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return NextResponse.json(analysis);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error(`[analyze-video] FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e);
    return NextResponse.json(
      { error: `Video analysis failed: ${message}` },
      { status: 500 },
    );
  }
}
