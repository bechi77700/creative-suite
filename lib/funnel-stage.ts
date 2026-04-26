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
- DO: lead with the problem, the enemy, the symptom, the daily frustration. Pure attention play. Earn the click.
- DO NOT: name the product in the first beat, push the offer, list features, drop "Buy Now" CTAs, assume they care about your brand.
- PROOF DENSITY: Low — a single shocking stat or visceral example beats a wall of social proof here.
- CTA: Soft. "Learn more" / "See why" / "Watch this" / no CTA at all. We're buying attention, not conversion.`,

    MOFU: `FUNNEL STAGE: MOFU (warm traffic — solution-aware)
- AUDIENCE STATE: Knows they have the problem and is comparing solutions / mechanisms. Has seen ads in the category before.
- AWARENESS LEVEL (Schwartz): Solution-Aware.
- MESSAGE INTENT: Differentiate the MECHANISM. Why THIS approach beats the obvious alternatives they're already considering. Earn the trust to be shortlisted.
- HOOK PRIORITY: Mechanism reveal, "the real reason X doesn't work", category callout vs the brand's wedge, founder story / origin, demo of the unique method.
- DO: name the category enemy (the typical solution that fails), explain the unique mechanism in plain words, show the "aha" moment, contrast with what they've already tried.
- DO NOT: re-explain the problem from scratch (they know it), lead with discounts, treat the viewer as a beginner.
- PROOF DENSITY: Medium — one or two concrete proof points (study, before/after, expert) reinforcing the mechanism.
- CTA: Medium. "See how it works" / "Try the method" / "Read the science". We're earning consideration, not closing yet.`,

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
