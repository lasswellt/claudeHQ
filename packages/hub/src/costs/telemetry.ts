/**
 * CAP-074 / stories 015-007 + 015-008: cost telemetry exporters.
 *
 * Pluggable interface with three implementations:
 *   - createNoopExporter()    — default, silently drops events.
 *   - createOtlpExporter()    — OTLP/HTTP JSON direct POST. No SDK
 *                                dependency; builds the payload by
 *                                hand from the public proto-json
 *                                schema.
 *   - createLangfuseExporter() — Langfuse public API. Also dep-free.
 *
 * The exporter is selected in `server.ts` based on environment:
 *   - CLAUDE_CODE_ENABLE_TELEMETRY=1 turns it on
 *   - OTEL_EXPORTER_OTLP_ENDPOINT picks OTLP
 *   - LANGFUSE_PUBLIC_KEY + LANGFUSE_SECRET_KEY picks Langfuse
 *
 * Any exporter failure is swallowed — we never let a telemetry
 * error kill the session cost write path.
 */

export interface CostEvent {
  /** Session id this cost applies to. */
  sessionId: string;
  /** Machine id the session ran on, if known. */
  machineId?: string;
  /** Model id as reported by the session (e.g. "claude-sonnet-4-6"). */
  model: string;
  /** Fresh input tokens. */
  inputTokens: number;
  /** Output tokens. */
  outputTokens: number;
  /** Cache-read tokens, if any. */
  cacheReadTokens?: number;
  /** Cache-write tokens, if any. */
  cacheWriteTokens?: number;
  /** Total cost computed by the formula module. */
  costUsd: number;
  /** Unix millis when the cost was recorded. */
  timestampMs: number;
  /** Optional user/org attribution. */
  userId?: string;
  /** Optional workspace/repo attribution. */
  repoId?: string;
}

export interface TelemetryExporter {
  /** Fire-and-forget — implementations must never throw. */
  emit(event: CostEvent): void;
  /** Flush any buffered events. Called on shutdown. */
  flush(): Promise<void>;
}

export interface TelemetryOptions {
  fetchFn?: typeof fetch;
  logger?: { warn: (obj: unknown, msg?: string) => void };
}

// ── No-op default ────────────────────────────────────────────

export function createNoopExporter(): TelemetryExporter {
  return {
    emit(): void {},
    async flush(): Promise<void> {},
  };
}

// ── OTLP/HTTP JSON exporter (story 015-007) ──────────────────

export interface OtlpExporterOptions extends TelemetryOptions {
  /** OTLP endpoint base URL; /v1/traces is appended. */
  endpoint: string;
  /** Optional bearer token / API key header. */
  headers?: Record<string, string>;
  /** Service name for OTel resource attribution. Default "claude-hq". */
  serviceName?: string;
}

/**
 * Minimal OTLP/HTTP JSON trace exporter. Each cost event becomes
 * a single span with attributes mirroring the event fields. The
 * proto-json shape is documented at
 * https://opentelemetry.io/docs/specs/otlp/#otlphttp but we only
 * need a small subset: resourceSpans → scopeSpans → span with
 * key/value attributes.
 */
export function createOtlpExporter(opts: OtlpExporterOptions): TelemetryExporter {
  const fetchFn = opts.fetchFn ?? fetch;
  const endpoint = `${opts.endpoint.replace(/\/$/, '')}/v1/traces`;
  const serviceName = opts.serviceName ?? 'claude-hq';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers ?? {}),
  };

  // Buffer up to 64 events or a 10s window, whichever fires first.
  const BUFFER_LIMIT = 64;
  const FLUSH_INTERVAL_MS = 10_000;
  let buffer: CostEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBuffer();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const snapshot = buffer;
    buffer = [];

    const spans = snapshot.map((ev) => ({
      traceId: hexTraceId(ev),
      spanId: hexSpanId(ev),
      name: 'claude.session.cost',
      kind: 1, // INTERNAL
      startTimeUnixNano: `${ev.timestampMs * 1_000_000}`,
      endTimeUnixNano: `${ev.timestampMs * 1_000_000}`,
      attributes: [
        kv('claude.session_id', ev.sessionId),
        ev.machineId ? kv('claude.machine_id', ev.machineId) : null,
        kv('claude.model', ev.model),
        kv('claude.input_tokens', ev.inputTokens),
        kv('claude.output_tokens', ev.outputTokens),
        ev.cacheReadTokens !== undefined
          ? kv('claude.cache_read_tokens', ev.cacheReadTokens)
          : null,
        ev.cacheWriteTokens !== undefined
          ? kv('claude.cache_write_tokens', ev.cacheWriteTokens)
          : null,
        kv('claude.cost_usd', ev.costUsd),
        ev.userId ? kv('claude.user_id', ev.userId) : null,
        ev.repoId ? kv('claude.repo_id', ev.repoId) : null,
      ].filter((a): a is NonNullable<typeof a> => a !== null),
      status: { code: 1 /* OK */ },
    }));

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [kv('service.name', serviceName)],
          },
          scopeSpans: [
            {
              scope: { name: '@chq/hub', version: '0.1.0' },
              spans,
            },
          ],
        },
      ],
    };

    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        opts.logger?.warn(
          { status: res.status, count: snapshot.length },
          'OTLP export non-ok',
        );
      }
    } catch (err) {
      opts.logger?.warn({ err, count: snapshot.length }, 'OTLP export failed');
    }
  }

  return {
    emit(event: CostEvent): void {
      buffer.push(event);
      if (buffer.length >= BUFFER_LIMIT) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        void flushBuffer();
      } else {
        scheduleFlush();
      }
    },
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await flushBuffer();
    },
  };
}

