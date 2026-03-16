import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { HubConfig } from '@chq/shared';
import { initDatabase } from './db.js';
import { createDAL } from './dal.js';
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

  // Make recordingsPath accessible to routes
  (app as unknown as Record<string, unknown>).recordingsPath = config.recordingsPath;

  // Agent handler
  const agentHandler = new AgentHandler(app, dal, config.recordingsPath);

  // Dashboard subscribers
  const dashboardSockets = new Set<import('ws').WebSocket>();
  agentHandler.setDashboardBroadcast((msg) => {
    const data = JSON.stringify(msg);
    for (const socket of dashboardSockets) {
      if (socket.readyState === 1) {
        socket.send(data);
      }
    }
  });

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

  // Agent WebSocket
  app.get('/ws/agent', { websocket: true }, (socket) => {
    agentHandler.handleConnection(socket);
  });

  // Dashboard WebSocket
  app.get('/ws/dashboard', { websocket: true }, (socket) => {
    dashboardSockets.add(socket);
    app.log.info('Dashboard connected');

    socket.on('close', () => {
      dashboardSockets.delete(socket);
      app.log.info('Dashboard disconnected');
    });
  });

  // REST routes
  await machineRoutes(app, dal);
  await sessionRoutes(app, dal, agentHandler);
  await hookRoutes(app, dal);
  await queueRoutes(app, dal);
  await approvalRoutes(app, db);
  await notificationRoutes(app, db);
  await templateRoutes(app, db);
  await healthHistoryRoutes(app, db);
  await repoRoutes(app, db);
  await jobRoutes(app, db, agentHandler);
  const githubClient = new GitHubClient(db, app.log);
  await githubClient.initialize();
  await githubRoutes(app, db, githubClient);

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

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    app.log.info('Shutting down...');
    agentHandler.dispose();
    db.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}
