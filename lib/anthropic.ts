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

ALWAYS CLOSE THE LOOP — NON-NEGOTIABLE ON EVERY OUTPUT (regardless of funnel stage, awareness level, or format):
- Whatever the awareness level (TOFU / MOFU / BOFU — picked or not), every creative MUST end with the viewer (a) SEEING the product visually and (b) UNDERSTANDING what the solution is and how it relates to the pain.
- A pure-education ad — problem agitation, mechanism explainer, category teardown — that NEVER shows the product or never makes the solution clear = wasted CPM. We are buying ad impressions, not running a free awareness campaign for the category.
- Even hyper-educational long-form (VSLs, 90s+ scripts, native ads, carousels) MUST close with the product as the answer to the pain that was set up. The first 70-90% can be pain/mechanism/story, but the close is the product as resolution.
- For static images: the product (or a recognizable rendering of it) must appear in the frame. No abstract silhouette-only, no logo-only, no pure-headline-on-blank-bg without product.
- For scripts: the final beat must name what the solution IS in plain words and visually present the product.
- Naming the brand + product literally is OPTIONAL — sometimes a clean visual + clear category framing is stronger than a brand drop. But the viewer must NEVER scroll away wondering "ok so what's the actual solution?".
- This rule is the single hardest auto-fail check. If the output does not close the loop, it is broken — rewrite it.
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
STATIC-IMAGE PROMPT — FORMAT RULE (NON-NEGOTIABLE — Meta-only formats):
- Every image prompt MUST start by declaring ONE of these THREE Meta-spec
  formats — and NOTHING else is allowed:
    · "4:5 vertical format (1080x1350), Meta Feed,"
    · "9:16 vertical format (1080x1920), Meta Reels + Stories,"
    · "1:1 square format (1080x1080), Meta Carousel + Marketplace,"
- Pick the format based on the concept: storytelling / talking-head /
  full-body scenes → 9:16. Editorial / lifestyle / product hero →
  4:5 (the Meta Feed default and best CPM). Carousel slides, marketplace
  thumbnails, multi-product compositions, fallback when unsure → 1:1.
- FORBIDDEN: 16:9, 3:4, 2:3, 4:3, 21:9, square non-1080, any other
  aspect ratio. If you write any of these the prompt is auto-failed —
  Meta won't run the ad properly and the placement will be cropped or
  rejected.
- The format declaration is the very first thing in the prompt, before
  any visual description.

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

REFERENCE PHOTO(S) → PRODUCT IDENTITY, NOT AD STAGING (CRITICAL):
- The reference photo(s) tell the model what the PRODUCT looks like —
  its identity, materials, construction, proportions, colorways. They
  are NOT a template for how the product should be staged in the ad
  (pose, framing, composition, layout).
- DO NOT default to reproducing the reference photo's pose or layout
  in the ad. If the reference is a flat product shot on white, that
  doesn't mean the ad should be a flat product shot on white. The ad's
  staging is decided INDEPENDENTLY by the concept — pick whatever best
  serves THIS specific ad.
- The reference photo's only job: when the product IS visible (in
  whatever staging the concept calls for), it must match the real
  product faithfully — same colors, same construction, same details.

MULTIPLE REFERENCE PHOTOS — VARIANTS:
- When several reference photos are attached, they typically represent
  variants of the same product (different colorways, sizes, or SKUs).
- The prompt may either: (a) pick ONE variant that best serves the
  concept, or (b) feature MULTIPLE variants in the same image when the
  concept calls for it (e.g. several colorways lined up, two SKUs side
  by side, a before/after using two variants). Decide based on what
  the concept needs — don't default to either pattern.
`;
