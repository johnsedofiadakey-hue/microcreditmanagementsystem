import { defineConfig } from 'tsup';

// @susu/shared resolves through tsconfig `paths` and is bundled into lib/, so the deployed
// package.json lists only real npm dependencies.
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  noExternal: ['@susu/shared'],
});
