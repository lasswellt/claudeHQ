import {
  PRICING_TABLE,
  normalizeModelId,
  LONG_CONTEXT_INPUT_MULTIPLIER,
  LONG_CONTEXT_OUTPUT_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  BATCH_DISCOUNT_MULTIPLIER,
  type ModelId,
} from './pricing.js';

/**
 * CAP-069 / story 015-001: cost formula module.
 *
 * Pure function that converts a token usage report into a USD
 * total, matching the Anthropic pricing model. Handles:
 *   - Long-context premium (2×/1.5×)
 *   - Cache read discount (0.1×)
 *   - Cache write premium (1.25×)
 *   - Batch API discount (0.5×)
 *
 * The output is validated against SDK-reported costs via contract
 * tests. Any change to the formula here requires updating the
 * `pricing.test.ts` fixtures in lockstep.
 */

export interface CostInput {
  model: ModelId | string;
  /** Fresh (non-cached) input tokens. */
  inputTokens: number;
  /** Output tokens produced by the assistant. */
  outputTokens: number;
  /** Tokens read from prompt cache (billed at CACHE_READ_MULTIPLIER). */
  cacheReadTokens?: number;
  /** Tokens written to prompt cache (billed at CACHE_WRITE_MULTIPLIER). */
  cacheWriteTokens?: number;
  /**
   * Context window size in tokens for the turn. Used to decide
   * whether the long-context premium applies.
   */
  contextTokens?: number;
  /** When true, apply the 50% batch API discount. */
  isBatch?: boolean;
}

export interface CostBreakdown {
  /** USD for fresh input tokens (includes long-context premium). */
  inputUsd: number;
  /** USD for output tokens (includes long-context premium). */
  outputUsd: number;
  /** USD for cache-read tokens (discounted input rate). */
  cacheReadUsd: number;
  /** USD for cache-write tokens (premium input rate). */
  cacheWriteUsd: number;
  /** Subtotal before batch discount. */
  subtotalUsd: number;
  /** Final total after batch discount, if any. */
  totalUsd: number;
  /** Whether the long-context premium was applied. */
  longContextApplied: boolean;
  /** Whether the batch discount was applied. */
  batchApplied: boolean;
  /** Model id used for pricing lookup, null if unknown. */
  modelId: ModelId | null;
}

export function computeCost(input: CostInput): CostBreakdown {
  const modelId =
    typeof input.model === 'string' && !(input.model in PRICING_TABLE)
      ? normalizeModelId(input.model)
      : (input.model as ModelId);

  if (!modelId || !(modelId in PRICING_TABLE)) {
    // Unknown model — return zero cost with the breakdown so the
    // caller can decide whether to record or skip. Silently
    // charging a made-up rate would be worse.
    return {
      inputUsd: 0,
      outputUsd: 0,
      cacheReadUsd: 0,
      cacheWriteUsd: 0,
      subtotalUsd: 0,
      totalUsd: 0,
      longContextApplied: false,
      batchApplied: false,
      modelId: null,
    };
  }

  const pricing = PRICING_TABLE[modelId];
  const longContext =
    (input.contextTokens ?? input.inputTokens + (input.cacheReadTokens ?? 0)) >
    pricing.longContextThresholdTokens;

  const inputRate =
    (pricing.inputUsdPerMtok / 1_000_000) *
    (longContext ? LONG_CONTEXT_INPUT_MULTIPLIER : 1);
  const outputRate =
    (pricing.outputUsdPerMtok / 1_000_000) *
    (longContext ? LONG_CONTEXT_OUTPUT_MULTIPLIER : 1);

  // Cache reads/writes always use the base input rate (without the
  // long-context premium) — that matches Anthropic's published
  // pricing page and has been confirmed against invoice samples.
  const baseInputRate = pricing.inputUsdPerMtok / 1_000_000;

  const inputUsd = Math.max(0, input.inputTokens) * inputRate;
  const outputUsd = Math.max(0, input.outputTokens) * outputRate;
  const cacheReadUsd =
    Math.max(0, input.cacheReadTokens ?? 0) * baseInputRate * CACHE_READ_MULTIPLIER;
  const cacheWriteUsd =
    Math.max(0, input.cacheWriteTokens ?? 0) * baseInputRate * CACHE_WRITE_MULTIPLIER;

  const subtotalUsd = inputUsd + outputUsd + cacheReadUsd + cacheWriteUsd;
  const totalUsd = input.isBatch
    ? subtotalUsd * BATCH_DISCOUNT_MULTIPLIER
    : subtotalUsd;

  return {
    inputUsd: round6(inputUsd),
    outputUsd: round6(outputUsd),
    cacheReadUsd: round6(cacheReadUsd),
    cacheWriteUsd: round6(cacheWriteUsd),
    subtotalUsd: round6(subtotalUsd),
    totalUsd: round6(totalUsd),
    longContextApplied: longContext,
    batchApplied: input.isBatch === true,
    modelId,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
