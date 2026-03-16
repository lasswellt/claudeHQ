import os from 'node:os';
import { type AgentConfig, type HubToAgentMessage } from '@chq/shared';
import { PtyPool } from './pty-pool.js';
import { WsClient } from './ws-client.js';
import { Recorder } from './recorder.js';
import { getSystemHealth } from './health.js';
import { writeHooksConfig } from './hooks-config.js';
import type { OutputChunk } from '@chq/shared';
import pino from 'pino';

const log = pino({ name: 'chq-agent' });

export class Daemon {
  private readonly config: AgentConfig;
  private readonly pool: PtyPool;
  private readonly wsClient: WsClient;
  private readonly recorders = new Map<string, Recorder>();
  private readonly sessionMeta = new Map<string, { prompt: string; cwd: string }>();
  private running = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.pool = new PtyPool(config.maxConcurrentSessions);

    this.wsClient = new WsClient({
      url: config.hubUrl,
      machineId: config.machineId,
      version: '0.1.0',
      maxSessions: config.maxConcurrentSessions,
      os: `${os.platform()}-${os.arch()}`,
      onMessage: (msg) => this.handleHubMessage(msg),
    });
  }

  async start(): Promise<void> {
    log.info({ machineId: this.config.machineId }, 'Starting agent daemon');

    // Write Claude Code hooks config before spawning any sessions
    writeHooksConfig(this.config.hubUrl);
    log.info('Wrote Claude Code hooks config');

    // Wire up pool events → WS client
    this.pool.on('session:started', (sessionId: string) => {
      const session = this.pool.get(sessionId);
      if (!session) return;

      const meta = this.sessionMeta.get(sessionId);
      this.wsClient.send({
        type: 'agent:session:started',
        sessionId,
        machineId: this.config.machineId,
        prompt: meta?.prompt ?? '',
        cwd: meta?.cwd ?? '',
        pid: session.pid ?? 0,
      });
    });

    this.pool.on('session:output', (sessionId: string, chunks: OutputChunk[]) => {
      this.wsClient.send({
        type: 'agent:session:output',
        sessionId,
        chunks,
      });

      // Forward to recorder
      const recorder = this.recorders.get(sessionId);
      if (recorder) recorder.addChunks(chunks);
    });

    this.pool.on('session:exit', (sessionId: string, exitCode: number) => {
      const session = this.pool.get(sessionId);
      this.wsClient.send({
        type: 'agent:session:ended',
        sessionId,
        exitCode,
        claudeSessionId: session?.claudeSessionId ?? null,
      });

      // Finalize recorder
      const recorder = this.recorders.get(sessionId);
      if (recorder) {
        recorder.finalize();
        recorder.dispose();
        this.recorders.delete(sessionId);
      }
    });

    // Heartbeat handler
    this.wsClient.on('heartbeatTick', () => {
      const health = getSystemHealth();
      this.wsClient.sendHeartbeat(health.cpuPercent, health.memPercent, this.pool.activeCount);
    });

    this.wsClient.on('stateChange', (state: string) => {
      log.info({ state }, 'WebSocket connection state changed');
    });

    // Connect to Hub
    this.wsClient.connect();
    this.running = true;

    // Graceful shutdown
    const shutdown = async (): Promise<void> => {
      if (!this.running) return;
      this.running = false;
      log.info('Shutting down...');

      await this.pool.killAll();
      this.wsClient.destroy();
      this.pool.dispose();

      for (const recorder of this.recorders.values()) {
        recorder.dispose();
      }
      this.recorders.clear();

      log.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  private handleHubMessage(msg: HubToAgentMessage): void {
    switch (msg.type) {
      case 'hub:session:start':
        this.handleSessionStart(msg);
        break;
      case 'hub:session:kill':
        this.handleSessionKill(msg.sessionId);
        break;
      case 'hub:session:input':
        this.handleSessionInput(msg.sessionId, msg.input);
        break;
      case 'hub:session:resume':
        log.info({ sessionId: msg.sessionId }, 'Resume not yet implemented');
        break;
      case 'hub:queue:add':
      case 'hub:queue:remove':
      case 'hub:queue:reorder':
        log.info({ type: msg.type }, 'Queue commands not yet implemented');
        break;
    }
  }

  private handleSessionStart(msg: { sessionId: string; prompt: string; cwd: string; flags: string[] }): void {
    if (!this.pool.hasCapacity) {
      log.warn({ sessionId: msg.sessionId }, 'No capacity for new session');
      return;
    }

    // Store session metadata for the started event
    this.sessionMeta.set(msg.sessionId, { prompt: msg.prompt, cwd: msg.cwd });

    // Create recorder for this session
    const recorder = new Recorder({
      sessionId: msg.sessionId,
      wsClient: this.wsClient,
      uploadIntervalMs: this.config.recordingUploadIntervalMs,
    });
    recorder.start();
    this.recorders.set(msg.sessionId, recorder);

    // Spawn the session
    this.pool.spawn({
      sessionId: msg.sessionId,
      prompt: msg.prompt,
      cwd: msg.cwd || this.config.defaultCwd || process.cwd(),
      flags: msg.flags.length > 0 ? msg.flags : this.config.defaultFlags,
      machineId: this.config.machineId,
      claudeBinary: this.config.claudeBinary,
    });

    log.info({ sessionId: msg.sessionId, prompt: msg.prompt.slice(0, 100) }, 'Session started');
  }

  private handleSessionKill(sessionId: string): void {
    try {
      this.pool.kill(sessionId);
      log.info({ sessionId }, 'Session killed');
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to kill session');
    }
  }

  private handleSessionInput(sessionId: string, input: string): void {
    try {
      this.pool.write(sessionId, input);
    } catch (err) {
      log.error({ sessionId, err }, 'Failed to write to session');
    }
  }

  getStatus(): { running: boolean; sessions: ReturnType<PtyPool['list']>; connected: boolean } {
    return {
      running: this.running,
      sessions: this.pool.list(),
      connected: this.wsClient.state === 'connected',
    };
  }
}
