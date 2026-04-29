// Funnel-stage selector (TOFU / MOFU / BOFU) — optional input on every
// generation route. When picked, it injects a strong instruction telling
// Claude how to calibrate awareness level, message intent, proof density,
// CTA pressure, etc. When NOT picked, Claude is told nothing and decides
// freely (default behavior preserved).
//
// Awareness mapping (Schwartz "Breakthrough Advertising"):
//   TOFU → Unaware / Problem-Aware  → lead with PAIN + AGITATE
//   MOFU → Solution-Aware           → lead with MECHANISM + DIFFERENTIATION
//   BOFU → Product-Aware / Most Aware → lead with PROOF + OFFER + URGENCY

export const FUNNEL_STAGES = ['TOFU', 'MOFU', 'BOFU'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export interface FunnelStageMeta {
  value: FunnelStage;
  label: string;
  hint: string;
}

export const FUNNEL_STAGE_OPTIONS: FunnelStageMeta[] = [
  { value: 'TOFU', label: 'TOFU', hint: 'Cold — unaware / problem-aware' },
  { value: 'MOFU', label: 'MOFU', hint: 'Warm — solution-aware' },
  { value: 'BOFU', label: 'BOFU', hint: 'Hot — product-aware / ready to buy' },
];

export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && (FUNNEL_STAGES as readonly string[]).includes(value);
}

/**
 * Build the funnel-stage instruction block for the prompt. Returns an empty
 * string when no stage is selected (default — Claude decides freely).
 *
 * IMPORTANT: this block belongs in the VARIABLE suffix of the prompt (not the
 * cached prefix), because the user may switch stage between generations.
 */
export function buildFunnelStageInstruction(stage: FunnelStage | null | undefined): string {
  if (!stage || !isFunnelStage(stage)) return '';

  const blocks: Record<FunnelStage, string> = {
    TOFU: `FUNNEL STAGE: TOFU (cold traffic — unaware or problem-aware)
- AUDIENCE STATE: Doesn't know the brand. May not even realize they have the problem yet, or only feels it vaguely.
- AWARENESS LEVEL (Schwartz): Unaware → Problem-Aware.
- MESSAGE INTENT: Pattern interrupt + amplify a felt pain or callout the audience by identity. Make them feel "this is about me" in the first 1-2 seconds.
- HOOK PRIORITY: Curiosity, identity callout, brutal pain naming, contrarian statement, surprising stat, "stop scrolling if…".
- DO: lead with the problem, the enemy, the symptom, the daily frustration. The first 70-80% of the creative is pure attention play — earn the click.
- ALWAYS CLOSE THE LOOP — UNAMBIGUOUSLY (non-negotiable on Meta cold): even when leading with pain or mechanism, the viewer must finish the creative KNOWING what the solution is — not guessing. Two requirements are NON-NEGOTIABLE:
   (1) The product is SHOWN visually (real product image or recognizable rendering — no abstract silhouette, no logo-only).
   (2) The viewer UNDERSTANDS what the solution is and how it relates to the pain — in plain words, not behind a vague tagline. Examples: "the apron that empties in 1 second" / "the post-40 lymph protocol" / "what gardeners over 60 are switching to".
   Naming the brand + product explicitly is OPTIONAL — sometimes a clean visual + clear category framing is stronger than a brand drop. But the viewer must never scroll away wondering "ok so what's the actual solution?". A pure-education ad with no product visible = wasted CPM. Even hyper-educational VSLs always close with the product as the answer.
- DO NOT: name the product in the FIRST beat, lead with the offer, list features at the top, use hard "Buy Now" CTAs, leave the creative without ANY visible product, or hide the solution behind a vague tagline.
- PROOF DENSITY: Low — a single shocking stat or visceral example beats a wall of social proof here.
- CTA: Soft but PRESENT. "See how [product] fixes this" / "Why [audience] are switching to [product]" / "Meet [product]". Never zero CTA. We're buying attention AND planting the resolution in the same impression.`,

    MOFU: `FUNNEL STAGE: MOFU (warm traffic — solution-aware)
- AUDIENCE STATE: Knows they have the problem and is comparing solutions / mechanisms. Has seen ads in the category before.
- AWARENESS LEVEL (Schwartz): Solution-Aware.
- MESSAGE INTENT: Differentiate the MECHANISM. Why THIS approach beats the obvious alternatives they're already considering. Earn the trust to be shortlisted.
- HOOK PRIORITY: Mechanism reveal, "the real reason X doesn't work", category callout vs the brand's wedge, founder story / origin, demo of the unique method.
- DO: name the category enemy (the typical solution that fails), explain the unique mechanism in plain words, show the "aha" moment, contrast with what they've already tried. The product MUST be visibly shown and the viewer MUST understand it's YOUR mechanism being explained (not the category's generic solution). Naming the brand + product is encouraged at this stage but technically optional if the visual + framing make it unambiguous.
- ALWAYS CLOSE THE LOOP: the product must be impossible to miss visually, and the viewer must finish thinking "ah, that's the [thing] that does X differently". Mechanism explainers where the product is barely visible = wasted impressions on warm traffic — they had the option to recall a competitor instead.
- DO NOT: re-explain the problem from scratch (they know it), lead with discounts, treat the viewer as a beginner, run pure category education with the brand barely visible.
- PROOF DENSITY: Medium — one or two concrete proof points (study, before/after, expert) reinforcing the mechanism.
- CTA: Medium. "See how [product] does it" / "Try the method" / "Read the science behind [product]". We're earning consideration, not closing yet — but the brand and product must be impossible to miss.`,

    BOFU: `FUNNEL STAGE: BOFU (hot traffic — product-aware / most-aware)
- AUDIENCE STATE: Knows the brand and the product. Already considering buying. Needs the final push — proof, offer, scarcity, risk-reversal.
- AWARENESS LEVEL (Schwartz): Product-Aware → Most-Aware.
- MESSAGE INTENT: Close the sale. Stack proof, surface the offer, eliminate friction, create urgency. Convert the click into the order.
- HOOK PRIORITY: Offer-first ("48h only — 30% off"), social proof avalanche ("12,000 reviews — read what they say"), risk-reversal ("100-day refund"), retargeting callouts ("still thinking about it?"), price/value framing.
- DO: lead with the offer, name the product, stack reviews/UGC/numbers, name the guarantee, put the CTA early and often.
- DO NOT: re-pitch the mechanism from scratch, explain the problem, use vague soft CTAs, hide the price/offer.
- PROOF DENSITY: Maximum — reviews, star ratings, customer counts, before/afters, press, specific testimonials with names.
- CTA: Hard. "Shop now" / "Claim your X" / "Order before midnight". Direct, urgent, unambiguous. Repeat it.`,
  };

  return blocks[stage];
}
