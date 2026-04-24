// Client-side helpers for the per-asset Winners library.
// Server endpoints live at /api/winners (collection) and /api/winners/[id].

export interface WinnerInput {
  projectId: string;
  generationId?: string;
  assetType: 'hook' | 'video_script' | 'static' | 'iterate';
  assetKey: string;
  content: string;
  imageUrl?: string;
  meta?: Record<string, unknown>;
}

export async function addWinner(input: WinnerInput): Promise<{ id: string } | null> {
  try {
    const res = await fetch('/api/winners', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function removeWinner(generationId: string, assetKey: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/winners?generationId=${encodeURIComponent(generationId)}&assetKey=${encodeURIComponent(assetKey)}`,
      { method: 'DELETE' },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// Parse a markdown block of items where each item starts with `**N. ...**`
// followed by detail lines and an optional `---` separator. Used by both
// hooks and angles output.
export function parseNumberedBlocks(
  md: string,
): Array<{ id: string; index: number; title: string; body: string; full: string }> {
  if (!md) return [];
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const isHeader = /^\*\*\d+\./.test(line.trim());
    if (isHeader && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());

  return blocks
    .filter((b) => /^\*\*\d+\./.test(b.trim()))
    .map((b, i) => {
      // Strip trailing horizontal rule if present.
      const cleaned = b.replace(/\n*-{3,}\s*$/, '').trim();
      const titleMatch = cleaned.match(/^\*\*\d+\.\s*([\s\S]+?)\*\*/);
      const title = titleMatch ? titleMatch[1].trim().replace(/\s+/g, ' ') : `Item ${i + 1}`;
      const body = cleaned.replace(/^\*\*\d+\.[\s\S]+?\*\*\s*\n?/, '').trim();
      return { id: `block-${i}`, index: i, title, body, full: cleaned };
    });
}
