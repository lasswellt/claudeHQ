import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createNoopExporter,
  createOtlpExporter,
  createLangfuseExporter,
  createTelemetryFromEnv,
  type CostEvent,
} from '../telemetry.js';

// CAP-074 / stories 015-007 + 015-008: telemetry exporters.

function costEvent(overrides: Partial<CostEvent> = {}): CostEvent {
  return {
    sessionId: 'sess-1',
    machineId: 'm1',
    model: 'claude-sonnet-4-6',
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.0125,
    timestampMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe('createNoopExporter', () => {
  it('never throws', () => {
    const exporter = createNoopExporter();
    expect(() => exporter.emit(costEvent())).not.toThrow();
    expect(exporter.flush()).resolves.toBeUndefined();
  });
});

describe('createOtlpExporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes on flush() without waiting for the interval', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter({
      endpoint: 'https://otlp.example',
      fetchFn,
    });

    exporter.emit(costEvent());
    expect(fetchFn).not.toHaveBeenCalled();

    await exporter.flush();
    expect(fetchFn).toHaveBeenCalledOnce();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://otlp.example/v1/traces');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.resourceSpans).toBeDefined();
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(1);
  });

  it('auto-flushes when buffer hits 64 events', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter({ endpoint: 'https://otlp.example', fetchFn });

    for (let i = 0; i < 64; i++) {
      exporter.emit(costEvent({ sessionId: `sess-${i}` }));
    }
    // Synchronous buffer-limit flush — give the promise microtask to settle.
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    const body = JSON.parse(
      (fetchFn.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    expect(body.resourceSpans[0].scopeSpans[0].spans).toHaveLength(64);
  });

  it('auto-flushes after the flush window expires', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter({ endpoint: 'https://otlp.example', fetchFn });

    exporter.emit(costEvent());
    expect(fetchFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
  });

  it('builds span attributes from the cost event', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter({
      endpoint: 'https://otlp.example',
      fetchFn,
      serviceName: 'test-service',
    });

    exporter.emit(
      costEvent({
        cacheReadTokens: 200,
        cacheWriteTokens: 50,
        userId: 'u-1',
        repoId: 'r-1',
      }),
    );
    await exporter.flush();

    const body = JSON.parse(
      (fetchFn.mock.calls[0]?.[1] as RequestInit).body as string,
    );
    const span = body.resourceSpans[0].scopeSpans[0].spans[0];
    const attrsByKey = Object.fromEntries(
      span.attributes.map((a: { key: string; value: Record<string, unknown> }) => [a.key, a.value]),
    );
    expect(attrsByKey['claude.session_id'].stringValue).toBe('sess-1');
    expect(attrsByKey['claude.machine_id'].stringValue).toBe('m1');
    expect(attrsByKey['claude.model'].stringValue).toBe('claude-sonnet-4-6');
    expect(attrsByKey['claude.input_tokens'].intValue).toBe('1000');
    expect(attrsByKey['claude.output_tokens'].intValue).toBe('500');
    expect(attrsByKey['claude.cache_read_tokens'].intValue).toBe('200');
    expect(attrsByKey['claude.cache_write_tokens'].intValue).toBe('50');
    expect(attrsByKey['claude.cost_usd'].doubleValue).toBeCloseTo(0.0125);
    expect(attrsByKey['claude.user_id'].stringValue).toBe('u-1');
    expect(attrsByKey['claude.repo_id'].stringValue).toBe('r-1');
    expect(body.resourceSpans[0].resource.attributes[0].value.stringValue).toBe('test-service');
  });

  it('swallows fetch errors without throwing', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const exporter = createOtlpExporter({
      endpoint: 'https://otlp.example',
      fetchFn,
      logger: { warn },
    });

    exporter.emit(costEvent());
    await expect(exporter.flush()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('swallows non-ok responses', async () => {
    const warn = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(new Response('err', { status: 503 }));
    const exporter = createOtlpExporter({
      endpoint: 'https://otlp.example',
      fetchFn,
      logger: { warn },
    });

    exporter.emit(costEvent());
    await exporter.flush();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ status: 503 }),
      expect.any(String),
    );
  });
});

describe('createLangfuseExporter', () => {
  it('builds basic-auth header from public + secret key', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createLangfuseExporter({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      fetchFn,
    });

    exporter.emit(costEvent());
    await exporter.flush();

    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const expected = 'Basic ' + Buffer.from('pk-test:sk-test').toString('base64');
    expect(headers.Authorization).toBe(expected);
  });

  it('POSTs to /api/public/ingestion with a batch payload', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createLangfuseExporter({
      publicKey: 'pk',
      secretKey: 'sk',
      fetchFn,
    });
    exporter.emit(costEvent({ sessionId: 'a' }));
    exporter.emit(costEvent({ sessionId: 'b' }));
    await exporter.flush();

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://cloud.langfuse.com/api/public/ingestion');
    const body = JSON.parse(init.body as string);
    expect(body.batch).toHaveLength(2);
    expect(body.batch[0].body.id).toBe('a');
    expect(body.batch[0].body.metadata.costUsd).toBeCloseTo(0.0125);
  });

  it('honors baseUrl override', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createLangfuseExporter({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://langfuse.self-hosted/',
      fetchFn,
    });
    exporter.emit(costEvent());
    await exporter.flush();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://langfuse.self-hosted/api/public/ingestion');
  });
});

describe('createTelemetryFromEnv', () => {
  it('returns noop when CLAUDE_CODE_ENABLE_TELEMETRY is unset', () => {
    const exporter = createTelemetryFromEnv({});
    // No way to directly detect noop; just verify it doesn't throw.
    expect(() => exporter.emit(costEvent())).not.toThrow();
  });

  it('returns noop when enabled but no backend configured', () => {
    const exporter = createTelemetryFromEnv({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
    });
    expect(() => exporter.emit(costEvent())).not.toThrow();
  });

  it('prefers Langfuse when keys are present', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createTelemetryFromEnv(
      {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        LANGFUSE_PUBLIC_KEY: 'pk',
        LANGFUSE_SECRET_KEY: 'sk',
      },
      { fetchFn },
    );
    exporter.emit(costEvent());
    await exporter.flush();
    expect(fetchFn.mock.calls[0]?.[0]).toContain('langfuse');
  });

  it('falls back to OTLP when only the OTLP env is set', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createTelemetryFromEnv(
      {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example',
      },
      { fetchFn },
    );
    exporter.emit(costEvent());
    await exporter.flush();
    expect(fetchFn.mock.calls[0]?.[0]).toBe('https://otel.example/v1/traces');
  });

  it('parses OTEL_EXPORTER_OTLP_HEADERS', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createTelemetryFromEnv(
      {
        CLAUDE_CODE_ENABLE_TELEMETRY: '1',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example',
        OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer abc,X-Extra=val',
      },
      { fetchFn },
    );
    exporter.emit(costEvent());
    await exporter.flush();
    const headers = (fetchFn.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer abc');
    expect(headers['X-Extra']).toBe('val');
  });
});
