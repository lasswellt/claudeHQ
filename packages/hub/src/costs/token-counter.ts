import { computeCost } from './formula.js';
import { normalizeModelId, type ModelId } from './pricing.js';

/**
 * CAP-072 / story 015-005: upfront token counter + cost estimate.
 *
 * Called from the job launcher before starting a session so the
 * operator sees a projected cost. Pipeline:
 *   1. Try Anthropic's free `/v1/messages/count_tokens` endpoint if
 *      an API key is configured. Accurate; requires a network call.
 *   2. On failure OR when no key is set, fall back to a local
 *      heuristic: 1 token ≈ 4 characters of text (industry
 *      approximation). Always returns something usable.
 *
 * Results are cached by `sha256(prompt + model)` so repeat
 * estimates don't burn API calls.
 *
 * The module is intentionally dependency-light — it calls
 * `globalThis.fetch` directly so it can be mocked in tests without
 * pulling in a HTTP client.
 */

export interface CountTokensInput {
  prompt: string;
  model: ModelId | string;
  /** Optional system prompt; counted separately. */
  system?: string;
  /** Estimated output tokens for cost projection. Default 2000. */
  expectedOutputTokens?: number;
}

export interface TokenEstimate {
  /** Accurate input token count (or heuristic when fallback used). */
  inputTokens: number;
  /** Expected output tokens (passed through or defaulted). */
  expectedOutputTokens: number;
  /** Projected cost in USD for input + expected output. */
  estimatedUsd: number;
  /** True when the count came from Anthropic, false when heuristic. */
  accurate: boolean;
  /** Source label for UI ("api" or "heuristic"). */
  source: 'api' | 'heuristic';
  /** When accurate=false, the error message explaining the fallback. */
  fallbackReason?: string;
}

export interface TokenCounterOptions {
  /** Anthropic API key. When absent the module goes straight to heuristic. */
  apiKey?: string;
  /** Base URL override (for regional endpoints). */
  baseUrl?: string;
  /** Injectable fetch — defaults to global. */
  fetchFn?: typeof fetch;
  /** Max cache entries before oldest-drops. Default 256. */
  cacheSize?: number;
  /** Injectable hasher — defaults to a small djb2 variant. */
  hashFn?: (input: string) => string;
}

export interface TokenCounter {
  count(input: CountTokensInput): Promise<TokenEstimate>;
  /** For tests: clear the cache. */
  clearCache(): void;
  /** For tests: current cache size. */
  cacheSize(): number;
}

export function createTokenCounter(opts: TokenCounterOptions = {}): TokenCounter {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.anthropic.com';
  const maxCacheSize = opts.cacheSize ?? 256;
  const hashFn = opts.hashFn ?? djb2Hash;

  const cache = new Map<string, TokenEstimate>();

  function cacheKey(input: CountTokensInput): string {
    // Include expectedOutputTokens so cost projection reflects the
    // caller's override — otherwise a cached entry from the default
    // 2000-token run would mask a later 10_000-token call.
    return hashFn(
      `${input.model}|${input.expectedOutputTokens ?? 2000}|${input.system ?? ''}|${input.prompt}`,
    );
  }

  function rememberInCache(key: string, estimate: TokenEstimate): void {
    if (cache.size >= maxCacheSize) {
      // Oldest-drop: Maps iterate insertion-order.
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, estimate);
  }

  async function tryApi(input: CountTokensInput): Promise<number | null> {
    if (!opts.apiKey) return null;
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/v1/messages/count_tokens`;
      const body = {
        model: input.model,
        system: input.system,
        messages: [{ role: 'user', content: input.prompt }],
      };
      const res = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { input_tokens?: number };
      return typeof data.input_tokens === 'number' ? data.input_tokens : null;
    } catch {
      return null;
    }
  }

  function heuristicCount(input: CountTokensInput): number {
    // Industry rule of thumb: 1 token ≈ 4 characters of English text.
    // Slightly generous so we don't undercount edge cases.
    const combined = (input.system ?? '') + input.prompt;
    return Math.ceil(combined.length / 4);
  }

  function computeEstimate(
    inputTokens: number,
    input: CountTokensInput,
    source: 'api' | 'heuristic',
    fallbackReason?: string,
  ): TokenEstimate {
    const expectedOutputTokens = input.expectedOutputTokens ?? 2000;
    const cost = computeCost({
      model: input.model,
      inputTokens,
      outputTokens: expectedOutputTokens,
    });
    return {
      inputTokens,
      expectedOutputTokens,
      estimatedUsd: cost.totalUsd,
      accurate: source === 'api',
      source,
      fallbackReason,
    };
  }

  return {
    async count(input: CountTokensInput): Promise<TokenEstimate> {
      const key = cacheKey(input);
      const hit = cache.get(key);
      if (hit) return hit;

      const apiCount = await tryApi(input);
      const estimate =
        apiCount !== null
          ? computeEstimate(apiCount, input, 'api')
          : computeEstimate(
              heuristicCount(input),
              input,
              'heuristic',
              opts.apiKey
                ? 'API call failed; using 4-char-per-token heuristic'
                : 'No API key configured; using 4-char-per-token heuristic',
            );

      rememberInCache(key, estimate);
      return estimate;
    },

    clearCache(): void {
      cache.clear();
    },

    cacheSize(): number {
      return cache.size;
    },
  };
}

/**
 * Tiny djb2-variant hash. Deterministic and dependency-free; we
 * only need a stable key for cache lookups, not a cryptographic
 * hash. Swap in sha256 via `opts.hashFn` when/if needed.
 */
function djb2Hash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

// Re-export for consumers that also want direct access to the
// underlying utilities.
export { normalizeModelId } from './pricing.js';
