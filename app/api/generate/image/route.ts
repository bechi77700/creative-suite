import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export const maxDuration = 120;

const FAL_KEY = process.env.FAL_KEY;
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

// Supported models — keep in sync with the dropdown on the frontend
// Model config:
// - id: text-to-image endpoint (used when no reference image is provided)
// - editId: image-editing endpoint (used when a reference image IS provided) — optional
// - supportsRefImage: true if editId exists OR id directly accepts image_urls
// - requiresRefImage: must have a ref image to call (the model has no text-only fallback)
const MODEL_MAP: Record<
  string,
  { id: string; editId?: string; supportsRefImage: boolean; requiresRefImage: boolean }
> = {
  'nano-banana': {
    id: 'fal-ai/nano-banana',
    editId: 'fal-ai/nano-banana/edit',
    supportsRefImage: true,
    requiresRefImage: false,
  },
  'nano-banana-2': {
    id: 'fal-ai/nano-banana-2',
    editId: 'fal-ai/nano-banana-2/edit',
    supportsRefImage: true,
    requiresRefImage: false,
  },
  'nano-banana-pro': {
    id: 'fal-ai/nano-banana-pro',
    editId: 'fal-ai/nano-banana-pro/edit',
    supportsRefImage: true,
    requiresRefImage: false,
  },
  'flux-pro-ultra': { id: 'fal-ai/flux-pro/v1.1-ultra', supportsRefImage: false, requiresRefImage: false },
  'recraft-v3': { id: 'fal-ai/recraft-v3', supportsRefImage: false, requiresRefImage: false },
  'imagen4': { id: 'fal-ai/imagen4/preview', supportsRefImage: false, requiresRefImage: false },
};

export async function POST(req: Request) {
  try {
    if (!FAL_KEY) {
      return NextResponse.json({ error: 'FAL_KEY env var not set on the server' }, { status: 500 });
    }

    const body = await req.json();
    const {
      prompt,
      model = 'nano-banana',
      referenceImageBase64,
      referenceMimeType,
      feedback,
    }: {
      prompt: string;
      model?: string;
      referenceImageBase64?: string;
      referenceMimeType?: string;
      feedback?: string;
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const modelConfig = MODEL_MAP[model];
    if (!modelConfig) {
      return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });
    }

    if (modelConfig.requiresRefImage && !referenceImageBase64) {
      return NextResponse.json(
        { error: 'This model requires a reference image' },
        { status: 400 },
      );
    }

    // Build the final prompt: original + feedback if provided
    const finalPrompt = feedback?.trim()
      ? `${prompt}\n\nUSER FEEDBACK ON PREVIOUS GENERATION (apply these corrections):\n${feedback}`
      : prompt;

    // Decide which endpoint to use:
    //   - If a reference image is provided AND the model has an /edit endpoint → use /edit
    //   - Otherwise → use the text-to-image endpoint
    const hasRef = !!referenceImageBase64;
    const endpointId = hasRef && modelConfig.editId ? modelConfig.editId : modelConfig.id;
    const isEditEndpoint = endpointId.endsWith('/edit') || endpointId.includes('/edit');

    // Build the input payload depending on whether we use the edit endpoint
    const input: Record<string, unknown> = { prompt: finalPrompt };

    if (isEditEndpoint && referenceImageBase64) {
      const dataUri = `data:${referenceMimeType || 'image/jpeg'};base64,${referenceImageBase64}`;
      input.image_urls = [dataUri];
    } else if (hasRef && modelConfig.supportsRefImage && !isEditEndpoint) {
      // Non-nano-banana models that accept a single image_url
      const dataUri = `data:${referenceMimeType || 'image/jpeg'};base64,${referenceImageBase64}`;
      input.image_url = dataUri;
    }

    console.log('[generate/image] →', endpointId, { hasRef, model });

    const result = await fal.subscribe(endpointId, {
      input,
      logs: false,
    });

    // Fal returns different shapes depending on the model — normalize
    const data = result.data as { images?: Array<{ url: string }>; image?: { url: string } };
    const imageUrl = data.images?.[0]?.url || data.image?.url;

    if (!imageUrl) {
      return NextResponse.json(
        { error: 'No image returned by Fal.ai', raw: result.data },
        { status: 500 },
      );
    }

    return NextResponse.json({ imageUrl, model: modelConfig.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[generate/image] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
