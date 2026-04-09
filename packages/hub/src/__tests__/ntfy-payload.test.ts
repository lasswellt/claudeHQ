import { describe, it, expect } from 'vitest';
import { buildNtfyPayload } from '../notifications.js';

// CAP-032 / story 013-011: ntfy payload mapping.

describe('buildNtfyPayload', () => {
  it('maps session_failed to urgent priority with error tag', () => {
    const out = buildNtfyPayload({
      type: 'session_failed',
      sessionId: 'sess-1',
      machineId: 'studio',
      data: { error: 'Process exited with code 1' },
    });
    expect(out.priority).toBe(5);
    expect(out.tags).toContain('rotating_light');
    expect(out.title).toContain('session failed');
    expect(out.body).toBe('Process exited with code 1');
  });

  it('maps approval events to priority 4 with shield tag', () => {
    const out = buildNtfyPayload({
      type: 'approval.requested',
      sessionId: 'sess-1',
      machineId: 'studio',
      data: { toolName: 'Bash' },
    });
    expect(out.priority).toBe(4);
    expect(out.tags).toContain('shield');
  });

  it('maps session_completed to default priority with check tag', () => {
    const out = buildNtfyPayload({
      type: 'session_completed',
      sessionId: 'sess-1',
      data: {},
    });
    expect(out.priority).toBe(3);
    expect(out.tags).toContain('white_check_mark');
  });

  it('maps session_started to low priority with rocket tag', () => {
    const out = buildNtfyPayload({
      type: 'session_started',
      sessionId: 'sess-1',
      machineId: 'studio',
      data: { prompt: 'Fix the bug' },
    });
    expect(out.priority).toBe(2);
    expect(out.tags).toContain('rocket');
    expect(out.body).toBe('Fix the bug');
  });

  it('adds a machine=<id> tag when machineId is present', () => {
    const out = buildNtfyPayload({
      type: 'session_completed',
      machineId: 'studio-pc',
      data: {},
    });
    expect(out.tags).toContain('machine=studio-pc');
  });

  it('falls back to JSON-encoded data when no message/prompt/error', () => {
    const out = buildNtfyPayload({
      type: 'custom_event',
      data: { foo: 'bar', n: 1 },
    });
    expect(() => JSON.parse(out.body)).not.toThrow();
    expect(JSON.parse(out.body)).toEqual({ foo: 'bar', n: 1 });
  });

  it('prefers message over prompt over error in body', () => {
    const out = buildNtfyPayload({
      type: 'x',
      data: { message: 'primary', prompt: 'secondary', error: 'tertiary' },
    });
    expect(out.body).toBe('primary');
  });

  it('default priority 3 for unknown event types', () => {
    const out = buildNtfyPayload({ type: 'something_else', data: { message: 'hi' } });
    expect(out.priority).toBe(3);
  });
});
