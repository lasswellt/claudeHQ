import type { OutputChunk } from '@chq/shared';
import type { WsClient } from './ws-client.js';

export interface RecorderOptions {
  sessionId: string;
  wsClient: WsClient;
  uploadIntervalMs?: number;
}

export class Recorder {
  private buffer: OutputChunk[] = [];
  private uploadTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sessionId: string;
  private readonly wsClient: WsClient;
  private readonly uploadIntervalMs: number;
  private finalized = false;

  constructor(options: RecorderOptions) {
    this.sessionId = options.sessionId;
    this.wsClient = options.wsClient;
    this.uploadIntervalMs = options.uploadIntervalMs ?? 5000;
  }

  start(): void {
    this.uploadTimer = setInterval(() => this.flush(false), this.uploadIntervalMs);
  }

  addChunks(chunks: OutputChunk[]): void {
    if (this.finalized) return;
    this.buffer.push(...chunks);
  }

  finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }
    this.flush(true);
  }

  private flush(final: boolean): void {
    if (this.buffer.length === 0 && !final) return;

    const chunks = [...this.buffer];
    this.buffer = [];

    this.wsClient.send({
      type: 'agent:recording:upload',
      sessionId: this.sessionId,
      chunks,
      final,
    });
  }

  dispose(): void {
    if (this.uploadTimer) {
      clearInterval(this.uploadTimer);
      this.uploadTimer = null;
    }
    this.buffer = [];
  }
}
