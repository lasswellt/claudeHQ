/**
 * CAP-069 / story 015-001: Claude pricing table.
 *
 * Per-million-token pricing for the models the hub tracks. Prices
 * are stored as USD per 1M input/output tokens.
 *
 * Maintenance note — this table MUST be reviewed when Anthropic
 * announces a new model or a price change. The contract test in
 * `__tests__/pricing.test.ts` validates the formula output against
 * a set of fixture scenarios with known expected totals; the test
 * WILL fail if you change a number here without updating the
 * fixtures. That's intentional — it forces a conscious review.
 *
 * Sources:
 *   - Opus 4.6:    $5 input / $25 output per 1M tokens
 *   - Sonnet 4.6:  $3 input / $15 output per 1M tokens
 *   - Haiku 4.5:   $1 input / $5  output per 1M tokens
 *
 * Premiums and discounts applied on top of the base rates:
 *   - Long context (>200k tokens in context): 2× input, 1.5× output
 *   - Cache write: 1.25× input (5m cache); 1× (1h cache handled elsewhere)
 *   - Cache read:  0.1× input (90% discount)
 *   - Batch API:   0.5× both input and output
 */

export type ModelId =
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5';

export interface ModelPricing {
  /** USD per 1M input tokens at baseline (short context, no cache). */
  inputUsdPerMtok: number;
  /** USD per 1M output tokens at baseline. */
  outputUsdPerMtok: number;
  /** Context window beyond which the long-context premium kicks in. */
  longContextThresholdTokens: number;
}

export const PRICING_TABLE: Record<ModelId, ModelPricing> = {
  'claude-opus-4-6': {
    inputUsdPerMtok: 5,
    outputUsdPerMtok: 25,
    longContextThresholdTokens: 200_000,
  },
  'claude-sonnet-4-6': {
    inputUsdPerMtok: 3,
    outputUsdPerMtok: 15,
    longContextThresholdTokens: 200_000,
  },
  'claude-haiku-4-5': {
    inputUsdPerMtok: 1,
    outputUsdPerMtok: 5,
    longContextThresholdTokens: 200_000,
  },
};

/** Long-context premium multipliers applied to base rates. */
export const LONG_CONTEXT_INPUT_MULTIPLIER = 2;
export const LONG_CONTEXT_OUTPUT_MULTIPLIER = 1.5;

/** Cache multipliers applied to input-token rates only. */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

/** Batch API discount applied to the whole bill. */
export const BATCH_DISCOUNT_MULTIPLIER = 0.5;

/**
 * Coerce an arbitrary model string to a known ModelId, or return
 * null when unknown. The contract test treats unknown models as a
 * reason to skip cost computation rather than crash.
 */
export function normalizeModelId(raw: string): ModelId | null {
  const lower = raw.toLowerCase();
  if (lower.includes('opus')) return 'claude-opus-4-6';
  if (lower.includes('sonnet')) return 'claude-sonnet-4-6';
  if (lower.includes('haiku')) return 'claude-haiku-4-5';
  return null;
}
