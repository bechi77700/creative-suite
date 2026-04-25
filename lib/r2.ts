// Cloudflare R2 upload helper. R2 is S3-compatible, so we use the AWS SDK
// pointed at the R2 endpoint. Used to mirror Fal.ai-generated images so we
// own a permanent copy (Fal URLs aren't guaranteed forever, and we want to
// show generated images in the History page).

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';

const ENDPOINT = process.env.R2_ENDPOINT;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET;
const PUBLIC_URL = process.env.R2_PUBLIC_URL;

export function isR2Configured(): boolean {
  return !!(ENDPOINT && ACCESS_KEY_ID && SECRET_ACCESS_KEY && BUCKET && PUBLIC_URL);
}

let _client: S3Client | null = null;
function getClient(): S3Client {
  if (!isR2Configured()) {
    throw new Error('R2 is not fully configured (missing R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET or R2_PUBLIC_URL).');
  }
  if (!_client) {
    _client = new S3Client({
      region: 'auto',
      endpoint: ENDPOINT,
      credentials: {
        accessKeyId: ACCESS_KEY_ID!,
        secretAccessKey: SECRET_ACCESS_KEY!,
      },
    });
  }
  return _client;
}

function extFromMime(mime: string | undefined): string {
  if (!mime) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  return 'png';
}

/**
 * Uploads a Buffer to R2 and returns the public URL.
 * `prefix` is a folder path inside the bucket (e.g. "projects/abc123").
 */
export async function uploadBufferToR2(
  buffer: Buffer,
  contentType: string,
  prefix = 'images',
): Promise<string> {
  const client = getClient();
  const ext = extFromMime(contentType);
  const key = `${prefix.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${randomUUID()}.${ext}`;

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Long cache — these images are immutable (random filename per upload).
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );

  return `${PUBLIC_URL!.replace(/\/+$/, '')}/${key}`;
}

/**
 * Downloads an image from a remote URL (e.g. Fal.ai) and mirrors it to R2.
 * Returns the new R2 URL. Falls back to the source URL if R2 is not
 * configured (so the app keeps working in dev without R2 envs set).
 */
export async function mirrorRemoteImageToR2(
  sourceUrl: string,
  prefix = 'images',
): Promise<string> {
  if (!isR2Configured()) return sourceUrl;
  try {
    const res = await fetch(sourceUrl);
    if (!res.ok) {
      console.warn(`[r2.mirror] source fetch failed (${res.status}) for ${sourceUrl} — keeping source URL`);
      return sourceUrl;
    }
    const contentType = res.headers.get('content-type') || 'image/png';
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await uploadBufferToR2(buffer, contentType, prefix);
  } catch (err) {
    console.warn('[r2.mirror] failed, falling back to source URL:', err);
    return sourceUrl;
  }
}
