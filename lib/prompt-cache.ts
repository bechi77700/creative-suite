import type Anthropic from '@anthropic-ai/sdk';

// Anthropic prompt caching helper.
//
// Why: every generate route sends a heavy stable prefix on every call
// (GENERATION_RULES + global KB + brand documents). Without caching, you
// pay full input-token price on those ~10-20k tokens for every generation.
// With cache_control: ephemeral, Anthropic caches the prefix for ~5 min
// after the last hit and bills the cached tokens at 10% of normal price.
//
// Usage in a route:
//
//   const stablePrefix = `${GENERATION_RULES}
//
//   BRAND: ${project.name}
//   GLOBAL KNOWLEDGE: ${knowledgeContext}
//   BRAND DOCS: ${brandContext}`;
//
//   const variableSuffix = `PRODUCT: ${product}
//   ANGLE: ${angle}
//   ... task instructions ...`;
//
//   const messages = [{
//     role: 'user',
//     content: buildCachedUserContent(stablePrefix, variableSuffix),
//   }];
//
// For routes that send images, pass them via the images param — they will
// be inserted BEFORE the cached prefix so the cache still kicks in.
//
// Caveat: the cached block must be at least 1024 tokens for Anthropic to
// actually cache it. If your prefix is smaller it just falls back to
// normal billing — nothing breaks.

type ImagePart = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    data: string;
  };
};

export function buildCachedUserContent(
  stablePrefix: string,
  variableSuffix: string,
  images?: ImagePart[],
): Anthropic.MessageParam['content'] {
  const parts: Array<
    | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
    | ImagePart
  > = [];

  if (images && images.length > 0) {
    parts.push(...images);
  }

  parts.push({
    type: 'text',
    text: stablePrefix,
    cache_control: { type: 'ephemeral' },
  });

  if (variableSuffix.trim().length > 0) {
    parts.push({ type: 'text', text: variableSuffix });
  }

  return parts as Anthropic.MessageParam['content'];
}
