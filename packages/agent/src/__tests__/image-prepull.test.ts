import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  prepullImages,
  createRefreshScheduler,
  type PullReport,
  type ImagePuller,
} from '../image-prepull.js';

// CAP-084 / story 018-004: image pre-pull + weekly refresh.

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function makePuller(
  reports: Record<string, Partial<PullReport> | Error>,
): ImagePuller {
  return {
    async pull(image: string): Promise<PullReport> {
      const r = reports[image];
      if (r instanceof Error) throw r;
      return {
        image,
        digest: r?.digest ?? 'sha256:deadbeef',
        sizeBytes: r?.sizeBytes ?? 1000,
        durationMs: r?.durationMs ?? 10,
        updated: r?.updated ?? true,
      };
    },
  };
}

beforeEach(() => {
  silentLogger.info.mockClear();
  silentLogger.warn.mockClear();
  silentLogger.error.mockClear();
});

describe('prepullImages', () => {
  it('returns ok:true when every image pulls', async () => {
    const puller = makePuller({
      'ghcr.io/anthropics/claude-code:latest': { digest: 'sha256:aaa' },
    });
    const result = await prepullImages({
      puller,
      images: ['ghcr.io/anthropics/claude-code:latest'],
      logger: silentLogger,
    });
    expect(result.ok).toBe(true);
    expect(result.reports).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('collects errors without aborting remaining pulls', async () => {
    const puller = makePuller({
      'good:1': { digest: 'sha256:good' },
      'bad:1': new Error('connection refused'),
      'alsogood:1': { digest: 'sha256:more' },
    });
    const result = await prepullImages({
      puller,
      images: ['good:1', 'bad:1', 'alsogood:1'],
      logger: silentLogger,
    });
    expect(result.ok).toBe(false);
    expect(result.reports).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.image).toBe('bad:1');
    expect(result.errors[0]?.message).toContain('connection refused');
  });

  it('logs info per successful pull', async () => {
    const puller = makePuller({ 'a': {}, 'b': {} });
    await prepullImages({ puller, images: ['a', 'b'], logger: silentLogger });
    expect(silentLogger.info).toHaveBeenCalled();
    // 2 "pulling image" + 2 "image pull complete" = 4 info calls
    expect(silentLogger.info.mock.calls.length).toBe(4);
  });

  it('logs error when a pull fails', async () => {
    const puller = makePuller({ 'bad': new Error('nope') });
    await prepullImages({ puller, images: ['bad'], logger: silentLogger });
    expect(silentLogger.error).toHaveBeenCalledOnce();
  });

  it('aborts a single pull that exceeds the per-image timeout', async () => {
    const slowPuller: ImagePuller = {
      pull() {
        return new Promise((_, reject) => {
          // Never resolves; test relies on our timeout wrapper.
          setTimeout(() => reject(new Error('fallback')), 10_000);
        });
      },
    };
    const result = await prepullImages({
      puller: slowPuller,
      images: ['slow'],
      logger: silentLogger,
      perImageTimeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toContain('timeout');
  });
});

describe('createRefreshScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onTick on the configured interval', async () => {
    const onTick = vi.fn().mockResolvedValue(undefined);
    const sched = createRefreshScheduler({
      intervalMs: 1000,
      onTick,
      logger: silentLogger,
    });
    sched.start();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(onTick).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(onTick).toHaveBeenCalledTimes(2);

    sched.stop();
  });

  it('stop() cancels the interval', async () => {
    const onTick = vi.fn();
    const sched = createRefreshScheduler({
      intervalMs: 1000,
      onTick,
      logger: silentLogger,
    });
    sched.start();
    sched.stop();

    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    expect(onTick).not.toHaveBeenCalled();
  });

  it('swallows onTick errors via the logger', async () => {
    const onTick = vi.fn().mockRejectedValue(new Error('flaky network'));
    const sched = createRefreshScheduler({
      intervalMs: 1000,
      onTick,
      logger: silentLogger,
    });
    sched.start();
    vi.advanceTimersByTime(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(silentLogger.warn).toHaveBeenCalled();
    sched.stop();
  });
});
