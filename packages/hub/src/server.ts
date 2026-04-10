import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { HubConfig } from '@chq/shared';
import { initDatabase } from './db.js';
import { createDAL } from './dal.js';
import { createAuditLogger } from './audit-log.js';
import { AgentHandler } from './ws/agent-handler.js';
import { machineRoutes } from './routes/machines.js';
import { sessionRoutes } from './routes/sessions.js';
import { hookRoutes } from './routes/hooks.js';
import { queueRoutes } from './routes/queues.js';
import { approvalRoutes } from './routes/approvals.js';
import { notificationRoutes } from './routes/notifications.js';
import { templateRoutes } from './routes/templates.js';
import { healthHistoryRoutes } from './routes/health.js';
import { repoRoutes } from './routes/repos.js';
import { jobRoutes } from './routes/jobs.js';
import { githubRoutes } from './routes/github.js';
import { GitHubClient } from './github/client.js';
import { costRoutes } from './routes/costs.js';
import { scheduledTaskRoutes } from './routes/scheduled-tasks.js';
import { DashboardHandler } from './ws/dashboard-handler.js';
import { ContainerOrchestrator } from './container-orchestrator.js';
import { agentRoutes } from './routes/agents.js';
import { auditLogRoutes } from './routes/audit-log.js';
import { sessionDiscoveryRoutes } from './routes/session-discovery.js';
import { createEnforcementSweeper } from './scheduler/enforcement.js';
import { createFilesystemSdkClient } from './services/agent-sdk-client.js';
import { createTelemetryFromEnv } from './costs/telemetry.js';
import { startRetentionCron } from './retention.js';

