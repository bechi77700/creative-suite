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
 * Defaults: poll every 2s, up to 280s (we run inside a Next route with
 * maxDuration = 300s, so we leave headroom for the rest of the work).
 * nano-banana-2 with multiple reference images can sit in queue +
 * generate for 1-2 min, so the previous 110s ceiling was too tight.
 *
 * The thrown timeout error includes the last seen state so the caller
 * can surface useful debug info (queuing vs generating vs stuck).
 */
/**
 * Thrown when a task never leaves the 'waiting' state — kie's queue
 * occasionally creates ghost tasks that sit forever. The caller can
 * catch this specifically to retry with a fresh taskId.
 */
export class KieStuckInWaitingError extends Error {
  constructor(public readonly taskId: string, public readonly stuckMs: number) {
    super(
      `kie task stuck in 'waiting' state for ${stuckMs}ms (taskId=${taskId}) — likely a ghost task in the queue`,
    );
    this.name = 'KieStuckInWaitingError';
  }
}

/**
 * Thrown when a kie task actually ran and returned state === 'fail'. This is
 * a HARD failure (the model itself refused / errored / produced no image) —
 * retrying with the same prompt won't help. Surface immediately.
 */
export class KieTaskFailedError extends Error {
  constructor(public readonly taskId: string, public readonly failCode?: string, public readonly failMsg?: string) {
    super(`kie task failed: ${failCode || ''} ${failMsg || ''}`.trim());
    this.name = 'KieTaskFailedError';
  }
}

export async function pollTask(
  taskId: string,
  opts: { intervalMs?: number; timeoutMs?: number; stuckWaitingThresholdMs?: number } = {},
): Promise<KieTaskStatus> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 280_000;
  // If the task never transitions out of 'waiting' after this long, treat
  // it as a ghost (kie queue bug) and throw KieStuckInWaitingError so the
  // caller can retry with a fresh taskId. Real tasks usually move
  // waiting → queuing within 5-15s under normal load, but kie's queue can
  // sit in waiting for 60-90s under pressure — 120s is the new floor.
  // Callers (generateImage) override this; the default here matches.
  const stuckWaitingThresholdMs = opts.stuckWaitingThresholdMs ?? 120_000;
  const deadline = Date.now() + timeoutMs;
  const startedAt = Date.now();

  // Tiny initial delay — most generations need a few seconds anyway.
  await new Promise((r) => setTimeout(r, 1500));

  let lastState: string = 'unknown';
  let leftWaitingAt: number | null = null;
  while (Date.now() < deadline) {
    const status = await getTaskStatus(taskId);
    lastState = status.state;
    if (status.state !== 'waiting' && leftWaitingAt === null) {
      leftWaitingAt = Date.now();
    }
    if (status.state === 'success' || status.state === 'fail') return status;

    // Stuck-in-waiting detection: bail early so the caller can retry with
    // a brand new task instead of burning the whole 280s budget.
    if (leftWaitingAt === null && Date.now() - startedAt > stuckWaitingThresholdMs) {
      throw new KieStuckInWaitingError(taskId, Date.now() - startedAt);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `kie.pollTask timeout after ${timeoutMs}ms (taskId=${taskId}, lastState=${lastState})`,
  );
}

/**
 * Convenience: create + poll + return the first result URL.
 *
 * Retries on ANY transient error — the only hard-failure that bubbles
 * immediately is `KieTaskFailedError` (the task was successfully created,
 * ran, and returned state === 'fail'). Everything else is treated as
 * transient and retried:
 *   - KieStuckInWaitingError (ghost task in the queue)
 *   - HTTP 502 / 503 / 504 from kie's API or our Railway proxy
 *   - createTask returning `code !== 200` (e.g. "422 generate playground
 *     failed, task id is blank" — kie's queue choking under load)
 *   - Network errors, fetch failures, timeouts
 *
 * A short backoff (3s) is added between attempts so we don't slam kie
 * if it's rate-limiting.
 *
 * Budget: 270s total across up to 3 attempts. Each attempt has a 120s
 * stuck-detection window. The previous version retried only on the
 * single ghost case and produced visible "task id is blank" / "Error
 * 502" errors to the user — those are now caught + retried internally.
 */
export async function generateImage(
  model: string,
  input: KieCreateTaskInput,
): Promise<string> {
  const TOTAL_BUDGET_MS = 270_000;
  const STUCK_THRESHOLD_MS = 120_000;
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = 3000;
  const startedAt = Date.now();

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - startedAt);
    // Need enough headroom for stuck detection + a real generation,
    // otherwise we're just going to time out anyway.
    if (remaining < 60_000) break;

    try {
      const { taskId } = await createTask(model, input);
      console.log(`[kie] attempt ${attempt}/${MAX_ATTEMPTS} taskId=${taskId}`);
      const status = await pollTask(taskId, {
        timeoutMs: remaining,
        stuckWaitingThresholdMs: STUCK_THRESHOLD_MS,
      });
      if (status.state !== 'success') {
        // Successful task creation + run, but model returned a fail state.
        // This is a HARD failure — retrying with the same prompt won't help.
        throw new KieTaskFailedError(taskId, status.failCode, status.failMsg);
      }
      const url = status.resultUrls?.[0];
      if (!url) throw new Error('kie task succeeded but returned no resultUrls');
      return url;
    } catch (err) {
      const e = err as Error;
      lastErr = e;

      // Hard failure — surface immediately, don't waste retry budget.
      if (e instanceof KieTaskFailedError) throw e;

      // Everything else is transient (stuck ghost, createTask code != 200,
      // HTTP 502/503/504, fetch error, etc.). Retry with a short backoff
      // so we don't hammer kie if it's rate-limiting.
      const isLastAttempt = attempt === MAX_ATTEMPTS;
      if (isLastAttempt) {
        console.warn(`[kie] attempt ${attempt}/${MAX_ATTEMPTS} failed (last attempt): ${e.message}`);
        break;
      }
      console.warn(
        `[kie] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message} — retrying after ${BACKOFF_MS}ms`,
      );
      await new Promise((r) => setTimeout(r, BACKOFF_MS));
    }
  }
  throw lastErr || new Error('kie.generateImage exhausted retries');
}
