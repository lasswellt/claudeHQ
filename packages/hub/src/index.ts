import { hubConfigSchema, loadConfig } from '@chq/shared';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const config = loadConfig(hubConfigSchema, undefined, 'CHQ_HUB_');

  const app = await createServer(config);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Hub listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  console.error('Failed to start Hub:', err);
  process.exit(1);
});
