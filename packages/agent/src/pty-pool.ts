import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PtySession, type PtySessionOptions, type SessionState } from './session.js';
import type { OutputChunk } from '@chq/shared';

export interface PoolSessionInfo {
  id: string;
  state: SessionState;
  pid: number | undefined;
  exitCode: number | null;
  claudeSessionId: string | null;
}

export interface SpawnOptions {
  prompt: string;
  cwd: string;
  flags?: string[];
  machineId: string;
  claudeBinary?: string;
  sessionId?: string;
}

export class PtyPool extends EventEmitter {
  private sessions = new Map<string, PtySession>();
  private readonly maxSessions: number;

  constructor(maxSessions: number = 2) {
    super();
    this.maxSessions = maxSessions;
  }

  get activeCount(): number {
    return [...this.sessions.values()].filter((s) => s.state === 'running').length;
  }

  get hasCapacity(): boolean {
    return this.activeCount < this.maxSessions;
  }

  spawn(options: SpawnOptions): string {
    if (!this.hasCapacity) {
      throw new Error(
        `Pool at capacity (${this.activeCount}/${this.maxSessions}). Queue the task or wait.`,
      );
    }

    const sessionId = options.sessionId ?? randomUUID();
    const claudeBinary = options.claudeBinary ?? 'claude';

    const args = [
      '-p',
      options.prompt,
      '-n',
      `chq:${options.machineId}:${sessionId}`,
      ...(options.flags ?? ['--dangerously-skip-permissions']),
    ];

    const sessionOpts: PtySessionOptions = {
      id: sessionId,
      command: claudeBinary,
      args,
      cwd: options.cwd,
      machineId: options.machineId,
    };

    const session = new PtySession(sessionOpts);

    // Forward events
    session.on('output', (chunks: OutputChunk[]) => {
      this.emit('session:output', sessionId, chunks);
    });

    session.on('stateChange', (state: SessionState) => {
      this.emit('session:stateChange', sessionId, state);
    });

    session.on('exit', (exitCode: number, signal?: number) => {
      this.emit('session:exit', sessionId, exitCode, signal);
      // Remove from active pool after exit
      this.sessions.delete(sessionId);
      session.dispose();
    });

    this.sessions.set(sessionId, session);
    session.spawn();
    this.emit('session:started', sessionId);

    return sessionId;
  }

  get(sessionId: string): PtySession | undefined {
    return this.sessions.get(sessionId);
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.kill();
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.write(data);
  }

  async killAll(): Promise<void> {
    const killPromises = [...this.sessions.entries()].map(
      ([id, session]) =>
        new Promise<void>((resolve) => {
          if (session.state !== 'running') {
            resolve();
            return;
          }
          session.on('exit', () => resolve());
          session.kill();
          // Force resolve after 10s
          setTimeout(resolve, 10_000);
        }),
    );
    await Promise.all(killPromises);
  }

  list(): PoolSessionInfo[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      state: s.state,
      pid: s.pid,
      exitCode: s.exitCode,
      claudeSessionId: s.claudeSessionId,
    }));
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.removeAllListeners();
  }
}
