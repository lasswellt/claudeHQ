import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  noExternal: ['@chq/shared', 'zod'],
  external: [
    'node-pty',
    'ws',
    'commander',
    'pino',
    'dockerode',
  ],
});
