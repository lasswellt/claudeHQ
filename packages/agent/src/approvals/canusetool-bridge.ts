/**
 * CAP-025 / story 013-001: SDK canUseTool → hub long-poll bridge.
 *
 * Agent-side wrapper around Claude Code SDK's `canUseTool` callback.
 * When the SDK asks whether a tool may execute, this function POSTs
 * the request to the hub's long-poll endpoint and awaits the
 * reviewer's decision. Network errors trigger exponential backoff
 * reconnects up to a bounded retry count so transient hub outages
 * don't fail every pending approval.
 *
 * The module is pure (no node-specific I/O) — `fetch` is injectable
 * so tests can stub it without touching the global, and the wait
 * between retries is also injectable.
 */

export interface CanUseToolRequest {
  /** Session this tool call is running inside. */
  sessionId: string;
  /** SDK-provided unique ID for this tool use — idempotency key. */
  toolUseId: string;
  /** Name of the tool (Bash, Read, Edit, …). */
  toolName: string;
  /** Arbitrary tool input — serialized as JSON over the wire. */
  toolInput?: unknown;
  /** Optional per-request timeout in seconds. Clamped to [30, 600] by hub. */
  timeoutSeconds?: number;
}

export type CanUseToolDecision =
  | {
      decision: 'approve';
      approvalId: string;
      /** If the reviewer edited the tool_input before approving, use this instead. */
      editedInput?: unknown;
    }
  | {
      decision: 'deny';
      approvalId: string;
      /** Feedback the reviewer left explaining the rejection. */
      reason?: string;
    };

export interface BridgeOptions {
  /** Hub base URL, e.g. `https://hub.example.internal`. */
  hubUrl: string;
  /** Shared agent token for hub authentication. */
  agentToken?: string;
  /** Injectable fetch — defaults to the global. */
  fetchFn?: typeof fetch;
  /** Max reconnect attempts on network/5xx errors. Default 5. */
  maxRetries?: number;
  /** Base backoff in ms. Default 1000 (so waits are 1s, 2s, 4s, 8s, 16s). */
  baseBackoffMs?: number;
  /** Injectable wait — defaults to setTimeout promise. */
  waitFn?: (ms: number) => Promise<void>;
}

export class CanUseToolBridgeError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CanUseToolBridgeError';
  }
}

interface HubLongPollResponse {
  decision: 'approve' | 'deny';
  approvalId: string;
  editedInput?: string | null;
  responseText?: string | null;
  reason?: string | null;
}

/**
 * POSTs a canUseTool request to the hub and returns the reviewer's
 * decision. Retries on network errors and 5xx with exponential
 * backoff; 4xx responses fail fast (bad request shouldn't be retried).
 *
 * The hub long-polls internally, so a single POST can take many
 * minutes to resolve. The fetch signal is NOT given a timeout — the
 * caller (Claude SDK) already controls its own cancellation via the
 * AbortSignal passed to canUseTool.
 */
export async function requestCanUseToolDecision(
  req: CanUseToolRequest,
  opts: BridgeOptions,
  signal?: AbortSignal,
): Promise<CanUseToolDecision> {
  const fetchFn = opts.fetchFn ?? fetch;
  const waitFn = opts.waitFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 5;
  const baseBackoffMs = opts.baseBackoffMs ?? 1000;
  const url = `${opts.hubUrl.replace(/\/$/, '')}/api/approvals/sdk/request`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (opts.agentToken) headers['X-Agent-Token'] = opts.agentToken;

  const body = JSON.stringify({
    sessionId: req.sessionId,
    toolUseId: req.toolUseId,
    toolName: req.toolName,
    toolInput: req.toolInput,
    timeoutSeconds: req.timeoutSeconds,
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new CanUseToolBridgeError('Aborted by caller');
    }

    try {
      const res = await fetchFn(url, { method: 'POST', headers, body, signal });

      if (res.status >= 400 && res.status < 500) {
        // 4xx — don't retry. Malformed request or auth failure.
        const text = await res.text().catch(() => '');
        throw new CanUseToolBridgeError(
          `Hub rejected canUseTool request: ${res.status} ${text}`,
        );
      }
      if (!res.ok) {
        // 5xx — retry with backoff.
        throw new CanUseToolBridgeError(
          `Hub returned ${res.status}; will retry`,
        );
      }

      const parsed = (await res.json()) as HubLongPollResponse;
      if (parsed.decision === 'approve') {
        const edited = parsed.editedInput ?? null;
        let editedInput: unknown = undefined;
        if (typeof edited === 'string' && edited.length > 0) {
          try {
            editedInput = JSON.parse(edited);
          } catch {
            // Hub already validates JSON at its boundary, so a
            // parse failure here means the reviewer persisted plain
            // text (e.g. non-JSON feedback). Pass the string through.
            editedInput = edited;
          }
        }
        return {
          decision: 'approve',
          approvalId: parsed.approvalId,
          editedInput,
        };
      }
      return {
        decision: 'deny',
        approvalId: parsed.approvalId,
        reason: parsed.reason ?? parsed.responseText ?? undefined,
      };
    } catch (err) {
      lastError = err;
      // 4xx rethrows are wrapped; propagate without retrying.
      if (err instanceof CanUseToolBridgeError && err.message.startsWith('Hub rejected')) {
        throw err;
      }
      if (signal?.aborted) {
        throw new CanUseToolBridgeError('Aborted by caller', err);
      }
      if (attempt >= maxRetries) break;
      // Exponential backoff: base * 2^attempt, capped at 30s.
      const backoff = Math.min(baseBackoffMs * 2 ** attempt, 30_000);
      await waitFn(backoff);
    }
  }

  throw new CanUseToolBridgeError(
    `canUseTool bridge failed after ${maxRetries + 1} attempts`,
    lastError,
  );
}
