import { NextResponse } from 'next/server';

// Server-side proxy that lets the browser download an image with a real
// "Save As" dialog instead of opening it in a new tab. The client-side
// fetch() approach fails on cross-origin URLs (R2's pub-*.r2.dev, Fal's
// fal.media) because they don't send permissive CORS headers — but a
// server-to-server fetch has no such restriction.
//
// Usage: GET /api/download-image?url=<encoded-url>&filename=<optional>
//
// SSRF guard: only allow URLs that match an allow-list of hosts we own
// or trust, so this route can't be abused to fetch arbitrary internal
// resources.

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_HOST_SUFFIXES = [
  '.r2.dev',                  // Cloudflare R2 public dev URLs
  '.r2.cloudflarestorage.com', // R2 S3-style URLs
  '.fal.media',                // Fal-hosted (legacy fallback)
  'fal.media',
  '.aiquickdraw.com',          // KIE.AI hosted (in case we switch later)
];

function isAllowed(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return ALLOWED_HOST_SUFFIXES.some((suffix) =>
      suffix.startsWith('.') ? u.hostname.endsWith(suffix) : u.hostname === suffix,
    );
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');
  const filename = searchParams.get('filename') || `generated-${Date.now()}.png`;

  if (!url) {
    return NextResponse.json({ error: 'Missing "url" parameter' }, { status: 400 });
  }
  if (!isAllowed(url)) {
    return NextResponse.json({ error: 'URL host is not in the allow-list' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Upstream fetch failed: ${msg}` }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
  }

  const contentType = upstream.headers.get('content-type') || 'image/png';
  // Sanitize filename for the Content-Disposition header.
  const safeName = filename.replace(/[^\w.\-]/g, '_').slice(0, 120);

  return new Response(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=60',
    },
  });
}
