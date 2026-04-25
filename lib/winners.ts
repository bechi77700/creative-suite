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

// Parse a markdown block of items. Recognizes two header formats:
//   1. `**N. title**` — legacy hooks/angles format
//   2. `## Hook N` (or `## Hook N — title`) — clone-hook-from-video SOP
// Each item runs until the next header. Trailing `---` separators are stripped.
const HEADER_RE = /^(?:\*\*\d+\.|##\s+Hook\s+\d+)/i;

export function parseNumberedBlocks(
  md: string,
): Array<{ id: string; index: number; title: string; body: string; full: string }> {
  if (!md) return [];
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const isHeader = HEADER_RE.test(line.trim());
    if (isHeader) {
      if (inBlock && current.length > 0) blocks.push(current.join('\n').trim());
      current = [line];
      inBlock = true;
    } else if (inBlock) {
      current.push(line);
    }
  }
  if (inBlock && current.length > 0) blocks.push(current.join('\n').trim());

  return blocks
    .map((b, i) => {
      const cleaned = b.replace(/\n*-{3,}\s*$/, '').trim();
      // Two title shapes
      const legacy = cleaned.match(/^\*\*\d+\.\s*([\s\S]+?)\*\*/);
      const hookH2 = cleaned.match(/^##\s+Hook\s+\d+\s*(?:[—\-:]\s*(.+))?$/im);
      let title: string;
      let body: string;
      if (legacy) {
        title = legacy[1].trim().replace(/\s+/g, ' ');
        body = cleaned.replace(/^\*\*\d+\.[\s\S]+?\*\*\s*\n?/, '').trim();
      } else if (hookH2) {
        // Use the spoken/written line as the title if no inline title was given.
        const spokenMatch = cleaned.match(/\*\*Spoken\s*\/\s*written:\*\*\s*\n([^\n]+)/i);
        title = (hookH2[1]?.trim() || spokenMatch?.[1]?.trim() || `Hook ${i + 1}`).replace(/\s+/g, ' ');
        // Strip the H2 header line from the body.
        body = cleaned.replace(/^##\s+Hook\s+\d+[^\n]*\n?/i, '').trim();
      } else {
        title = `Item ${i + 1}`;
        body = cleaned;
      }
      return { id: `block-${i}`, index: i, title, body, full: cleaned };
    });
}
