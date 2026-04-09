import { describe, it, expect, vi } from 'vitest';
import { verifyFunnelUrl } from '../funnel-verifier.js';

// CAP-059 / story 017-004: funnel verifier.

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('verifyFunnelUrl', () => {
  it('rejects non-HTTPS URLs', async () => {
    const result = await verifyFunnelUrl({ funnelUrl: 'http://insecure.example' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('bad_url');
  });

  it('rejects malformed URLs', async () => {
    const result = await verifyFunnelUrl({ funnelUrl: 'https://' });
    expect(result.ok).toBe(false);
  });

  it('returns ok when /health responds with status=ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      okResponse({ status: 'ok', version: '0.1.0' }),
    );
    const result = await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net',
      fetchFn,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.version).toBe('0.1.0');
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://hub.tailnet.ts.net/health');
  });

  it('strips any path from the URL when building /health', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ status: 'ok' }));
    await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net/some/path',
      fetchFn,
    });
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://hub.tailnet.ts.net/health');
  });

  it('reports network errors', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('network_error');
  });

  it('reports non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('Server Error', { status: 502 }));
    const result = await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('non_ok_response');
      expect(result.detail).toContain('502');
    }
  });

  it('reports malformed JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const result = await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unexpected_body');
  });

  it('rejects a body with status != "ok"', async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse({ status: 'degraded' }));
    const result = await verifyFunnelUrl({
      funnelUrl: 'https://hub.tailnet.ts.net',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unexpected_body');
      expect(result.detail).toContain('degraded');
    }
  });
});
