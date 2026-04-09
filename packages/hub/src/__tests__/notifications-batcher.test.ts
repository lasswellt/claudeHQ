import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBatcher, type BatchedNotification } from '../notifications/batcher.js';

// CAP-033 / story 013-008: notification batcher.

describe('createBatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes a single event after the window expires', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({
      windowMs: 5000,
      onFlush: (batch) => flushed.push(batch),
    });

    b.push({ sessionId: 's1', channel: 'ntfy', event: 'hello' });
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(4999);
    expect(flushed).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.events).toEqual(['hello']);
    expect(flushed[0]?.sessionId).toBe('s1');
    expect(flushed[0]?.channel).toBe('ntfy');
  });

  it('accumulates events for the same (session, channel) within the window', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({ windowMs: 5000, onFlush: (batch) => flushed.push(batch) });

    b.push({ sessionId: 's1', channel: 'ntfy', event: 'a' });
    vi.advanceTimersByTime(1000);
    b.push({ sessionId: 's1', channel: 'ntfy', event: 'b' });
    vi.advanceTimersByTime(1000);
    b.push({ sessionId: 's1', channel: 'ntfy', event: 'c' });

    vi.advanceTimersByTime(3000); // total 5s since the first push
    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.events).toEqual(['a', 'b', 'c']);
  });

  it('keeps separate batches per (session, channel) key', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({ windowMs: 5000, onFlush: (batch) => flushed.push(batch) });

    b.push({ sessionId: 's1', channel: 'ntfy', event: 'x' });
    b.push({ sessionId: 's2', channel: 'ntfy', event: 'y' });
    b.push({ sessionId: 's1', channel: 'browser', event: 'z' });

    vi.advanceTimersByTime(5000);
    expect(flushed).toHaveLength(3);
    const keys = flushed.map((f) => `${f.sessionId}:${f.channel}`).sort();
    expect(keys).toEqual(['s1:browser', 's1:ntfy', 's2:ntfy']);
  });

  it('flushNow flushes a specific key and cancels the timer', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({ windowMs: 5000, onFlush: (batch) => flushed.push(batch) });

    b.push({ sessionId: 's1', channel: 'ntfy', event: 'eager' });
    expect(b.flushNow('s1', 'ntfy')).toBe(true);
    expect(flushed).toHaveLength(1);

    vi.advanceTimersByTime(10_000);
    // Timer should have been cancelled; no double flush.
    expect(flushed).toHaveLength(1);
  });

  it('flushNow returns false when the key has no pending events', () => {
    const b = createBatcher({ windowMs: 5000, onFlush: () => {} });
    expect(b.flushNow('nobody', 'ntfy')).toBe(false);
  });

  it('flushAll drains every pending batch', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({ windowMs: 5000, onFlush: (batch) => flushed.push(batch) });
    b.push({ sessionId: 'a', channel: 'ntfy', event: '1' });
    b.push({ sessionId: 'b', channel: 'ntfy', event: '2' });
    b.push({ sessionId: 'c', channel: 'browser', event: '3' });
    b.flushAll();
    expect(flushed).toHaveLength(3);
    expect(b.pendingSize()).toBe(0);
  });

  it('dispose clears timers without flushing', () => {
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({ windowMs: 5000, onFlush: (batch) => flushed.push(batch) });
    b.push({ sessionId: 's1', channel: 'ntfy', event: 'x' });
    b.dispose();
    vi.advanceTimersByTime(10_000);
    expect(flushed).toHaveLength(0);
    expect(b.pendingSize()).toBe(0);
  });

  it('firstSeenAt and flushedAt reflect the injected clock', () => {
    let fakeNow = 1_700_000_000_000;
    const flushed: BatchedNotification<string>[] = [];
    const b = createBatcher<string>({
      windowMs: 5000,
      now: () => fakeNow,
      onFlush: (batch) => flushed.push(batch),
    });

    b.push({ sessionId: 's1', channel: 'ntfy', event: 'a' });
    fakeNow += 2000;
    b.push({ sessionId: 's1', channel: 'ntfy', event: 'b' });
    fakeNow += 3000;
    vi.advanceTimersByTime(5000); // triggers flush

    expect(flushed).toHaveLength(1);
    expect(flushed[0]?.firstSeenAt).toBe(1_700_000_000_000);
    expect(flushed[0]?.flushedAt).toBe(1_700_000_005_000);
  });
});
