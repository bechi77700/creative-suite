import { NextResponse } from 'next/server';
import { generateImage, isKieConfigured } from '@/lib/kie';
import { mirrorRemoteImageToR2, uploadBase64ToR2, isR2Configured } from '@/lib/r2';
import { prisma } from '@/lib/prisma';

export const maxDuration = 120;

// Supported models — kie.ai. Phase 1 keeps the 3 nano-banana variants we
// actually use in production. Add more (flux, midjourney, etc.) once Phase 1
// is validated.
//
// kie's API is unified: same /jobs/createTask endpoint, model picked via the
// "model" body field. Reference images are passed as PUBLIC URLs (kie does
// not accept base64 data URIs), so we upload base64 refs to R2 first.
const MODEL_MAP: Record<
  string,
  { id: string; supportsRefImage: boolean; requiresRefImage: boolean }
> = {
  'nano-banana': {
    id: 'google/nano-banana',
    supportsRefImage: true,
    requiresRefImage: false,
  },
  'nano-banana-2': {
    id: 'nano-banana-2',
    supportsRefImage: true,
    requiresRefImage: false,
  },
  'nano-banana-pro': {
    id: 'nano-banana-pro',
    supportsRefImage: true,
    requiresRefImage: false,
  },
};

export async function POST(req: Request) {
  try {
    if (!isKieConfigured()) {
      return NextResponse.json({ error: 'KIE_API_KEY env var not set on the server' }, { status: 500 });
    }
    if (!isR2Configured()) {
      // R2 is now MANDATORY: we need it both to upload reference images
      // (kie requires public URLs) and to mirror generated images (kie
      // URLs expire in ~24h).
      return NextResponse.json(
        { error: 'R2 storage is not configured — required for kie.ai integration (reference image uploads + result mirroring)' },
        { status: 500 },
      );
    }

    const body = await req.json();
    const {
      prompt,
      model = 'nano-banana-2',
      referenceImageBase64,
      referenceMimeType,
      referenceImages,
      feedback,
      projectId,
    }: {
      prompt: string;
      model?: string;
      referenceImageBase64?: string;
      referenceMimeType?: string;
      referenceImages?: Array<{ base64: string; mimeType?: string }>;
      feedback?: string;
      projectId?: string;
    } = body;

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const modelConfig = MODEL_MAP[model];
    if (!modelConfig) {
      return NextResponse.json({ error: `Unknown model: ${model}` }, { status: 400 });
    }

    // Normalize: collect every reference image (new array shape + legacy single fields)
    const refs: Array<{ base64: string; mimeType: string }> = [];
    if (Array.isArray(referenceImages)) {
      for (const r of referenceImages) {
        if (r?.base64) refs.push({ base64: r.base64, mimeType: r.mimeType || 'image/jpeg' });
      }
    }
    if (referenceImageBase64) {
      refs.push({ base64: referenceImageBase64, mimeType: referenceMimeType || 'image/jpeg' });
    }

    if (modelConfig.requiresRefImage && refs.length === 0) {
      return NextResponse.json(
        { error: 'This model requires a reference image' },
        { status: 400 },
      );
    }

    // Build the final prompt: original + feedback if provided
    const finalPrompt = feedback?.trim()
      ? `${prompt}\n\nUSER FEEDBACK ON PREVIOUS GENERATION (apply these corrections):\n${feedback}`
      : prompt;

    // Detect Meta-spec aspect ratio from the prompt and pass it to kie
    // explicitly. Otherwise kie defaults to "auto" and the model can output
    // off-spec ratios (16:9 etc.) even when the prompt says "4:5". The
    // STATIC_PRODUCT_RULE forces Claude to declare 4:5, 9:16, or 1:1 at
    // the start — we scan for it here.
    const aspectMatch = finalPrompt.match(/\b(4:5|9:16|1:1)\b/);
    const detectedAspect = aspectMatch?.[1] as '4:5' | '9:16' | '1:1' | undefined;

    // Step 1: upload reference images to R2 → get public URLs for kie.
    // We store refs under a separate prefix so we can clean them up later
    // if needed (results live under projects/<id>/).
    const refPrefix = projectId ? `projects/${projectId}/refs` : 'refs';
    let imageUrls: string[] | undefined;
    if (refs.length > 0 && modelConfig.supportsRefImage) {
      imageUrls = await Promise.all(
        refs.map((r) => uploadBase64ToR2(r.base64, r.mimeType, refPrefix)),
      );
      console.log(`[generate/image] uploaded ${imageUrls.length} ref image(s) to R2`);
    }

    console.log('[generate/image] → kie', {
      model: modelConfig.id,
      hasRef: refs.length > 0,
      refCount: refs.length,
    });

    // Step 2: submit the kie job and poll until completion.
    const kieUrl = await generateImage(modelConfig.id, {
      prompt: finalPrompt,
      imageUrls,
      aspectRatio: detectedAspect,
    });

    // Step 3: mirror the kie result to R2 (kie URLs expire in ~24h).
    const r2Prefix = projectId ? `projects/${projectId}` : 'images';
    const persistedUrl = await mirrorRemoteImageToR2(kieUrl, r2Prefix);
    const mirrored = persistedUrl !== kieUrl;
    if (mirrored) {
      console.log(`[generate/image] mirrored to R2: ${persistedUrl}`);
    }

    // Persist a Generation row so the image shows up in the History page.
    let generationId: string | undefined;
    if (projectId) {
      try {
        const gen = await prisma.generation.create({
          data: {
            projectId,
            module: 'static-image',
            inputs: JSON.stringify({
              prompt,
              model: modelConfig.id,
              hasRef: refs.length > 0,
              refCount: refs.length,
              feedback: feedback || undefined,
              mirrored,
              provider: 'kie',
            }),
            output: persistedUrl,
          },
        });
        generationId = gen.id;
      } catch (dbErr) {
        console.warn('[generate/image] failed to persist Generation row:', dbErr);
      }
    }

    return NextResponse.json({ imageUrl: persistedUrl, model: modelConfig.id, generationId, mirrored });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[generate/image] ERROR:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