function kv(key: string, value: string | number): {
  key: string;
  value: { stringValue?: string; doubleValue?: number; intValue?: string };
} {
  if (typeof value === 'string') {
    return { key, value: { stringValue: value } };
  }
  if (Number.isInteger(value)) {
    return { key, value: { intValue: String(value) } };
  }
  return { key, value: { doubleValue: value } };
}

/**
 * Deterministic 32-char hex trace id from the session id. Real OTel
 * traces use random ids; we use the session id so spans for the
 * same session cluster together in the trace explorer.
 */
function hexTraceId(ev: CostEvent): string {
  return padHex(hashString(`${ev.sessionId}|${ev.timestampMs}`), 32);
}

function hexSpanId(ev: CostEvent): string {
  return padHex(hashString(`${ev.sessionId}|${ev.timestampMs}|span`), 16);
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

function padHex(str: string, width: number): string {
  return (str.repeat(Math.ceil(width / str.length))).slice(0, width);
}

// ── Langfuse exporter (story 015-008) ────────────────────────

export interface LangfuseExporterOptions extends TelemetryOptions {
  publicKey: string;
  secretKey: string;
  /** Langfuse endpoint; defaults to the managed cloud. */
  baseUrl?: string;
}

/**
 * Langfuse public API exporter. Uses HTTP basic auth + POST to
 * /api/public/ingestion with a JSON array of events. See
 * https://langfuse.com/docs/integrations for the event shape.
 */
export function createLangfuseExporter(opts: LangfuseExporterOptions): TelemetryExporter {
  const fetchFn = opts.fetchFn ?? fetch;
  const baseUrl = (opts.baseUrl ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
  const endpoint = `${baseUrl}/api/public/ingestion`;
  const authHeader =
    'Basic ' + Buffer.from(`${opts.publicKey}:${opts.secretKey}`).toString('base64');

  const BUFFER_LIMIT = 32;
  const FLUSH_INTERVAL_MS = 10_000;
  let buffer: CostEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushBuffer();
    }, FLUSH_INTERVAL_MS);
    flushTimer.unref?.();
  }

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    const snapshot = buffer;
    buffer = [];

    const events = snapshot.map((ev) => ({
      id: `${ev.sessionId}-${ev.timestampMs}`,
      type: 'trace-create',
      timestamp: new Date(ev.timestampMs).toISOString(),
      body: {
        id: ev.sessionId,
        name: 'claude-session',
        userId: ev.userId,
        metadata: {
          machineId: ev.machineId,
          repoId: ev.repoId,
          model: ev.model,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cacheReadTokens: ev.cacheReadTokens,
          cacheWriteTokens: ev.cacheWriteTokens,
          costUsd: ev.costUsd,
        },
      },
    }));

    try {
      const res = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify({ batch: events }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        opts.logger?.warn(
          { status: res.status, count: snapshot.length },
          'Langfuse export non-ok',
        );
      }
    } catch (err) {
      opts.logger?.warn({ err, count: snapshot.length }, 'Langfuse export failed');
    }
  }

  return {
    emit(event: CostEvent): void {
      buffer.push(event);
      if (buffer.length >= BUFFER_LIMIT) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        void flushBuffer();
      } else {
        scheduleFlush();
      }
    },
    async flush(): Promise<void> {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await flushBuffer();
    },
  };
}

// ── Factory — picks an exporter from environment variables ───

/**
 * Resolves which exporter to use based on env vars. Returns a
 * no-op if telemetry is disabled or no backend is configured.
 */
export function createTelemetryFromEnv(
  env: NodeJS.ProcessEnv,
  opts: TelemetryOptions = {},
): TelemetryExporter {
  if (env.CLAUDE_CODE_ENABLE_TELEMETRY !== '1') return createNoopExporter();

  if (env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
    return createLangfuseExporter({
      publicKey: env.LANGFUSE_PUBLIC_KEY,
      secretKey: env.LANGFUSE_SECRET_KEY,
      baseUrl: env.LANGFUSE_BASE_URL,
      ...opts,
    });
  }

  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const headers: Record<string, string> = {};
    if (env.OTEL_EXPORTER_OTLP_HEADERS) {
      for (const pair of env.OTEL_EXPORTER_OTLP_HEADERS.split(',')) {
        const [key, ...rest] = pair.split('=');
        if (key && rest.length > 0) headers[key.trim()] = rest.join('=').trim();
      }
    }
    return createOtlpExporter({
      endpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      headers,
      serviceName: env.OTEL_SERVICE_NAME,
      ...opts,
    });
  }

  return createNoopExporter();
}
