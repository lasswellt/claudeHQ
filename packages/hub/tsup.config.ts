import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: ['@chq/shared', 'zod'],
  external: [
    'fastify',
    '@fastify/websocket',
    '@fastify/static',
    'better-sqlite3',
    'pino',
    'ws',
  ],
});