export async function createServer(config: HubConfig): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
    },
  });

  // Ensure data directories exist
  const dbDir = path.dirname(config.databasePath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
  if (!existsSync(config.recordingsPath)) mkdirSync(config.recordingsPath, { recursive: true });

  // Initialize database and DAL
  const db = initDatabase(config.databasePath);
  const dal = createDAL(db);
  const auditLogger = createAuditLogger(db);

  // CAP-074 / stories 015-007 + 015-008: cost telemetry exporter.
  // Resolves to a no-op unless CLAUDE_CODE_ENABLE_TELEMETRY=1 and
  // either OTEL_EXPORTER_OTLP_ENDPOINT or LANGFUSE_* env is set.
  // The consumer that records costs into session_costs will call
  // telemetry.emit() alongside the DB write — that wiring lands
  // with the stream-json parser integration (follow-up).
  const telemetry = createTelemetryFromEnv(process.env, {
    logger: app.log,
  });

  // Make recordingsPath accessible to routes
  (app as unknown as Record<string, unknown>).recordingsPath = config.recordingsPath;

  // Agent handler
  const agentHandler = new AgentHandler(app, dal, db, config.recordingsPath);

  // Dashboard handler (with subscribe/unsubscribe support)
  const dashboardHandler = new DashboardHandler(app, dal);
  const broadcastToDashboard = (msg: unknown): void => {
    dashboardHandler.broadcast(msg);
  };
  agentHandler.setDashboardBroadcast(broadcastToDashboard);

  // Container orchestrator for dynamic agent spawning
  const orchestrator = new ContainerOrchestrator(db, config, app.log as unknown as import('pino').Logger);
  orchestrator.setDashboardBroadcast(broadcastToDashboard);
  agentHandler.setOrchestrator(orchestrator);

  // Rate limiting — 100 requests per minute globally
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });

  // WebSocket support
  await app.register(fastifyWebsocket);

  // Serve dashboard static files
  if (config.dashboardStaticPath && existsSync(config.dashboardStaticPath)) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.dashboardStaticPath),
      wildcard: false,
    });
  }

  // Health endpoint
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
    machines: dal.listMachines().length,
    connectedAgents: agentHandler.getConnectedAgentIds().length,
  }));

  // Agent WebSocket — token auth when CHQ_AGENT_TOKEN is configured
  app.get('/ws/agent', { websocket: true }, (socket, req) => {
    const expectedToken = process.env.CHQ_AGENT_TOKEN;
    if (expectedToken) {
      const provided =
        (req.query as Record<string, string | undefined>).token ??
        req.headers['x-agent-token'];
      if (provided !== expectedToken) {
        app.log.warn('Agent WebSocket rejected: invalid token');
        socket.close(4401, 'Unauthorized');
        return;
      }
    }
    agentHandler.handleConnection(socket);
  });

  // Dashboard WebSocket (with subscribe/unsubscribe message handling)
  app.get('/ws/dashboard', { websocket: true }, (socket) => {
    dashboardHandler.handleConnection(socket);
  });

  // Capture raw request body for webhook signature verification.
  // This must be added before routes so the hook runs on /hooks/github.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as unknown as Record<string, unknown>).rawBody = body;
    try {
      done(null, JSON.parse(body.toString('utf-8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // REST routes
  await machineRoutes(app, dal);
  await sessionRoutes(app, dal, agentHandler, auditLogger, db);
  await hookRoutes(app, dal);
  await queueRoutes(app, dal, auditLogger);
  await approvalRoutes(app, db, auditLogger, broadcastToDashboard);
  await notificationRoutes(app, db);
  await templateRoutes(app, db);
  await healthHistoryRoutes(app, db);
  await repoRoutes(app, db);
  const githubClient = new GitHubClient(db, app.log);
  await githubClient.initialize();
  await jobRoutes(app, db, agentHandler, githubClient);
  await githubRoutes(app, db, githubClient, broadcastToDashboard);
  await costRoutes(app, db);
  await scheduledTaskRoutes(app, db);
  await agentRoutes(app, orchestrator);
  await auditLogRoutes(app, auditLogger);
  // CAP-016: SDK session discovery — filesystem fallback until the
  // official SDK client ships.
  const sdkClient = createFilesystemSdkClient();
  await sessionDiscoveryRoutes(app, dal, sdkClient);

  // CAP-011 / story 014-004: start the timeout + cost enforcement
  // sweeper. Kills expired or over-budget sessions via the existing
  // `hub:session:kill` agent channel.
  const enforcementSweeper = createEnforcementSweeper({
    db,
    logger: app.log,
    killSession: (violation) => {
      agentHandler.sendToAgent(violation.machineId, {
        type: 'hub:session:kill',
        sessionId: violation.sessionId,
      });
      auditLogger.append({
        action: `session.enforce_${violation.reason}`,
        entityType: 'session',
        entityId: violation.sessionId,
        actor: 'system',
        details: violation.detail,
      });
    },
  });
  enforcementSweeper.start();

  // CAP-047 / story 019-004: recordings retention sweeper.
  // Runs every 6h, deletes JSONL files older than `recordingsMaxAgeDays`
  // and trims oldest-first until under `recordingsMaxSizeGb`.
  let recordingsRetentionTimer: ReturnType<typeof setInterval> | null = null;
  if (config.recordingsMaxAgeDays > 0) {
    recordingsRetentionTimer = startRetentionCron(
      config.recordingsPath,
      {
        maxAgeDays: config.recordingsMaxAgeDays,
        maxSizeGb: config.recordingsMaxSizeGb,
      },
      app.log,
    );
    recordingsRetentionTimer.unref?.();
  }

  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === 'GET' &&
      !req.url.startsWith('/api/') &&
      !req.url.startsWith('/ws/') &&
      !req.url.startsWith('/hooks/')
    ) {
      if (config.dashboardStaticPath && existsSync(config.dashboardStaticPath)) {
        return reply.sendFile('index.html');
      }
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  await orchestrator.initialize();

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    app.log.info('Shutting down...');
    enforcementSweeper.stop();
    if (recordingsRetentionTimer) clearInterval(recordingsRetentionTimer);
    await telemetry.flush();
    agentHandler.dispose();
    dashboardHandler.dispose();
    await orchestrator.dispose();
    db.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}
