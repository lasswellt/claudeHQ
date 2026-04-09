import { describe, it, expect, vi } from 'vitest';
import { createStreamJsonParser, type StreamJsonEvent } from '../parser.js';

// CAP-017 / story 014-007: stream-json line parser.

function collector(): {
  events: StreamJsonEvent[];
  errors: Array<{ reason: string; line: string }>;
  parser: ReturnType<typeof createStreamJsonParser>;
} {
  const events: StreamJsonEvent[] = [];
  const errors: Array<{ reason: string; line: string }> = [];
  const parser = createStreamJsonParser({
    onEvent: (e) => events.push(e),
    onError: (reason, line) => errors.push({ reason, line }),
  });
  return { events, errors, parser };
}

describe('createStreamJsonParser', () => {
  it('parses a single complete line', () => {
    const { events, parser } = collector();
    parser.push('{"type":"text_delta","text":"hello"}\n');
    expect(events).toEqual([{ type: 'textDelta', text: 'hello' }]);
  });

  it('parses multiple lines in one chunk', () => {
    const { events, parser } = collector();
    parser.push(
      '{"type":"text_delta","text":"a"}\n{"type":"text_delta","text":"b"}\n',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'textDelta', text: 'a' });
    expect(events[1]).toEqual({ type: 'textDelta', text: 'b' });
  });

  it('buffers partial lines across chunks', () => {
    const { events, parser } = collector();
    parser.push('{"type":"text_delta","tex');
    expect(events).toHaveLength(0);
    expect(parser.bufferedBytes()).toBeGreaterThan(0);
    parser.push('t":"hello"}\n');
    expect(events).toEqual([{ type: 'textDelta', text: 'hello' }]);
    expect(parser.bufferedBytes()).toBe(0);
  });

  it('flush() emits the buffered final line without a trailing newline', () => {
    const { events, parser } = collector();
    parser.push('{"type":"text_delta","text":"tail"}');
    expect(events).toHaveLength(0);
    parser.flush();
    expect(events).toEqual([{ type: 'textDelta', text: 'tail' }]);
  });

  it('skips blank lines', () => {
    const { events, errors, parser } = collector();
    parser.push('\n\n\n');
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('reports malformed JSON via onError', () => {
    const { events, errors, parser } = collector();
    parser.push('not json\n');
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.reason).toContain('JSON parse error');
  });

  it('continues after a malformed line', () => {
    const { events, errors, parser } = collector();
    parser.push('not json\n{"type":"text_delta","text":"ok"}\n');
    expect(events).toEqual([{ type: 'textDelta', text: 'ok' }]);
    expect(errors).toHaveLength(1);
  });

  it('reports non-object JSON as malformed', () => {
    const { events, errors, parser } = collector();
    parser.push('123\n');
    expect(events).toHaveLength(0);
    expect(errors[0]?.reason).toContain('not an object');
  });

  it('emits unknown event for objects without a type', () => {
    const { events, parser } = collector();
    parser.push('{"foo":"bar"}\n');
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('unknown');
  });

  describe('event translation', () => {
    it('translates tool_use → toolCalled', () => {
      const { events, parser } = collector();
      parser.push(
        '{"type":"tool_use","tool_name":"Bash","tool_input":{"cmd":"ls"},"tool_use_id":"t1"}\n',
      );
      expect(events[0]).toEqual({
        type: 'toolCalled',
        toolName: 'Bash',
        toolInput: { cmd: 'ls' },
        toolUseId: 't1',
      });
    });

    it('translates permission_ask → permissionAsked', () => {
      const { events, parser } = collector();
      parser.push(
        '{"type":"permission_ask","tool_name":"Bash","tool_use_id":"t2"}\n',
      );
      expect(events[0]).toEqual({
        type: 'permissionAsked',
        toolName: 'Bash',
        toolInput: undefined,
        toolUseId: 't2',
      });
    });

    it('translates tool_result → toolResult with is_error bool', () => {
      const { events, parser } = collector();
      parser.push(
        '{"type":"tool_result","tool_use_id":"t3","is_error":true,"content":"oops"}\n',
      );
      expect(events[0]).toEqual({
        type: 'toolResult',
        toolUseId: 't3',
        isError: true,
        content: 'oops',
      });
    });

    it('translates usage → costUpdated', () => {
      const { events, parser } = collector();
      parser.push(
        '{"type":"usage","input_tokens":100,"output_tokens":50,"total_cost_usd":0.0025}\n',
      );
      expect(events[0]).toEqual({
        type: 'costUpdated',
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        totalUsd: 0.0025,
      });
    });

    it('translates result → completed with exit_code', () => {
      const { events, parser } = collector();
      parser.push('{"type":"result","exit_code":0,"stop_reason":"end_turn"}\n');
      expect(events[0]).toEqual({
        type: 'completed',
        exitCode: 0,
        reason: 'end_turn',
      });
    });

    it('passes error events through with message', () => {
      const { events, parser } = collector();
      parser.push('{"type":"error","message":"API rate limit","detail":{"code":429}}\n');
      expect(events[0]).toEqual({
        type: 'error',
        message: 'API rate limit',
        detail: { code: 429 },
      });
    });
  });

  it('clears buffer and reports when line exceeds maxLineBytes', () => {
    const events: StreamJsonEvent[] = [];
    const errors: Array<{ reason: string }> = [];
    const parser = createStreamJsonParser({
      onEvent: (e) => events.push(e),
      onError: (reason) => errors.push({ reason }),
      maxLineBytes: 50,
    });
    // Push a 100-char garbage blob with no newline.
    parser.push('x'.repeat(100));
    expect(errors).toHaveLength(1);
    expect(errors[0]?.reason).toContain('exceeded maxLineBytes');
    expect(parser.bufferedBytes()).toBe(0);
    // Parser should recover and parse the next valid line.
    parser.push('{"type":"text_delta","text":"recovered"}\n');
    expect(events).toEqual([{ type: 'textDelta', text: 'recovered' }]);
  });

  it('accepts Buffer chunks', () => {
    const { events, parser } = collector();
    parser.push(Buffer.from('{"type":"text_delta","text":"buf"}\n', 'utf-8'));
    expect(events).toEqual([{ type: 'textDelta', text: 'buf' }]);
  });
});
