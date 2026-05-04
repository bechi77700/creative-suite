// fal.ai client — fallback image generator.
//
// Used as a safety net when kie.ai's queue ghosts a task. fal hosts the
// same nano-banana variants and has been historically much more reliable
// on queue health, so when kie can't deliver we transparently retry on
// fal — same model family, similar quality, no user-visible failure.
//
// kie remains the primary because it's cheaper. fal kicks in only when
// kie throws KieStuckInWaitingError after exhausting retries.

import { fal } from '@fal-ai/client';

const FAL_KEY = process.env.FAL_KEY;
let configured = false;

function ensureConfigured() {
  if (configured) return;
  if (!FAL_KEY) throw new Error('FAL_KEY env var not set on the server');
  fal.config({ credentials: FAL_KEY });
  configured = true;
}

export function isFalConfigured(): boolean {
  return !!FAL_KEY;
}

// Map our internal model names → fal endpoints. The /edit variant is used
// when reference images are provided (multi-ref via image_urls[]), the
// plain endpoint is used for text-only.
const FAL_MODEL_MAP: Record<string, { id: string; editId?: string }> = {
  'nano-banana': {
    id: 'fal-ai/nano-banana',
    editId: 'fal-ai/nano-banana/edit',
  },
  'nano-banana-2': {
    id: 'fal-ai/nano-banana-2',
    editId: 'fal-ai/nano-banana-2/edit',
  },
  'nano-banana-pro': {
    id: 'fal-ai/nano-banana-pro',
    editId: 'fal-ai/nano-banana-pro/edit',
  },
  // kie's "google/nano-banana" id maps to fal's nano-banana original.
  'google/nano-banana': {
    id: 'fal-ai/nano-banana',
    editId: 'fal-ai/nano-banana/edit',
  },
};

export interface FalGenerateInput {
  prompt: string;
  /**
   * Reference images as PUBLIC URLs (we already upload to R2 for kie, so
   * we reuse the same URLs). fal also accepts data URIs but URLs are
   * lighter on the request body.
   */
  imageUrls?: string[];
}

/**
 * Generate an image via fal. Throws on failure. Returns the fal-hosted
 * URL — caller should mirror to R2 (same as the kie path).
 */
export async function generateImageFal(
  internalModel: string,
  input: FalGenerateInput,
): Promise<string> {
  ensureConfigured();

  const config = FAL_MODEL_MAP[internalModel] || FAL_MODEL_MAP['nano-banana-2'];
  const hasRef = !!(input.imageUrls && input.imageUrls.length > 0);
  const endpointId = hasRef && config.editId ? config.editId : config.id;

  const payload: Record<string, unknown> = { prompt: input.prompt };
  if (hasRef) {
    payload.image_urls = input.imageUrls;
  }

  console.log(`[fal] → ${endpointId}`, { hasRef, refCount: input.imageUrls?.length ?? 0 });

  const result = await fal.subscribe(endpointId, {
    input: payload,
    logs: false,
  });

  const data = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
  const url = data.images?.[0]?.url || data.image?.url;
  if (!url) {
    throw new Error(`fal returned no image URL (model=${endpointId})`);
  }
  return url;
}
