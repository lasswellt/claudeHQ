/**
 * CAP-084 / story 018-004: Claude Code image pre-pull + weekly refresh.
 *
 * Called from the agent daemon on startup and then on a weekly
 * cadence to keep the pinned image fresh. Uses a thin `ImagePuller`
 * interface so the unit tests can stub out Dockerode.
 */

export interface PullReport {
  image: string;
  /** Image digest (sha256:...) if available. */
  digest?: string;
  /** Bytes downloaded for the last pull. `null` if unknown. */
  sizeBytes?: number | null;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** True if the pull actually downloaded new bytes. */
  updated: boolean;
}

export interface ImagePuller {
  /** Pull the image by tag. Resolves when the pull is complete. */
  pull(image: string): Promise<PullReport>;
}

export interface PrepullOptions {
  puller: ImagePuller;
  images: string[];
  logger: {
    info: (obj: object, msg?: string) => void;
    warn: (obj: object, msg?: string) => void;
    error: (obj: object, msg?: string) => void;
  };
  /** Abort after this many ms if a single pull hangs. Default 5 min. */
  perImageTimeoutMs?: number;
}

export interface PrepullResult {
  ok: boolean;
  reports: PullReport[];
  errors: Array<{ image: string; message: string }>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Pulls every image in sequence. Any failure bubbles up in
 * `errors` but the remaining images still get a shot — a flaky
 * registry shouldn't block startup for images that succeeded.
 */
export async function prepullImages(opts: PrepullOptions): Promise<PrepullResult> {
  const timeoutMs = opts.perImageTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const reports: PullReport[] = [];
  const errors: Array<{ image: string; message: string }> = [];

  for (const image of opts.images) {
    opts.logger.info({ image }, 'pulling image');
    const started = Date.now();
    try {
      const report = await withTimeout(opts.puller.pull(image), timeoutMs, image);
      reports.push(report);
      opts.logger.info(
        {
          image,
          digest: report.digest,
          sizeBytes: report.sizeBytes,
          updated: report.updated,
          durationMs: Date.now() - started,
        },
        'image pull complete',
      );
    } catch (err) {
      const message = (err as Error).message;
      errors.push({ image, message });
      opts.logger.error({ image, err }, 'image pull failed');
    }
  }

  return { ok: errors.length === 0, reports, errors };
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Pull timeout after ${ms}ms for ${label}`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (err: unknown) => {
        clearTimeout(t);
        reject(err as Error);
      },
    );
  });
}

// ── Weekly refresh scheduler ──────────────────────────────────

export interface RefreshScheduler {
  start(): void;
  stop(): void;
}

export interface CreateRefreshOptions {
  intervalMs?: number;
  onTick: () => Promise<void> | void;
  logger: { warn: (obj: object, msg?: string) => void };
}

const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;

export function createRefreshScheduler(opts: CreateRefreshOptions): RefreshScheduler {
  const interval = opts.intervalMs ?? WEEKLY_MS;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<void> {
    try {
      await opts.onTick();
    } catch (err) {
      opts.logger.warn({ err }, 'image refresh tick failed');
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => {
        void tick();
      }, interval);
      timer.unref?.();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
