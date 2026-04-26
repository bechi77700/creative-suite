import Anthropic from '@anthropic-ai/sdk';

export function getAnthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env');
  return new Anthropic({ apiKey });
}

// Hybrid model strategy:
//  - SMART (Opus 4.7) → "strategy" routes where reasoning quality drives ROI
//    (video angles, video scripts, scratch hooks, scratch static briefs).
//  - FAST  (Sonnet 4.6) → "execution" routes that variate or clone an existing
//    winner (variations, iterate, clone-and-adapt). Quality bar is "preserve
//    what works"; raw reasoning matters less, latency + cost matter more.
//
// MODEL is kept as an alias of MODEL_SMART for legacy imports — every route
// should pick MODEL_SMART or MODEL_FAST explicitly.
export const MODEL_SMART = 'claude-opus-4-7';
export const MODEL_FAST = 'claude-sonnet-4-6';
export const MODEL = MODEL_SMART;

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
// Visual direction rule for static ads. The brand's art direction (colors,
// fonts, mood from the brand documents / website) is the DEFAULT anchor,
// not a prison. Direct response often wins with deliberately "off-brand"
// stripped-down executions — pure white bg + red headline, plain notebook
// scribble, raw screenshot, etc. The rule below tells Claude to mix.
export const STATIC_VISUAL_DIRECTION_RULE = `
STATIC AD — VISUAL DIRECTION RULE (MIX BRAND-FAITHFUL AND BRAND-BREAKING):
- The brand's art direction (palette, fonts, photography style, mood — pulled
  from BRAND DOCUMENTS) is the DEFAULT anchor for prompts, NOT a hard rule.
- For batches of 2+ prompts, deliberately mix:
  · Some prompts that respect the brand DA (premium feel, on-palette, on-tone)
  · Some prompts that intentionally BREAK the DA for direct-response punch:
    pure white background + bold red headline, plain notebook handwriting,
    raw iPhone-style screenshot, ugly-on-purpose Comic Sans, post-it note,
    plain black bg + neon text, bare statistic on solid color, etc.
- Why mix: in cold traffic, "ugly" / "off-brand" / "stripped" ads often
  outperform polished brand-faithful ads because they break the scroll
  pattern and feel like organic content, not advertising.
- Auto-fail: every prompt in a batch using the same brand-faithful aesthetic.
  If 5 prompts all share the same color palette and polished mood, you've
  failed the variety test — the batch reads like one campaign, not like
  testing different hypotheses.
- When a SELECTED CONCEPT family is locked (e.g. "Handwriting", "Textual"),
  this rule still applies INSIDE the family — vary the brand-respect level
  even within one concept.
- For single-prompt requests (count = 1): pick whichever direction (faithful
  or breaking) best serves the angle / concept / product for that ad.
`;

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
