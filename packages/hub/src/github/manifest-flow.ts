/**
 * CAP-057 / story 017-001: GitHub App manifest flow.
 *
 * Builds the manifest payload sent to
 * `https://github.com/settings/apps/new` and exchanges the code
 * returned by the callback for the App credentials. Splitting the
 * HTTP calls out via a thin `HttpClient` interface lets the unit
 * tests assert the payload shape without a live network.
 *
 * Wizard flow (see 017-002 for the UI):
 *   1. Dashboard user clicks "Create GitHub App"
 *   2. Hub builds the manifest JSON via `buildManifest` and POSTs
 *      via a hidden form to `settings/apps/new` — GitHub walks the
 *      user through creation
 *   3. GitHub calls our `redirectUrl` with `?code=...`
 *   4. Hub POSTs the code to `/app-manifests/{code}/conversions`
 *      via `completeManifestExchange` and receives the App creds
 *      (id, pem, webhook_secret, etc.)
 *   5. Hub stores the creds via the github_config DAL
 */

export interface BuildManifestInput {
  /** Human-readable name shown in GitHub (≤34 chars). */
  name: string;
  /** Marketing/homepage URL. Usually the hub's UI root. */
  homepageUrl: string;
  /** Callback URL GitHub redirects to after creation. */
  redirectUrl: string;
  /** Webhook endpoint on the hub — must be publicly reachable. */
  webhookUrl: string;
  /** When true, the App becomes installable on any org (public). Default false. */
  public?: boolean;
  /** Extra repository permissions. Sensible defaults baked in. */
  extraRepoPermissions?: Record<string, 'read' | 'write' | 'admin'>;
}

export interface GitHubAppManifest {
  name: string;
  url: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  public: boolean;
  default_permissions: Record<string, 'read' | 'write' | 'admin'>;
  default_events: string[];
}

/**
 * Default permissions required for the Claude HQ agent:
 *   - contents: write       — push branches
 *   - pull_requests: write  — open / update PRs
 *   - issues: write         — comment on issues
 *   - checks: write         — create/update check runs (CAP-062)
 *   - actions: read         — read workflow runs
 *   - metadata: read        — required by every App
 */
export const DEFAULT_PERMISSIONS: Record<string, 'read' | 'write' | 'admin'> = {
  contents: 'write',
  pull_requests: 'write',
  issues: 'write',
  checks: 'write',
  actions: 'read',
  metadata: 'read',
};

/**
 * Default webhook events we listen to. Mirrors the webhook
 * handler's switch in 017-007.
 */
export const DEFAULT_EVENTS: string[] = [
  'pull_request',
  'pull_request_review',
  'check_suite',
  'check_run',
  'push',
  'installation',
  'installation_repositories',
];

export function buildManifest(input: BuildManifestInput): GitHubAppManifest {
  if (input.name.length === 0 || input.name.length > 34) {
    throw new Error(`GitHub App name must be 1-34 chars (got ${input.name.length})`);
  }
  if (!/^https:\/\//i.test(input.redirectUrl)) {
    throw new Error('redirect_url must use HTTPS');
  }
  if (!/^https:\/\//i.test(input.webhookUrl)) {
    throw new Error('webhook_url must use HTTPS');
  }

  return {
    name: input.name,
    url: input.homepageUrl,
    hook_attributes: { url: input.webhookUrl, active: true },
    redirect_url: input.redirectUrl,
    public: input.public ?? false,
    default_permissions: {
      ...DEFAULT_PERMISSIONS,
      ...(input.extraRepoPermissions ?? {}),
    },
    default_events: [...DEFAULT_EVENTS],
  };
}

// ── Callback exchange ────────────────────────────────────────

export interface ManifestExchangeResponse {
  id: number;
  slug: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
  html_url: string;
}

export interface ExchangeOptions {
  code: string;
  fetchFn?: typeof fetch;
  /** Base URL override for GitHub Enterprise Server. */
  baseUrl?: string;
}

/**
 * Exchanges the callback code for the App credentials. Called by
 * the wizard's callback route.
 */
export async function completeManifestExchange(
  opts: ExchangeOptions,
): Promise<ManifestExchangeResponse> {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = (opts.baseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const url = `${baseUrl}/app-manifests/${encodeURIComponent(opts.code)}/conversions`;

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Manifest exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as Partial<ManifestExchangeResponse>;
  if (
    typeof data.id !== 'number' ||
    typeof data.pem !== 'string' ||
    typeof data.webhook_secret !== 'string' ||
    typeof data.client_id !== 'string' ||
    typeof data.client_secret !== 'string' ||
    typeof data.slug !== 'string' ||
    typeof data.html_url !== 'string'
  ) {
    throw new Error('Manifest exchange response missing required fields');
  }

  return data as ManifestExchangeResponse;
}
