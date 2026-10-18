import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // @susu/shared is source-aliased (not a package dependency) so Cloud Build never sees a workspace: spec.
    alias: { '@susu/shared': fileURLToPath(new URL('../packages/shared/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/rules/**'],
    testTimeout: 30_000,
  },
});
