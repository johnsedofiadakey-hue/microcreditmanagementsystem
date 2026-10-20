import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@susu/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['test/rules/**/*.test.ts', 'test/emulator/**/*.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
