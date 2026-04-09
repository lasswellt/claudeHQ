import type { WebSocket } from 'ws';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { agentToHubSchema, type HubToAgentMessage } from '@chq/shared';
import type { DAL } from '../dal.js';
import { appendRecordingChunks } from '../recordings.js';
import type { ContainerOrchestrator } from '../container-orchestrator.js';

interface ConnectedAgent {
  machineId: string;
  socket: WebSocket;
  connectedAt: number;
}

export class AgentHandler {
  private agents = new Map<string, ConnectedAgent>();
  private offlineTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly dal: DAL;
  private readonly db: Database.Database;
  private readonly app: FastifyInstance;
  private readonly recordingsPath: string;
  private dashboardBroadcast: ((msg: unknown) => void) | null = null;
  private orchestrator: ContainerOrchestrator | null = null;

  constructor(app: FastifyInstance, dal: DAL, db: Database.Database, recordingsPath: string) {
    this.app = app;
    this.dal = dal;
    this.db = db;
    this.recordingsPath = recordingsPath;
  }

  setOrchestrator(orchestrator: ContainerOrchestrator): void {
    this.orchestrator = orchestrator;
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
            this.broadcastToDashboard({
              type: 'queue:updated',
              machineId: msg.machineId,
              queue: msg.queue,
            });
            break;
          // CAP-056 / story 016-008: workspace lifecycle messages.
          // Persist the state transition + mark idle_since so the TTL
          // sweeper (016-001) can eventually clean up, and fan out to
          // the dashboard so the workspace view updates live.
          case 'agent:workspace:ready':
            this.handleWorkspaceReady(msg);
            break;
          case 'agent:workspace:error':
            this.handleWorkspaceError(msg);
            break;
          default:
            // Approval / container messages are members of the discriminated
            // union (HI-01 fix) but their handlers land in E002 (approvals)
            // and E007 (container sandbox). Log and drop so unhandled-but-
            // valid messages are observable.
            this.app.log.debug({ type: (msg as { type: string }).type }, 'Unhandled agent message');
            break;
        }
      } catch (err) {
        this.app.log.warn({ err }, 'Failed to parse agent message');
      }
    });

    socket.on('close', () => {
      if (machineId) {
        this.agents.delete(machineId);

        // If this was a spawned container agent, mark it stopped immediately.
        this.orchestrator?.markStopped(machineId);

        // Mark offline after 60s timeout
        const timer = setTimeout(() => {
          this.dal.updateMachineStatus(machineId!, 'offline', Math.floor(Date.now() / 1000));
          this.offlineTimers.delete(machineId!);
          const offlineMachine = this.dal.getMachine(machineId!);
          if (offlineMachine) {
            this.broadcastToDashboard({ type: 'machine:updated', machine: offlineMachine });
          }
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

    const registeredMachine = this.dal.getMachine(msg.machineId);
    if (registeredMachine) {
      this.broadcastToDashboard({ type: 'machine:updated', machine: registeredMachine });
    }

    // If this machine ID corresponds to a spawned container agent, promote it to running.
    this.orchestrator?.markRunning(msg.machineId);

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
    // CAP-075 (story 012-005): persist heartbeat into the
    // machine_health_history time series so the dashboard sparklines
    // and the workforce scheduler have real data to read.
    this.app.recordHealthData(
      msg.machineId,
      msg.cpuPercent,
      msg.memPercent,
      null,
      msg.activeSessions,
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

  // CAP-056 / story 016-008: workspace lifecycle handlers.
  private handleWorkspaceReady(msg: {
    workspaceId: string;
    path: string;
    branch: string;
    diskUsageBytes: number;
  }): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE workspaces
         SET status = 'ready', path = ?, branch = ?, disk_usage_bytes = ?,
             last_used_at = ?, idle_since = ?
         WHERE id = ?`,
      )
      .run(msg.path, msg.branch, msg.diskUsageBytes, now, now, msg.workspaceId);
    // Dashboard subscribers filter by type via onAnyMessage.
    this.broadcastToDashboard({
      type: 'workspace:updated',
      workspaceId: msg.workspaceId,
      status: 'ready',
      path: msg.path,
      branch: msg.branch,
      diskUsageBytes: msg.diskUsageBytes,
    });
    this.app.log.info({ workspaceId: msg.workspaceId, path: msg.path }, 'Workspace ready');
  }

  private handleWorkspaceError(msg: {
    workspaceId: string;
    error: string;
    phase: string;
  }): void {
    this.db
      .prepare("UPDATE workspaces SET status = 'cleanup' WHERE id = ?")
      .run(msg.workspaceId);
    this.broadcastToDashboard({
      type: 'workspace:updated',
      workspaceId: msg.workspaceId,
      status: 'error',
      error: msg.error,
      phase: msg.phase,
    });
    this.app.log.warn(
      { workspaceId: msg.workspaceId, error: msg.error, phase: msg.phase },
      'Workspace error',
    );
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
