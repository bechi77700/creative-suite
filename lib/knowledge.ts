// Knowledge injection helper.
//
// Reads GlobalKnowledge + BrandDocument rows (which store file CONTENT as
// base64) and turns them into prompt-ready text blocks for Claude.
//
// Two key behaviors:
//  1. Decodes base64 → text for textual files (.md, .txt, .json, .csv, etc.).
//     Binary files (PDF, DOCX, images) are skipped — they cannot be injected
//     as text. The filename is still listed so Claude knows the doc exists.
//  2. Filters GlobalKnowledge by category — each route only receives the
//     categories relevant to its job, plus the universal categories
//     (copywriting books, meta ads principles). This prevents prompt bloat
//     and keeps Claude focused.

import type { GlobalKnowledge, BrandDocument } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Category mapping (DB category strings → which routes inject them)
// ─────────────────────────────────────────────────────────────────────────────

// Categories injected into EVERY route. These are universal principles that
// apply across hooks, statics, videos, etc.
export const UNIVERSAL_CATEGORIES = ['copywriting_books', 'meta_ads_principles'] as const;

// Module-specific categories. A route declares which module it serves
// (hooks / static / video), and we inject only that module's categories
// + the universal ones.
export const MODULE_CATEGORIES: Record<'hooks' | 'static' | 'video' | 'native', string[]> = {
  hooks: ['hook_swipe_file'],
  static: ['static_ads'],
  video: ['video_frameworks'],
  native: ['native_ads'],
};

export type KnowledgeModule = keyof typeof MODULE_CATEGORIES;

// ─────────────────────────────────────────────────────────────────────────────
// Decoding
// ─────────────────────────────────────────────────────────────────────────────

// Mime types we know how to decode as text. Anything else (PDFs, images,
// office docs) gets listed by name only.
const TEXTUAL_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/x-markdown',
  'application/json',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
]);

function isTextual(mimeType: string, name: string): boolean {
  if (TEXTUAL_MIMES.has(mimeType)) return true;
  if (mimeType.startsWith('text/')) return true;
  // Fallback by extension — some uploads come with octet-stream mime
  const lower = name.toLowerCase();
  return (
    lower.endsWith('.md') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.json') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.xml')
  );
}

function decodeBase64Text(content: string): string {
  try {
    return Buffer.from(content, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Block builders (return prompt-ready strings)
// ─────────────────────────────────────────────────────────────────────────────

interface KnowledgeRow {
  name: string;
  category: string;
  mimeType: string;
  content: string;
}

/**
 * Build the GLOBAL KNOWLEDGE BASE prompt block, filtered by module.
 * Only injects rows whose category matches the module's allowed list
 * (module-specific + universal). Textual files get full content; binary
 * files (PDFs etc.) get listed by name with a [BINARY — name only] tag.
 */
export function buildGlobalKnowledgeBlock(
  rows: GlobalKnowledge[] | KnowledgeRow[],
  module: KnowledgeModule,
): string {
  const allowed = new Set<string>([
    ...MODULE_CATEGORIES[module],
    ...UNIVERSAL_CATEGORIES,
  ]);

  const filtered = rows.filter((r) => allowed.has(r.category));
  if (filtered.length === 0) return '';

  const parts: string[] = [];
  for (const row of filtered) {
    if (isTextual(row.mimeType, row.name)) {
      const text = decodeBase64Text(row.content);
      if (text.trim().length === 0) continue;
      parts.push(
        `===== [${row.category.toUpperCase()}] ${row.name} =====\n${text.trim()}\n===== END ${row.name} =====`,
      );
    } else {
      parts.push(`[${row.category.toUpperCase()} — ${row.name} — BINARY, name only]`);
    }
  }

  return parts.join('\n\n');
}

/**
 * Build the BRAND DOCUMENTS prompt block. Brand docs are not category-filtered
 * — every brand doc the project owns is relevant to every generation for that
 * project (saint graal, brand guidelines, etc.).
 */
export function buildBrandDocumentsBlock(docs: BrandDocument[]): string {
  if (docs.length === 0) return '';

  const parts: string[] = [];
  for (const doc of docs) {
    if (isTextual(doc.mimeType, doc.name)) {
      const text = decodeBase64Text(doc.content);
      if (text.trim().length === 0) continue;
      parts.push(
        `===== [${doc.type.toUpperCase()}] ${doc.name} =====\n${text.trim()}\n===== END ${doc.name} =====`,
      );
    } else {
      parts.push(`[${doc.type.toUpperCase()} — ${doc.name} — BINARY, name only]`);
    }
  }

  return parts.join('\n\n');
}
