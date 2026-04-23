import { NextResponse } from 'next/server';
import { fal } from '@fal-ai/client';

export const maxDuration = 120;

const FAL_KEY = process.env.FAL_KEY;
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

// Supported models — keep in sync with the dropdown on the frontend
const MODEL_MAP: Record<string, { id: string; supportsRefImage: boolean; requiresRefImage: boolean }> = {
  'nano-banana': { id: 'fal-ai/nano-banana', supportsRefImage: false, requiresRefImage: false },
  'nano-banana-edit': { id: 'fal-ai/nano-banana/edit', supportsRefImage: true, requiresRefImage: true },
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

    // Build the input payload depending on the model
    const input: Record<string, unknown> = { prompt: finalPrompt };

    if (modelConfig.supportsRefImage && referenceImageBase64) {
      const dataUri = `data:${referenceMimeType || 'image/jpeg'};base64,${referenceImageBase64}`;
      // nano-banana/edit uses image_urls (array)
      if (model === 'nano-banana-edit') {
        input.image_urls = [dataUri];
      } else {
        input.image_url = dataUri;
      }
    }

    const result = await fal.subscribe(modelConfig.id, {
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
