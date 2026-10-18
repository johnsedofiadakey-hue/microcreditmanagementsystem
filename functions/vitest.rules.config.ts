import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/rules/**/*.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
