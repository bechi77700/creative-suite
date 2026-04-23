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
