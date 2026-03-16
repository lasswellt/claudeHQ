import pino from 'pino';
import { hubConfigSchema, loadConfig } from '@chq/shared';
import { createServer } from './server.js';

const startupLogger = pino({ level: 'info' });

async function main(): Promise<void> {
  const config = loadConfig(hubConfigSchema, undefined, 'CHQ_HUB_');

  const app = await createServer(config);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Hub listening on ${config.host}:${config.port}`);
}

main().catch((err: unknown) => {
  startupLogger.fatal({ err }, 'Failed to start Hub');
  process.exit(1);
});
