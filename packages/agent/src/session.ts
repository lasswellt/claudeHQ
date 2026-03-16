import * as pty from 'node-pty';
import type { OutputChunk } from '@chq/shared';
import { EventEmitter } from 'node:events';

export type SessionState = 'spawning' | 'running' | 'completed' | 'failed';

export interface PtySessionOptions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  machineId: string;
  cols?: number;
  rows?: number;
}

export interface PtySessionEvents {
  output: (chunks: OutputChunk[]) => void;
  stateChange: (state: SessionState) => void;
  exit: (exitCode: number, signal?: number) => void;
}

export class PtySession extends EventEmitter {
  readonly id: string;
  private ptyProcess: pty.IPty | null = null;
  private _state: SessionState = 'spawning';
  private _exitCode: number | null = null;
  private _claudeSessionId: string | null = null;
  private readonly startTime: number;
  private outputBuffer: OutputChunk[] = [];
  private bufferTimer: ReturnType<typeof setInterval> | null = null;
  private readonly options: PtySessionOptions;

  constructor(options: PtySessionOptions) {
    super();
    this.id = options.id;
    this.options = options;
    this.startTime = Date.now();
  }

  get state(): SessionState {
    return this._state;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get claudeSessionId(): string | null {
    return this._claudeSessionId;
  }

  get pid(): number | undefined {
    return this.ptyProcess?.pid;
  }

  spawn(): void {
    const { command, args, cwd, env, cols, rows } = this.options;

    this.ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: cols ?? 120,
      rows: rows ?? 30,
      cwd,
      env: { ...process.env, ...env } as Record<string, string>,
    });

    this.setState('running');

    // Buffer output chunks
    this.ptyProcess.onData((data: string) => {
      const chunk: OutputChunk = {
        ts: Date.now() - this.startTime,
        data,
      };
      this.outputBuffer.push(chunk);

      // Try to extract Claude session ID from output
      this.tryExtractSessionId(data);
    });

    // Flush buffer periodically
    this.bufferTimer = setInterval(() => this.flushOutput(), 100);

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this._exitCode = exitCode;
      this.flushOutput(); // Flush remaining buffer
      this.cleanup();
      this.setState(exitCode === 0 ? 'completed' : 'failed');
      this.emit('exit', exitCode, signal);
    });
  }

  write(data: string): void {
    if (this._state !== 'running' || !this.ptyProcess) {
      throw new Error(`Cannot write to session ${this.id} in state ${this._state}`);
    }
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(cols, rows);
  }

  kill(): void {
    if (!this.ptyProcess) return;

    // Try SIGTERM first
    this.ptyProcess.kill();

    // Force kill after 5 seconds
    setTimeout(() => {
      if (this._state === 'running') {
        this.ptyProcess?.kill('SIGKILL');
      }
    }, 5000);
  }

  private setState(state: SessionState): void {
    this._state = state;
    this.emit('stateChange', state);
  }

  private flushOutput(): void {
    if (this.outputBuffer.length === 0) return;
    const chunks = [...this.outputBuffer];
    this.outputBuffer = [];
    this.emit('output', chunks);
  }

  private cleanup(): void {
    if (this.bufferTimer) {
      clearInterval(this.bufferTimer);
      this.bufferTimer = null;
    }
  }

  private tryExtractSessionId(data: string): void {
    if (this._claudeSessionId) return;
    // Look for session ID in stream-json output
    const match = data.match(/"session_id"\s*:\s*"([^"]+)"/);
    if (match?.[1]) {
      this._claudeSessionId = match[1];
    }
  }

  dispose(): void {
    this.cleanup();
    if (this.ptyProcess && this._state === 'running') {
      this.ptyProcess.kill('SIGKILL');
    }
    this.ptyProcess = null;
    this.removeAllListeners();
  }
}
