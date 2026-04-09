/**
 * CAP-033 / story 013-008: notification batcher.
 *
 * Pure module with no I/O. The hub's NotificationEngine can push
 * events into a batcher; events keyed by (sessionId, channel)
 * accumulate in a 5-second debounce window and are flushed as a
 * single batch payload to the caller's flush callback.
 *
 * Shape:
 *   const b = createBatcher({ windowMs: 5000, onFlush: (batch) => ... });
 *   b.push({ sessionId, channel, event });
 *   // ...within 5s of the first push for this (sessionId, channel) key,
 *   // subsequent events are appended; on window expiry, onFlush fires
 *   // with a BatchedNotification carrying all accumulated events.
 *
 * The module is timer-injectable so tests can use vitest's fake timers
 * without coupling to `setTimeout` globals.
 */

export interface BatcherEvent<TEvent = unknown> {
  sessionId: string;
  channel: string;
  event: TEvent;
}

export interface BatchedNotification<TEvent = unknown> {
  sessionId: string;
  channel: string;
  events: TEvent[];
  /** epoch ms of the first event in the batch */
  firstSeenAt: number;
  /** epoch ms when the batch was flushed */
  flushedAt: number;
}

export interface BatcherOptions<TEvent = unknown> {
  /** Debounce window in milliseconds; defaults to 5000 */
  windowMs?: number;
  /** Called when a batch is ready to deliver */
  onFlush: (batch: BatchedNotification<TEvent>) => void;
  /** Injectable clock + timers for testing; defaults to the real ones */
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

interface PendingBatch<TEvent> {
  events: TEvent[];
  firstSeenAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface Batcher<TEvent = unknown> {
  /** Add an event to the pending batch for its (sessionId, channel) key. */
  push(input: BatcherEvent<TEvent>): void;
  /** Flush a specific key immediately; returns true if it had pending events. */
  flushNow(sessionId: string, channel: string): boolean;
  /** Flush every pending batch immediately. */
  flushAll(): void;
  /** Release all timers. Use on shutdown so Node can exit. */
  dispose(): void;
  /** For tests: how many keys currently have pending events. */
  pendingSize(): number;
}

export function createBatcher<TEvent = unknown>(
  opts: BatcherOptions<TEvent>,
): Batcher<TEvent> {
  const windowMs = opts.windowMs ?? 5000;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  const pending = new Map<string, PendingBatch<TEvent>>();

  const keyOf = (sessionId: string, channel: string): string => `${sessionId}\u0000${channel}`;

  function flushKey(sessionId: string, channel: string): boolean {
    const key = keyOf(sessionId, channel);
    const batch = pending.get(key);
    if (!batch) return false;
    clearTimer(batch.timer);
    pending.delete(key);
    opts.onFlush({
      sessionId,
      channel,
      events: batch.events,
      firstSeenAt: batch.firstSeenAt,
      flushedAt: now(),
    });
    return true;
  }

  return {
    push(input: BatcherEvent<TEvent>): void {
      const key = keyOf(input.sessionId, input.channel);
      const existing = pending.get(key);
      if (existing) {
        existing.events.push(input.event);
        return;
      }
      // First event for this key — start the window.
      const timer = setTimer(() => {
        flushKey(input.sessionId, input.channel);
      }, windowMs);
      pending.set(key, {
        events: [input.event],
        firstSeenAt: now(),
        timer,
      });
    },

    flushNow(sessionId: string, channel: string): boolean {
      return flushKey(sessionId, channel);
    },

    flushAll(): void {
      // Snapshot the keys because flushKey mutates the map.
      const keys = [...pending.keys()];
      for (const key of keys) {
        const [sessionId, channel] = key.split('\u0000');
        if (sessionId !== undefined && channel !== undefined) {
          flushKey(sessionId, channel);
        }
      }
    },

    dispose(): void {
      for (const batch of pending.values()) {
        clearTimer(batch.timer);
      }
      pending.clear();
    },

    pendingSize(): number {
      return pending.size;
    },
  };
}
