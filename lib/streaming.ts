/**
 * Parse a stream of Server-Sent Events. Yields one event object per `\n\n`-terminated block.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = rawEvent.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) {
          try {
            yield { event, data: JSON.parse(data) };
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Safe wrappers for ReadableStream controller operations. Without these,
 * any post-close operation (e.g. client disconnected mid-stream and we
 * try to send a final event) throws "Invalid state: Controller is
 * already closed" — which then bubbles into the catch block and tries
 * to enqueue an error event, which throws the same error, etc. The
 * symptom on the client is a successful generation marked as failed.
 */
export function safeEnqueue(
  controller: ReadableStreamDefaultController,
  chunk: Uint8Array,
): boolean {
  try {
    controller.enqueue(chunk);
    return true;
  } catch {
    return false;
  }
}

export function safeClose(controller: ReadableStreamDefaultController): void {
  try {
    controller.close();
  } catch {
    // already closed — no-op
  }
}

/**
 * Extract all CLOSED triple-backtick code blocks from a (possibly partial) markdown string.
 * Returns the inner text of each closed block, in order.
 */
export function extractClosedCodeBlocks(text: string): string[] {
  const regex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1].trim());
  }
  return out;
}
