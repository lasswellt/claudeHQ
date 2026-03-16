import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { HubConfig } from '@chq/shared';
import { initDatabase } from './db.js';

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

  // Initialize database
  const db = initDatabase(config.databasePath);
  app.decorate('db', db);

  // WebSocket support
  await app.register(fastifyWebsocket);

  // Serve dashboard static files if path configured
  if (config.dashboardStaticPath && existsSync(config.dashboardStaticPath)) {
    await app.register(fastifyStatic, {
      root: path.resolve(config.dashboardStaticPath),
      wildcard: false,
    });
  }

  // Health endpoint
  app.get('/health', async () => {
    return {
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
    };
  });

  // Agent WebSocket endpoint
  app.get('/ws/agent', { websocket: true }, (socket, req) => {
    app.log.info('Agent connected: %s', req.ip);
    socket.on('message', (raw) => {
      app.log.debug('Agent message: %s', raw.toString().slice(0, 200));
      // TODO: implement in EPIC-008
    });
    socket.on('close', () => {
      app.log.info('Agent disconnected: %s', req.ip);
    });
  });

  // Dashboard WebSocket endpoint
  app.get('/ws/dashboard', { websocket: true }, (socket, req) => {
    app.log.info('Dashboard connected: %s', req.ip);
    socket.on('message', (raw) => {
      app.log.debug('Dashboard message: %s', raw.toString().slice(0, 200));
      // TODO: implement in EPIC-015
    });
    socket.on('close', () => {
      app.log.info('Dashboard disconnected: %s', req.ip);
    });
  });

  // SPA fallback — serve index.html for non-API GET requests
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
    db.close();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return app;
}
