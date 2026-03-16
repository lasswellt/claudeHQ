import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import { agentToHubSchema, type HubToAgentMessage } from '@chq/shared';
import type { DAL } from '../dal.js';
import { appendRecordingChunks } from '../recordings.js';

interface ConnectedAgent {
  machineId: string;
  socket: WebSocket;
  connectedAt: number;
}

export class AgentHandler {
  private agents = new Map<string, ConnectedAgent>();
  private offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly dal: DAL;
  private readonly app: FastifyInstance;
  private readonly recordingsPath: string;
  private dashboardBroadcast: ((msg: unknown) => void) | null = null;

  constructor(app: FastifyInstance, dal: DAL, recordingsPath: string) {
    this.app = app;
    this.dal = dal;
    this.recordingsPath = recordingsPath;
  }

  setDashboardBroadcast(fn: (msg: unknown) => void): void {
    this.dashboardBroadcast = fn;
  }

  handleConnection(socket: WebSocket): void {
    let machineId: string | null = null;

    socket.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as unknown;
        const msg = agentToHubSchema.parse(data);

        switch (msg.type) {
          case 'agent:register':
            machineId = msg.machineId;
            this.handleRegister(socket, msg);
            break;
          case 'agent:heartbeat':
            this.handleHeartbeat(msg);
            break;
          case 'agent:session:started':
            this.handleSessionStarted(msg);
            break;
          case 'agent:session:output':
            this.handleSessionOutput(msg);
            break;
          case 'agent:session:ended':
            this.handleSessionEnded(msg);
            break;
          case 'agent:recording:upload':
            this.handleRecordingUpload(msg);
            break;
          case 'agent:queue:updated':
            this.app.log.debug({ machineId: msg.machineId }, 'Queue update received');
            break;
        }
      } catch (err) {
        this.app.log.warn({ err }, 'Failed to parse agent message');
      }
    });

    socket.on('close', () => {
      if (machineId) {
        this.agents.delete(machineId);
        // Mark offline after 60s timeout
        const timer = setTimeout(() => {
          this.dal.updateMachineStatus(machineId!, 'offline', Math.floor(Date.now() / 1000));
          this.offlineTimers.delete(machineId!);
          this.broadcastToDashboard({
            type: 'machine:updated',
            machine: this.dal.getMachine(machineId!),
          });
          this.app.log.info({ machineId }, 'Agent marked offline');
        }, 60000);
        this.offlineTimers.set(machineId, timer);
        this.app.log.info({ machineId }, 'Agent disconnected, offline timer started');
      }
    });
  }

  sendToAgent(machineId: string, msg: HubToAgentMessage): boolean {
    const agent = this.agents.get(machineId);
    if (!agent) return false;
    agent.socket.send(JSON.stringify(msg));
    return true;
  }

  getConnectedAgentIds(): string[] {
    return [...this.agents.keys()];
  }

  private handleRegister(
    socket: WebSocket,
    msg: { machineId: string; version: string; maxSessions: number; os: string },
  ): void {
    // Clear any pending offline timer
    const timer = this.offlineTimers.get(msg.machineId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(msg.machineId);
    }

    this.agents.set(msg.machineId, {
      machineId: msg.machineId,
      socket,
      connectedAt: Date.now(),
    });

    this.dal.upsertMachine({
      id: msg.machineId,
      lastSeen: Math.floor(Date.now() / 1000),
      status: 'online',
      maxSessions: msg.maxSessions,
      meta: JSON.stringify({ version: msg.version, os: msg.os, arch: process.arch }),
    });

    this.broadcastToDashboard({
      type: 'machine:updated',
      machine: this.dal.getMachine(msg.machineId),
    });

    this.app.log.info({ machineId: msg.machineId, version: msg.version }, 'Agent registered');
  }

  private handleHeartbeat(msg: {
    machineId: string;
    activeSessions: number;
    cpuPercent: number;
    memPercent: number;
  }): void {
    this.dal.updateMachineHeartbeat(
      msg.machineId,
      Math.floor(Date.now() / 1000),
      JSON.stringify({ cpuPercent: msg.cpuPercent, memPercent: msg.memPercent, activeSessions: msg.activeSessions }),
    );
  }

  private handleSessionStarted(msg: {
    sessionId: string;
    machineId: string;
    prompt: string;
    cwd: string;
    pid: number;
  }): void {
    this.dal.updateSession(msg.sessionId, {
      status: 'running',
      pid: msg.pid,
      startedAt: Math.floor(Date.now() / 1000),
      recordingPath: `${msg.sessionId}.jsonl`,
    });

    const session = this.dal.getSession(msg.sessionId);
    this.broadcastToDashboard({ type: 'session:updated', session });
    this.app.log.info({ sessionId: msg.sessionId, pid: msg.pid }, 'Session started');
  }

  private handleSessionOutput(msg: { sessionId: string; chunks: Array<{ ts: number; data: string }> }): void {
    this.dal.updateSession(msg.sessionId, {
      lastActivityAt: Math.floor(Date.now() / 1000),
    });

    // Forward to dashboard subscribers
    this.broadcastToDashboard({
      type: 'session:output',
      sessionId: msg.sessionId,
      chunks: msg.chunks,
    });
  }

  private handleSessionEnded(msg: {
    sessionId: string;
    exitCode: number;
    claudeSessionId: string | null;
  }): void {
    this.dal.updateSession(msg.sessionId, {
      status: msg.exitCode === 0 ? 'completed' : 'failed',
      exitCode: msg.exitCode,
      claudeSessionId: msg.claudeSessionId ?? undefined,
      endedAt: Math.floor(Date.now() / 1000),
    });

    const session = this.dal.getSession(msg.sessionId);
    this.broadcastToDashboard({ type: 'session:updated', session });
    this.app.log.info({ sessionId: msg.sessionId, exitCode: msg.exitCode }, 'Session ended');
  }

  private handleRecordingUpload(msg: {
    sessionId: string;
    chunks: Array<{ ts: number; data: string }>;
    final: boolean;
  }): void {
    appendRecordingChunks(this.recordingsPath, msg.sessionId, msg.chunks);

    if (msg.final) {
      this.app.log.info({ sessionId: msg.sessionId }, 'Recording finalized');
    }
  }

  private broadcastToDashboard(msg: unknown): void {
    this.dashboardBroadcast?.(msg);
  }

  dispose(): void {
    for (const timer of this.offlineTimers.values()) {
      clearTimeout(timer);
    }
    this.offlineTimers.clear();
  }
}
