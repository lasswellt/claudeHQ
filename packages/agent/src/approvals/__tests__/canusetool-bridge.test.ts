import { describe, it, expect, vi } from 'vitest';
import {
  requestCanUseToolDecision,
  CanUseToolBridgeError,
  type BridgeOptions,
} from '../canusetool-bridge.js';

// CAP-025 / story 013-001: SDK canUseTool bridge — network + decision parsing.

function makeOkResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function makeFailResponse(status: number, text = ''): Response {
  return new Response(text, { status });
}

const baseReq = {
  sessionId: 'sess-1',
  toolUseId: 'tool-use-abc',
  toolName: 'Bash',
  toolInput: { command: 'ls -la' },
};

const baseOpts = (overrides: Partial<BridgeOptions> = {}): BridgeOptions => ({
  hubUrl: 'https://hub.example',
  waitFn: () => Promise.resolve(), // no real delays in tests
  ...overrides,
});

describe('requestCanUseToolDecision', () => {
  it('posts to the hub long-poll endpoint with the expected body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a1' }),
    );

    await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hub.example/api/approvals/sdk/request');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      sessionId: 'sess-1',
      toolUseId: 'tool-use-abc',
      toolName: 'Bash',
      toolInput: { command: 'ls -la' },
    });
  });

  it('sends X-Agent-Token when provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a1' }),
    );
    await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn, agentToken: 'secret' }));
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Agent-Token']).toBe('secret');
  });

  it('trims trailing slash from hubUrl', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a1' }),
    );
    await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn, hubUrl: 'https://hub.example/' }));
    const [url] = fetchFn.mock.calls[0] as [string];
    expect(url).toBe('https://hub.example/api/approvals/sdk/request');
  });

  it('returns approve decision with no edited input', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a-1' }),
    );
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));
    expect(result).toEqual({ decision: 'approve', approvalId: 'a-1', editedInput: undefined });
  });

  it('parses editedInput as JSON when reviewer modified tool_input', async () => {
    const edited = JSON.stringify({ command: 'ls' });
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a-1', editedInput: edited }),
    );
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));
    expect(result).toEqual({
      decision: 'approve',
      approvalId: 'a-1',
      editedInput: { command: 'ls' },
    });
  });

  it('falls back to plain string when editedInput is non-JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a-1', editedInput: 'free-form note' }),
    );
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));
    expect(result.decision).toBe('approve');
    if (result.decision === 'approve') {
      expect(result.editedInput).toBe('free-form note');
    }
  });

  it('returns deny with reason from responseText', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({
        decision: 'deny',
        approvalId: 'a-1',
        responseText: 'Too risky',
      }),
    );
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));
    expect(result).toEqual({ decision: 'deny', approvalId: 'a-1', reason: 'Too risky' });
  });

  it('prefers reason over responseText when both present', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({
        decision: 'deny',
        approvalId: 'a-1',
        reason: 'Timed out',
        responseText: 'irrelevant',
      }),
    );
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }));
    if (result.decision === 'deny') {
      expect(result.reason).toBe('Timed out');
    }
  });

  it('retries on 5xx with exponential backoff', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeFailResponse(502, 'bad gateway'))
      .mockResolvedValueOnce(makeFailResponse(503, 'unavailable'))
      .mockResolvedValueOnce(makeOkResponse({ decision: 'approve', approvalId: 'a-1' }));

    const waitFn = vi.fn().mockResolvedValue(undefined);
    const result = await requestCanUseToolDecision(baseReq, baseOpts({ fetchFn, waitFn, baseBackoffMs: 100 }));

    expect(result.decision).toBe('approve');
    expect(fetchFn).toHaveBeenCalledTimes(3);
    // First retry waits 100 * 2^0 = 100; second waits 100 * 2^1 = 200.
    expect(waitFn).toHaveBeenNthCalledWith(1, 100);
    expect(waitFn).toHaveBeenNthCalledWith(2, 200);
  });

  it('fails fast on 4xx without retrying', async () => {
    const fetchFn = vi.fn().mockResolvedValue(makeFailResponse(400, 'Bad Request'));
    const waitFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestCanUseToolDecision(baseReq, baseOpts({ fetchFn, waitFn })),
    ).rejects.toBeInstanceOf(CanUseToolBridgeError);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(waitFn).not.toHaveBeenCalled();
  });

  it('gives up after maxRetries and throws', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const waitFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestCanUseToolDecision(baseReq, baseOpts({ fetchFn, waitFn, maxRetries: 3 })),
    ).rejects.toBeInstanceOf(CanUseToolBridgeError);

    expect(fetchFn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(waitFn).toHaveBeenCalledTimes(3);
  });

  it('caps backoff at 30 seconds', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('net'));
    const waitFn = vi.fn().mockResolvedValue(undefined);

    await expect(
      requestCanUseToolDecision(
        baseReq,
        baseOpts({ fetchFn, waitFn, maxRetries: 10, baseBackoffMs: 5000 }),
      ),
    ).rejects.toBeInstanceOf(CanUseToolBridgeError);

    // The later waits should all be clamped to 30_000.
    const latestWaits = waitFn.mock.calls.slice(-3).map((c) => c[0]);
    for (const w of latestWaits) {
      expect(w).toBeLessThanOrEqual(30_000);
    }
  });

  it('aborts promptly when signal is pre-aborted', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeOkResponse({ decision: 'approve', approvalId: 'a-1' }),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestCanUseToolDecision(baseReq, baseOpts({ fetchFn }), controller.signal),
    ).rejects.toBeInstanceOf(CanUseToolBridgeError);

    expect(fetchFn).not.toHaveBeenCalled();
  });
});
