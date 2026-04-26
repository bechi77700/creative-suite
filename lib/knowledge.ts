// Helpers to turn GlobalKnowledge / BrandDocument rows into prompt-ready
// context blocks. The DB stores file content as base64; for TEXT-based
// files (.md, .txt, .json, .csv, .yaml, mime "text/*") we decode and
// inline the full content so Claude actually reads it. For binary files
// (PDF, images, .docx) we fall back to a name-only reference — extracting
// those needs dedicated parsing we don't have yet.
//
// Until this helper existed every route only injected file NAMES, so
// uploaded SOPs / frameworks / references were invisible to the model.

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/x-yaml',
  'application/yaml',
  'application/xml',
  'application/javascript',
  'application/typescript',
]);
const TEXT_EXTENSIONS = new Set([
  'md', 'mdx', 'txt', 'json', 'csv', 'tsv',
  'yaml', 'yml', 'xml', 'html', 'htm',
  'js', 'ts', 'jsx', 'tsx', 'css', 'scss',
  'sql', 'sh', 'env', 'log',
]);

function isTextual(mimeType: string | undefined, name: string): boolean {
  if (mimeType) {
    if (TEXT_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
    if (TEXT_MIME_EXACT.has(mimeType)) return true;
  }
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  return false;
}

/**
 * Decode a base64-stored file to a UTF-8 string IF it's textual; otherwise null.
 * Returns null on decode errors so callers can fall back to a name reference.
 */
export function decodeKnowledgeText(
  base64Content: string | null | undefined,
  mimeType: string | undefined,
  name: string,
): string | null {
  if (!base64Content) return null;
  if (!isTextual(mimeType, name)) return null;
  try {
    return Buffer.from(base64Content, 'base64').toString('utf-8');
  } catch {
    return null;
  }
}

interface KnowledgeItem {
  name: string;
  category?: string;
  type?: string;
  mimeType?: string;
  content?: string | null;
}

/**
 * Build a prompt-ready knowledge block. Each item produces either:
 *   - A "[LABEL — name]\n<full content>\n" block when the file is textual
 *   - A "[LABEL — name]" name-only line when the file is binary
 *
 * `labelFor(item)` returns the bracket label (e.g. "STATIC ADS REFERENCE").
 * Items are joined with blank lines for readability.
 */
export function buildKnowledgeBlock(
  items: KnowledgeItem[],
  labelFor: (item: KnowledgeItem) => string,
): string {
  const blocks: string[] = [];
  for (const item of items) {
    const label = labelFor(item);
    const content = decodeKnowledgeText(item.content, item.mimeType, item.name);
    if (content) {
      blocks.push(`[${label} — ${item.name}]\n${content.trim()}`);
    } else {
      blocks.push(`[${label} — ${item.name}]`);
    }
  }
  return blocks.join('\n\n');
}

/**
 * Convenience: build a knowledge block for GlobalKnowledge rows, using
 * "STATIC ADS REFERENCE" for category=static_ads (legacy label) and the
 * uppercased category otherwise.
 */
export function buildGlobalKnowledgeBlock(
  items: Array<{ name: string; category: string; mimeType?: string; content?: string | null }>,
): string {
  return buildKnowledgeBlock(items, (item) => {
    const cat = (item.category || '').toLowerCase();
    return cat === 'static_ads' ? 'STATIC ADS REFERENCE' : (item.category || 'KNOWLEDGE').toUpperCase();
  });
}

/**
 * Convenience: build a knowledge block for BrandDocument rows.
 */
export function buildBrandDocumentsBlock(
  items: Array<{ name: string; type: string; mimeType?: string; content?: string | null }>,
): string {
  return buildKnowledgeBlock(items, (item) => (item.type || 'DOCUMENT').toUpperCase());
}
