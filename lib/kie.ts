// kie.ai client — async createTask + poll pattern.
//
// Replaces the previous fal.ai integration. Same role: take a prompt
// (+ optional reference image URLs) and return a generated image URL.
//
// Differences vs fal:
//   - Reference images MUST be public URLs (data URIs not supported).
//     Callers should upload base64 refs to R2 first and pass the URLs.
//   - The API is async: POST createTask returns a taskId, then we poll
//     GET recordInfo until state === 'success' (or 'fail').
//   - Generated URLs expire in ~24h, so callers should mirror to R2.

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_KEY = process.env.KIE_API_KEY;

export function isKieConfigured(): boolean {
  return !!KIE_KEY;
}

export interface KieCreateTaskInput {
  prompt: string;
  imageUrls?: string[]; // public URLs (max 14 for nano-banana-2)
  aspectRatio?: string; // e.g. '1:1', '9:16', 'auto'
  resolution?: '1K' | '2K' | '4K';
  outputFormat?: 'png' | 'jpg';
}

export interface KieCreateTaskResult {
  taskId: string;
}

export interface KieTaskStatus {
  state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail';
  resultUrls?: string[];
  failCode?: string;
  failMsg?: string;
}

function authHeaders(): Record<string, string> {
  if (!KIE_KEY) throw new Error('KIE_API_KEY env var not set on the server');
  return {
    Authorization: `Bearer ${KIE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Submit a generation job. Returns the taskId — caller must poll.
 */
export async function createTask(
  model: string,
  input: KieCreateTaskInput,
): Promise<KieCreateTaskResult> {
  const body = {
    model,
    input: {
      prompt: input.prompt,
      ...(input.imageUrls && input.imageUrls.length > 0 ? { image_input: input.imageUrls } : {}),
      ...(input.aspectRatio ? { aspect_ratio: input.aspectRatio } : {}),
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.outputFormat ? { output_format: input.outputFormat } : {}),
    },
  };

  const res = await fetch(`${KIE_BASE}/jobs/createTask`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
  });

  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`kie.createTask HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  const data = json as { code?: number; msg?: string; data?: { taskId?: string } };
  if (data.code !== 200 || !data.data?.taskId) {
    throw new Error(`kie.createTask failed: ${data.msg || JSON.stringify(json)}`);
  }
  return { taskId: data.data.taskId };
}

/**
 * Fetch a single task snapshot. Throws on HTTP / API error.
 */
export async function getTaskStatus(taskId: string): Promise<KieTaskStatus> {
  const url = `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${KIE_KEY}` },
  });

  const json: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`kie.getTaskStatus HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  const data = json as {
    code?: number;
    msg?: string;
    data?: { state?: string; resultJson?: string; failCode?: string; failMsg?: string };
  };
  if (data.code !== 200 || !data.data) {
    throw new Error(`kie.getTaskStatus failed: ${data.msg || JSON.stringify(json)}`);
  }

  const state = (data.data.state || 'waiting') as KieTaskStatus['state'];
  let resultUrls: string[] | undefined;
  if (data.data.resultJson) {
    try {
      const parsed = JSON.parse(data.data.resultJson) as { resultUrls?: string[] };
      resultUrls = parsed.resultUrls;
    } catch {
      // ignore — leave resultUrls undefined
    }
  }
  return {
    state,
    resultUrls,
    failCode: data.data.failCode,
    failMsg: data.data.failMsg,
  };
}

/**
 * Poll until the task reaches a terminal state (success / fail) or the
 * timeout elapses. Returns the final status.
 *
 * Defaults: poll every 2s, up to 110s (we run inside a Next route with
 * maxDuration = 120s, so we leave headroom for the rest of the work).
 */
export async function pollTask(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<KieTaskStatus> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 110_000;
  const deadline = Date.now() + timeoutMs;

  // Tiny initial delay — most generations need a few seconds anyway.
  await new Promise((r) => setTimeout(r, 1500));

  while (Date.now() < deadline) {
    const status = await getTaskStatus(taskId);
    if (status.state === 'success' || status.state === 'fail') return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`kie.pollTask timeout after ${timeoutMs}ms (taskId=${taskId})`);
}

/**
 * Convenience: create + poll + return the first result URL.
 */
export async function generateImage(
  model: string,
  input: KieCreateTaskInput,
): Promise<string> {
  const { taskId } = await createTask(model, input);
  const status = await pollTask(taskId);
  if (status.state !== 'success') {
    throw new Error(`kie task failed: ${status.failCode || ''} ${status.failMsg || ''}`.trim());
  }
  const url = status.resultUrls?.[0];
  if (!url) throw new Error('kie task succeeded but returned no resultUrls');
  return url;
}
