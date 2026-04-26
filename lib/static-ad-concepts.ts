// Closed catalog of static ad concept families + variants.
// Mirrors the headings in /docs/static-ad-concepts.md (and the GlobalKnowledge
// upload of that file). The .md is the descriptive source-of-truth Claude
// reads at generation time. This catalog is the SHORT identifier list used
// by the chip-selector UI and by the prompt-injection helper.
//
// Single-select on the UI (one family + optional variant). When a family is
// selected, all N prompts in the batch must materialize that concept.
// "Seasonal" requires a free-text event from the user (Christmas, Black
// Friday, etc.) — there is no closed list.

export const SEASONAL_FAMILY = 'Seasonal' as const;

export interface ConceptFamily {
  name: string;
  variants: readonly string[];
  /** True for Seasonal — needs a free-text event input on the UI. */
  parameterized?: boolean;
}

export const STATIC_AD_FAMILIES: readonly ConceptFamily[] = [
  {
    name: 'Annotated Product',
    variants: ['Arrows', 'Bullet Points', 'Classic'],
  },
  {
    name: 'Comparison / Split',
    variants: ['Problem / Solution', 'Split + Benefit', 'Split + Offer', 'Before / After', 'Us vs Them'],
  },
  {
    name: 'Social Proof',
    variants: ['Trustpilot', 'Reviews (Avis)', 'Multi-reviews', 'Realistic Reviews'],
  },
  {
    name: 'Offer',
    variants: ['Offer Forward', 'Visible Bulk'],
  },
  {
    name: 'Handwriting',
    variants: ['Paper / Notebook', 'Body Writing', 'Paint / Amateur', 'Post-it'],
  },
  {
    name: 'Textual',
    variants: ['Long Format', 'Native Ads (FB / Insta)'],
  },
  {
    name: 'Headline',
    variants: ['Question', 'Urgency', 'Classic 2', 'Humor'],
  },
  {
    name: 'Other',
    variants: ['Strikethrough (Phrase barrée)', 'Google', 'Statistics', 'Drawing', 'Press / Fake news / Blog', 'iPhone'],
  },
  {
    name: SEASONAL_FAMILY,
    variants: [],
    parameterized: true,
  },
];

export interface SelectedConcept {
  family: string;
  variant?: string;
  /** Required when family === 'Seasonal'. */
  seasonalEvent?: string;
}

/**
 * Build the prompt block describing the selected concept. Returned string
 * is empty when no concept is selected — caller can inline it unconditionally.
 *
 * The block is intentionally directive: it tells Claude the concept is the
 * spine of the batch and that all N prompts must materialize it (with
 * creative variation INSIDE the concept, not by switching to other formats).
 */
export function buildConceptInstruction(concept: SelectedConcept | null | undefined): string {
  if (!concept || !concept.family) return '';

  const isSeasonal = concept.family === SEASONAL_FAMILY;
  const variantClause = concept.variant
    ? ` — specifically the "${concept.variant}" variant`
    : '';
  const seasonalClause = isSeasonal && concept.seasonalEvent?.trim()
    ? ` The seasonal event is **${concept.seasonalEvent.trim()}** — apply that event's specific visual codes (colors, motifs, typography, register) as defined in the Static Ad Concept Library.`
    : '';

  return `
─────────────────────────────────────────────
SELECTED STATIC AD CONCEPT (mandatory — applies to every prompt in this batch)
─────────────────────────────────────────────
The user has explicitly chosen the **${concept.family}** family${variantClause}. This concept is the SPINE of the batch — every single one of the prompts must materialize it. Refer to the "${concept.family}" section of the Static Ad Concept Library above for the full description, common executions, "best for" use-cases, and tone.

Vary the prompts WITHIN the concept (different copy, layouts, lighting, color palettes, framing, settings) — do NOT switch to a different family or variant just to add visual diversity. The concept stays constant; everything else varies.${seasonalClause}
`;
}
