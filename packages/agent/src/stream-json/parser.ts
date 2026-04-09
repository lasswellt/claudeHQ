/**
 * CAP-017 / story 014-007: dual-stream JSON line parser.
 *
 * Claude Code's `--output-format stream-json` emits one JSON object
 * per line on stdout. This parser:
 *   - Buffers partial lines across chunks (important because the
 *     child process's stdout is a byte stream, not a line stream).
 *   - Emits typed events for recognized types.
 *   - Tolerates malformed JSON lines (logs via the injected reporter
 *     and skips so the stream keeps flowing).
 *   - Is pure (no node-specific I/O beyond Buffer) so it can be
 *     unit-tested by feeding synthetic chunks.
 *
 * The dual-stream architecture: the agent spawns the claude process
 * with stdout piped (stream-json) and the PTY routed separately.
 * This parser handles the stdout path; the PTY path stays as raw
 * ANSI going to the recorder. Neither stream is touched by the
 * other, so ANSI artifacts can't corrupt the JSON events and vice
 * versa.
 */

export type StreamJsonEvent =
  | { type: 'permissionAsked'; toolName: string; toolInput?: unknown; toolUseId?: string }
  | { type: 'toolCalled'; toolName: string; toolInput?: unknown; toolUseId?: string }
  | { type: 'toolResult'; toolUseId: string; isError?: boolean; content?: unknown }
  | { type: 'textDelta'; text: string }
  | {
      type: 'costUpdated';
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      totalUsd?: number;
    }
  | { type: 'completed'; exitCode?: number; reason?: string }
  | { type: 'error'; message: string; detail?: unknown }
  | { type: 'unknown'; raw: Record<string, unknown> };

export interface ParserOptions {
  /** Called for every successfully-parsed event. */
  onEvent: (event: StreamJsonEvent) => void;
  /** Called when a line fails to parse. Optional; defaults to silent. */
  onError?: (reason: string, rawLine: string) => void;
  /**
   * Maximum length of a buffered partial line before the parser
   * gives up and discards. Prevents a runaway child from
   * exhausting memory. Defaults to 10 MB.
   */
  maxLineBytes?: number;
}

export interface StreamJsonParser {
  /** Feed a chunk of stdout bytes (or a string). */
  push(chunk: Buffer | string): void;
  /** Flush any buffered final line (e.g. on stream close). */
  flush(): void;
  /** For tests: bytes currently held in the partial-line buffer. */
  bufferedBytes(): number;
}

export function createStreamJsonParser(opts: ParserOptions): StreamJsonParser {
  const maxLineBytes = opts.maxLineBytes ?? 10 * 1024 * 1024;
  const onError = opts.onError ?? (() => {});

  let buffer = '';

  function reportMalformed(reason: string, line: string): void {
    onError(reason, line);
  }

  function handleLine(rawLine: string): void {
    const line = rawLine.trim();
    if (line.length === 0) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      reportMalformed(`JSON parse error: ${(e as Error).message}`, rawLine);
      return;
    }

    if (typeof parsed !== 'object' || parsed === null) {
      reportMalformed('Event is not an object', rawLine);
      return;
    }

    const obj = parsed as Record<string, unknown>;
    const rawType = obj.type;
    if (typeof rawType !== 'string') {
      opts.onEvent({ type: 'unknown', raw: obj });
      return;
    }

    opts.onEvent(translate(rawType, obj));
  }

  return {
    push(chunk: Buffer | string): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      buffer += text;

      if (buffer.length > maxLineBytes) {
        reportMalformed(`Line exceeded maxLineBytes (${maxLineBytes})`, buffer);
        buffer = '';
        return;
      }

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        handleLine(line);
      }
    },

    flush(): void {
      if (buffer.length > 0) {
        handleLine(buffer);
        buffer = '';
      }
    },

    bufferedBytes(): number {
      return buffer.length;
    },
  };
}

/**
 * Maps Claude's stream-json event types into the parser's typed
 * union. Unknown types fall through as `{ type: 'unknown', raw }`
 * so downstream code can still audit them.
 */
function translate(rawType: string, obj: Record<string, unknown>): StreamJsonEvent {
  switch (rawType) {
    case 'permission_ask':
    case 'permissionAsked':
      return {
        type: 'permissionAsked',
        toolName: asString(obj.tool_name) ?? asString(obj.toolName) ?? 'unknown',
        toolInput: obj.tool_input ?? obj.toolInput,
        toolUseId: asString(obj.tool_use_id) ?? asString(obj.toolUseId),
      };

    case 'tool_use':
    case 'toolCalled':
      return {
        type: 'toolCalled',
        toolName: asString(obj.tool_name) ?? asString(obj.toolName) ?? 'unknown',
        toolInput: obj.tool_input ?? obj.toolInput,
        toolUseId: asString(obj.tool_use_id) ?? asString(obj.toolUseId),
      };

    case 'tool_result':
    case 'toolResult': {
      const toolUseId = asString(obj.tool_use_id) ?? asString(obj.toolUseId) ?? '';
      return {
        type: 'toolResult',
        toolUseId,
        isError: typeof obj.is_error === 'boolean' ? obj.is_error : typeof obj.isError === 'boolean' ? obj.isError : undefined,
        content: obj.content,
      };
    }

    case 'text_delta':
    case 'textDelta':
      return { type: 'textDelta', text: asString(obj.text) ?? '' };

    case 'usage':
    case 'costUpdated':
      return {
        type: 'costUpdated',
        inputTokens: asNumber(obj.input_tokens) ?? asNumber(obj.inputTokens),
        outputTokens: asNumber(obj.output_tokens) ?? asNumber(obj.outputTokens),
        cacheReadTokens: asNumber(obj.cache_read_input_tokens) ?? asNumber(obj.cacheReadTokens),
        cacheWriteTokens: asNumber(obj.cache_creation_input_tokens) ?? asNumber(obj.cacheWriteTokens),
        totalUsd: asNumber(obj.total_cost_usd) ?? asNumber(obj.totalUsd),
      };

    case 'result':
    case 'completed':
      return {
        type: 'completed',
        exitCode: asNumber(obj.exit_code) ?? asNumber(obj.exitCode),
        reason: asString(obj.reason) ?? asString(obj.stop_reason),
      };

    case 'error':
      return {
        type: 'error',
        message: asString(obj.message) ?? asString(obj.error) ?? 'unknown error',
        detail: obj.detail,
      };

    default:
      return { type: 'unknown', raw: obj };
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
