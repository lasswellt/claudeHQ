import { describe, it, expect, vi } from 'vitest';
import { createTokenCounter } from '../token-counter.js';

// CAP-072 / story 015-005: token counter.

function apiResponse(inputTokens: number): Response {
  return new Response(JSON.stringify({ input_tokens: inputTokens }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number): Response {
  return new Response('error', { status });
}

describe('createTokenCounter — API path', () => {
  it('uses Anthropic count_tokens when an API key is configured', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(1234));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    const result = await counter.count({
      prompt: 'Hello world',
      model: 'claude-sonnet-4-6',
    });

    expect(result.accurate).toBe(true);
    expect(result.source).toBe('api');
    expect(result.inputTokens).toBe(1234);
    expect(result.expectedOutputTokens).toBe(2000); // default
    expect(result.estimatedUsd).toBeGreaterThan(0);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('sends the correct headers and body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(100));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    await counter.count({
      prompt: 'Hi',
      system: 'You are helpful',
      model: 'claude-opus-4-6',
    });

    const call = fetchFn.mock.calls[0];
    const url = call?.[0];
    const init = call?.[1] as RequestInit;
    expect(url).toContain('/v1/messages/count_tokens');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('claude-opus-4-6');
    expect(body.system).toBe('You are helpful');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('trims trailing slash from baseUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(10));
    const counter = createTokenCounter({
      apiKey: 'sk-test',
      baseUrl: 'https://custom.endpoint/',
      fetchFn,
    });
    await counter.count({ prompt: 'x', model: 'claude-haiku-4-5' });
    const url = fetchFn.mock.calls[0]?.[0];
    expect(url).toBe('https://custom.endpoint/v1/messages/count_tokens');
  });
});

describe('createTokenCounter — heuristic fallback', () => {
  it('falls back to heuristic when no API key', async () => {
    const fetchFn = vi.fn();
    const counter = createTokenCounter({ fetchFn });

    const result = await counter.count({
      prompt: 'a'.repeat(400), // 400 chars / 4 = 100 tokens
      model: 'claude-sonnet-4-6',
    });

    expect(result.accurate).toBe(false);
    expect(result.source).toBe('heuristic');
    expect(result.inputTokens).toBe(100);
    expect(result.fallbackReason).toContain('No API key');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls back when API returns non-ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiError(500));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    const result = await counter.count({
      prompt: 'a'.repeat(200),
      model: 'claude-haiku-4-5',
    });

    expect(result.accurate).toBe(false);
    expect(result.source).toBe('heuristic');
    expect(result.inputTokens).toBe(50);
    expect(result.fallbackReason).toContain('API call failed');
  });

  it('falls back when fetch throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    const result = await counter.count({
      prompt: 'x'.repeat(100),
      model: 'claude-sonnet-4-6',
    });

    expect(result.accurate).toBe(false);
    expect(result.inputTokens).toBe(25);
  });

  it('heuristic includes the system prompt', async () => {
    const counter = createTokenCounter();
    const result = await counter.count({
      prompt: 'a'.repeat(200),
      system: 'b'.repeat(200),
      model: 'claude-sonnet-4-6',
    });
    // 400 chars total / 4 = 100
    expect(result.inputTokens).toBe(100);
  });
});

describe('createTokenCounter — caching', () => {
  it('returns cached result on repeat call', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(777));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    const first = await counter.count({ prompt: 'x', model: 'claude-sonnet-4-6' });
    const second = await counter.count({ prompt: 'x', model: 'claude-sonnet-4-6' });

    expect(first.inputTokens).toBe(777);
    expect(second.inputTokens).toBe(777);
    expect(fetchFn).toHaveBeenCalledOnce(); // second call hit cache
  });

  it('different prompts bust the cache', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(apiResponse(10))
      .mockResolvedValueOnce(apiResponse(20));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    const a = await counter.count({ prompt: 'A', model: 'claude-sonnet-4-6' });
    const b = await counter.count({ prompt: 'B', model: 'claude-sonnet-4-6' });

    expect(a.inputTokens).toBe(10);
    expect(b.inputTokens).toBe(20);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('different models bust the cache', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(42));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn });

    await counter.count({ prompt: 'x', model: 'claude-sonnet-4-6' });
    await counter.count({ prompt: 'x', model: 'claude-opus-4-6' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('evicts oldest when cacheSize is exceeded', async () => {
    const fetchFn = vi.fn().mockResolvedValue(apiResponse(1));
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn, cacheSize: 2 });

    await counter.count({ prompt: 'a', model: 'claude-sonnet-4-6' });
    await counter.count({ prompt: 'b', model: 'claude-sonnet-4-6' });
    expect(counter.cacheSize()).toBe(2);

    await counter.count({ prompt: 'c', model: 'claude-sonnet-4-6' });
    expect(counter.cacheSize()).toBe(2);

    // 'a' should have been evicted — a fresh call triggers fetch.
    fetchFn.mockClear();
    await counter.count({ prompt: 'a', model: 'claude-sonnet-4-6' });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('clearCache empties the cache', async () => {
    const counter = createTokenCounter({ apiKey: 'sk-test', fetchFn: vi.fn().mockResolvedValue(apiResponse(1)) });
    await counter.count({ prompt: 'x', model: 'claude-sonnet-4-6' });
    expect(counter.cacheSize()).toBe(1);
    counter.clearCache();
    expect(counter.cacheSize()).toBe(0);
  });
});

describe('createTokenCounter — cost projection', () => {
  it('uses expectedOutputTokens override', async () => {
    const counter = createTokenCounter();
    const defaultOut = await counter.count({ prompt: 'a'.repeat(100), model: 'claude-sonnet-4-6' });
    const customOut = await counter.count({
      prompt: 'a'.repeat(100),
      model: 'claude-sonnet-4-6',
      expectedOutputTokens: 10_000,
    });
    expect(customOut.expectedOutputTokens).toBe(10_000);
    expect(customOut.estimatedUsd).toBeGreaterThan(defaultOut.estimatedUsd);
  });
});
