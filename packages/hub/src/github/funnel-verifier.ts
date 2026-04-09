/**
 * CAP-059 / story 017-004: Tailscale Funnel verifier.
 *
 * Called from the setup wizard to confirm that the Funnel URL the
 * operator configured is actually reachable from the public
 * internet. The check is a simple GET to `/health` (which the hub
 * already exposes) with the expected response payload shape.
 *
 * The verifier has to make an *outbound* call that traverses the
 * internet back to the hub. In dev/local setups where the hub
 * isn't actually exposed, that call returns the "unreachable"
 * reason so the wizard can surface a clear error.
 */

export interface FunnelVerifyOptions {
  /** Fully-qualified URL to the hub's Funnel endpoint, e.g. `https://hub.tailnet.ts.net`. */
  funnelUrl: string;
  /** Timeout in ms; default 5000. */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export type FunnelVerifyResult =
  | { ok: true; version: string; reachableAtMs: number }
  | {
      ok: false;
      reason: 'bad_url' | 'network_error' | 'non_ok_response' | 'unexpected_body';
      detail: string;
    };

export async function verifyFunnelUrl(
  opts: FunnelVerifyOptions,
): Promise<FunnelVerifyResult> {
  if (!/^https:\/\//i.test(opts.funnelUrl)) {
    return { ok: false, reason: 'bad_url', detail: 'Funnel URL must start with https://' };
  }
  let parsed: URL;
  try {
    parsed = new URL(opts.funnelUrl);
  } catch (e) {
    return { ok: false, reason: 'bad_url', detail: (e as Error).message };
  }

  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;
  const healthUrl = `${parsed.origin}/health`;
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetchFn(healthUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'network_error',
      detail: (err as Error).message,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: 'non_ok_response',
      detail: `HTTP ${res.status}`,
    };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    return {
      ok: false,
      reason: 'unexpected_body',
      detail: `Could not parse JSON: ${(err as Error).message}`,
    };
  }

  if (typeof body !== 'object' || body === null) {
    return { ok: false, reason: 'unexpected_body', detail: 'Body is not an object' };
  }
  const obj = body as Record<string, unknown>;
  if (obj.status !== 'ok') {
    return {
      ok: false,
      reason: 'unexpected_body',
      detail: `Expected status "ok", got "${String(obj.status)}"`,
    };
  }

  return {
    ok: true,
    version: typeof obj.version === 'string' ? obj.version : 'unknown',
    reachableAtMs: Date.now() - startedAt,
  };
}
