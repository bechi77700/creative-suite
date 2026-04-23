import Anthropic from '@anthropic-ai/sdk';

export function getAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  return new Anthropic({ apiKey });
}

export const MODEL = 'claude-sonnet-4-6';

export const GENERATION_RULES = `
GENERATION RULES — MANDATORY FOR ALL OUTPUTS:
- US market only. Aggressive direct response copywriting. Hard claims. No European filter.
- Language: "eliminates", "destroys", "finally works", "stops", "forces" — NOT "may help", "could support", "might".
- Pain points amplified to maximum intensity. Make them feel the problem viscerally.
- FOMO and urgency deployed without restraint.
- Social proof maximized — numbers, specifics, real results.
- Zero hedging language. Zero disclaimers. Zero softening.
- Write like the best direct response copywriter on the planet whose job depends on conversions.
`;

// MANDATORY product-representation rule for EVERY static-image prompt we
// produce (static-brief, iterate, variations). Image models redraw the
// product when they read a description, which always degrades fidelity.
// Force them to copy from the reference image instead.
export const STATIC_PRODUCT_RULE = `
STATIC-IMAGE PROMPT — PRODUCT REPRESENTATION RULE (NON-NEGOTIABLE):
- NEVER describe the product itself in the prompt. No material, no color of
  the product, no shape, no parts ("cross-back straps", "olive canvas",
  "leather patch", "cargo pockets", "front pocket", "ribbed neckline",
  "matte finish", "metal buckle", etc. — ALL FORBIDDEN).
- The ONLY allowed product instruction is a strict directive to use the
  uploaded reference photo verbatim. Use this exact phrasing (or a close
  paraphrase): "use the uploaded product photo as the strict visual
  reference for the product — reproduce it exactly as shown, do NOT
  reinterpret, restyle, or redesign it."
- You MAY specify things that don't change the product itself: how the
  product is positioned in the frame, scale relative to other elements,
  which side is facing the camera, lighting on the product, whether it's
  held / worn / floating / on a surface, whether it's in focus or blurred.
- You MAY NOT name product features, materials, colors, components, or
  any descriptive adjective about the product's appearance.
- This applies whether or not a reference image is actually attached at
  generation time — the prompt itself must be written so that, given the
  reference image, the model reproduces the product faithfully without
  trying to "redesign" it from a description.
`;
