import { describe, it, expect } from 'vitest';
import { computeCost } from '../formula.js';
import {
  PRICING_TABLE,
  normalizeModelId,
  LONG_CONTEXT_INPUT_MULTIPLIER,
  CACHE_READ_MULTIPLIER,
  BATCH_DISCOUNT_MULTIPLIER,
  type ModelId,
} from '../pricing.js';

// CAP-069 / story 015-001: pricing + formula contract tests.
//
// These fixtures encode the expected behavior of the formula
// against known token usage shapes. Any change to the pricing
// table or the formula requires updating the affected cases.

describe('PRICING_TABLE', () => {
  it('defines all three model tiers', () => {
    expect(PRICING_TABLE['claude-opus-4-6']).toBeDefined();
    expect(PRICING_TABLE['claude-sonnet-4-6']).toBeDefined();
    expect(PRICING_TABLE['claude-haiku-4-5']).toBeDefined();
  });

  it('Opus is the most expensive tier', () => {
    expect(PRICING_TABLE['claude-opus-4-6'].inputUsdPerMtok).toBeGreaterThan(
      PRICING_TABLE['claude-sonnet-4-6'].inputUsdPerMtok,
    );
    expect(PRICING_TABLE['claude-sonnet-4-6'].inputUsdPerMtok).toBeGreaterThan(
      PRICING_TABLE['claude-haiku-4-5'].inputUsdPerMtok,
    );
  });

  it('all models have a 200k long-context threshold', () => {
    for (const model of Object.keys(PRICING_TABLE) as ModelId[]) {
      expect(PRICING_TABLE[model].longContextThresholdTokens).toBe(200_000);
    }
  });
});

describe('normalizeModelId', () => {
  it.each([
    ['claude-opus-4-6', 'claude-opus-4-6'],
    ['claude-opus-4-6[1m]', 'claude-opus-4-6'],
    ['claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['claude-3-5-sonnet', 'claude-sonnet-4-6'], // substring match
    ['haiku-nightly', 'claude-haiku-4-5'],
  ])('maps "%s" → %s', (raw, expected) => {
    expect(normalizeModelId(raw)).toBe(expected);
  });

  it('returns null for unknown models', () => {
    expect(normalizeModelId('gpt-4o')).toBeNull();
    expect(normalizeModelId('')).toBeNull();
  });
});

describe('computeCost — happy path', () => {
  // Use 100k tokens so the inferred context (100k) is under the
  // 200k long-context threshold and we test base pricing.
  it('prices 100k input + 100k output on Opus at $0.50 + $2.50', () => {
    const result = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(result.inputUsd).toBeCloseTo(0.5, 6);
    expect(result.outputUsd).toBeCloseTo(2.5, 6);
    expect(result.totalUsd).toBeCloseTo(3.0, 6);
    expect(result.longContextApplied).toBe(false);
  });

  it('prices 100k input + 100k output on Sonnet at $0.30 + $1.50', () => {
    const result = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(result.totalUsd).toBeCloseTo(1.8, 6);
  });

  it('prices 100k input + 100k output on Haiku at $0.10 + $0.50', () => {
    const result = computeCost({
      model: 'claude-haiku-4-5',
      inputTokens: 100_000,
      outputTokens: 100_000,
    });
    expect(result.totalUsd).toBeCloseTo(0.6, 6);
  });

  it('scales linearly with token count below the long-context threshold', () => {
    const oneK = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 1_000,
      outputTokens: 1_000,
      contextTokens: 2_000,
    });
    const hundredK = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 100_000,
      outputTokens: 100_000,
      contextTokens: 200_000, // exactly at threshold, not over
    });
    expect(hundredK.totalUsd).toBeCloseTo(oneK.totalUsd * 100, 6);
    expect(hundredK.longContextApplied).toBe(false);
  });
});

describe('computeCost — long context premium', () => {
  it('applies 2x input + 1.5x output when context > 200k', () => {
    const baseline = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 300_000,
      outputTokens: 50_000,
      contextTokens: 100_000, // under threshold
    });
    const longCtx = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 300_000,
      outputTokens: 50_000,
      contextTokens: 250_000, // over threshold
    });
    expect(longCtx.longContextApplied).toBe(true);
    expect(longCtx.inputUsd).toBeCloseTo(baseline.inputUsd * 2, 5);
    expect(longCtx.outputUsd).toBeCloseTo(baseline.outputUsd * 1.5, 5);
  });

  it('infers context from inputTokens + cacheReadTokens when not explicitly provided', () => {
    const result = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 150_000,
      outputTokens: 10_000,
      cacheReadTokens: 100_000,
      // no contextTokens → inferred as 250k, over threshold
    });
    expect(result.longContextApplied).toBe(true);
  });
});

describe('computeCost — cache pricing', () => {
  it('cache reads are 10% of base input rate', () => {
    const result = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    // 1M tokens * $5/M * 0.1 = $0.50
    expect(result.cacheReadUsd).toBeCloseTo(5 * CACHE_READ_MULTIPLIER, 6);
  });

  it('cache writes are 1.25x base input rate', () => {
    const result = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 1_000_000,
    });
    // 1M tokens * $5/M * 1.25 = $6.25
    expect(result.cacheWriteUsd).toBeCloseTo(6.25, 6);
  });

  it('cache pricing is not multiplied by the long-context premium', () => {
    const result = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 500_000,
      contextTokens: 1_500_000, // well over 200k
    });
    expect(result.longContextApplied).toBe(true);
    // Fresh input: 1M * $5 * 2 = $10
    expect(result.inputUsd).toBeCloseTo(10, 6);
    // Cache read: 500k * $5 * 0.1 / 1M = $0.25 (NOT 2x)
    expect(result.cacheReadUsd).toBeCloseTo(0.25, 6);
  });
});

describe('computeCost — batch discount', () => {
  it('applies 50% discount to the whole bill when isBatch=true', () => {
    const regular = computeCost({
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    const batch = computeCost({
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      isBatch: true,
    });
    expect(batch.totalUsd).toBeCloseTo(regular.totalUsd * BATCH_DISCOUNT_MULTIPLIER, 6);
    expect(batch.batchApplied).toBe(true);
  });
});

describe('computeCost — edge cases', () => {
  it('returns zero and null model id for unknown models', () => {
    const result = computeCost({
      model: 'gpt-4o',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(result.totalUsd).toBe(0);
    expect(result.modelId).toBeNull();
  });

  it('treats negative token counts as 0', () => {
    const result = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: -100,
      outputTokens: -50,
    });
    expect(result.totalUsd).toBe(0);
  });

  it('handles the all-zero case cleanly', () => {
    const result = computeCost({
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(result.totalUsd).toBe(0);
    expect(result.modelId).toBe('claude-sonnet-4-6');
  });

  it('all multipliers compose correctly: long-context + cache', () => {
    const pricing = PRICING_TABLE['claude-opus-4-6'];
    const result = computeCost({
      model: 'claude-opus-4-6',
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheReadTokens: 50_000,
      contextTokens: 300_000,
    });
    // Fresh input: 100k * $5 * 2 / 1M = $1.00
    expect(result.inputUsd).toBeCloseTo(
      (100_000 * pricing.inputUsdPerMtok * LONG_CONTEXT_INPUT_MULTIPLIER) / 1_000_000,
      6,
    );
    // Cache read (base, not long-context): 50k * $5 * 0.1 / 1M = $0.025
    expect(result.cacheReadUsd).toBeCloseTo(0.025, 6);
  });
});
