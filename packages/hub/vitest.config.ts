import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'hub',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
