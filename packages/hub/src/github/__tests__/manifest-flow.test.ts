import { describe, it, expect, vi } from 'vitest';
import {
  buildManifest,
  completeManifestExchange,
  DEFAULT_PERMISSIONS,
  DEFAULT_EVENTS,
} from '../manifest-flow.js';

// CAP-057 / story 017-001: GitHub App manifest flow.

describe('buildManifest', () => {
  const baseInput = {
    name: 'Claude HQ',
    homepageUrl: 'https://hq.example',
    redirectUrl: 'https://hq.example/setup/github/callback',
    webhookUrl: 'https://hq.example/webhooks/github',
  };

  it('returns the expected shape for a valid input', () => {
    const manifest = buildManifest(baseInput);
    expect(manifest.name).toBe('Claude HQ');
    expect(manifest.url).toBe('https://hq.example');
    expect(manifest.redirect_url).toBe(baseInput.redirectUrl);
    expect(manifest.hook_attributes).toEqual({
      url: baseInput.webhookUrl,
      active: true,
    });
    expect(manifest.public).toBe(false);
  });

  it('bakes in the default permissions', () => {
    const manifest = buildManifest(baseInput);
    expect(manifest.default_permissions).toEqual(DEFAULT_PERMISSIONS);
    expect(manifest.default_permissions.contents).toBe('write');
    expect(manifest.default_permissions.checks).toBe('write');
    expect(manifest.default_permissions.metadata).toBe('read');
  });

  it('merges extraRepoPermissions with defaults', () => {
    const manifest = buildManifest({
      ...baseInput,
      extraRepoPermissions: { deployments: 'write' },
    });
    expect(manifest.default_permissions.contents).toBe('write'); // default preserved
    expect(manifest.default_permissions.deployments).toBe('write'); // merged
  });

  it('includes the expected default events', () => {
    const manifest = buildManifest(baseInput);
    expect(manifest.default_events).toEqual(DEFAULT_EVENTS);
    expect(manifest.default_events).toContain('pull_request');
    expect(manifest.default_events).toContain('check_suite');
  });

  it('rejects empty or overlong names', () => {
    expect(() => buildManifest({ ...baseInput, name: '' })).toThrow(/1-34 chars/);
    expect(() => buildManifest({ ...baseInput, name: 'x'.repeat(35) })).toThrow(/1-34 chars/);
  });

  it('rejects non-HTTPS redirect URL', () => {
    expect(() =>
      buildManifest({ ...baseInput, redirectUrl: 'http://local/callback' }),
    ).toThrow(/HTTPS/);
  });

  it('rejects non-HTTPS webhook URL', () => {
    expect(() => buildManifest({ ...baseInput, webhookUrl: 'http://local/hook' })).toThrow(
      /HTTPS/,
    );
  });

  it('honors the public flag', () => {
    const manifest = buildManifest({ ...baseInput, public: true });
    expect(manifest.public).toBe(true);
  });
});

function mockExchangeResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 1234,
      slug: 'claude-hq',
      pem: '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----',
      webhook_secret: 'whsec',
      client_id: 'Iv1.abc',
      client_secret: 'secret',
      html_url: 'https://github.com/apps/claude-hq',
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('completeManifestExchange', () => {
  it('POSTs to the conversions endpoint and returns the creds', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockExchangeResponse());
    const result = await completeManifestExchange({ code: 'abc123', fetchFn });

    expect(result.id).toBe(1234);
    expect(result.slug).toBe('claude-hq');
    expect(result.pem).toContain('BEGIN RSA PRIVATE KEY');

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/app-manifests/abc123/conversions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/vnd.github+json');
  });

  it('URL-encodes the code', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockExchangeResponse());
    await completeManifestExchange({ code: 'a b/c', fetchFn });
    const url = fetchFn.mock.calls[0]?.[0];
    expect(url).toBe('https://api.github.com/app-manifests/a%20b%2Fc/conversions');
  });

  it('honors baseUrl override for GitHub Enterprise', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockExchangeResponse());
    await completeManifestExchange({
      code: 'x',
      fetchFn,
      baseUrl: 'https://github.example.com/api/v3/',
    });
    const url = fetchFn.mock.calls[0]?.[0];
    expect(url).toBe('https://github.example.com/api/v3/app-manifests/x/conversions');
  });

  it('throws on non-ok response', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 404 }));
    await expect(
      completeManifestExchange({ code: 'x', fetchFn }),
    ).rejects.toThrow(/Manifest exchange failed: 404/);
  });

  it('throws when required fields are missing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 1, slug: 'x' }), { status: 200 }),
    );
    await expect(
      completeManifestExchange({ code: 'x', fetchFn }),
    ).rejects.toThrow(/missing required fields/);
  });
});
