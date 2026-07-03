import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // SWC emits decorator metadata (design:paramtypes) that esbuild does not, so
  // NestJS constructor dependency injection resolves correctly in tests. Matches
  // the production `nest build` (tsc, emitDecoratorMetadata) behaviour.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 20000,
    // DB-backed suites share one Postgres database and TRUNCATE the same tables,
    // so files must not run in parallel or they cross-fire. Run them sequentially.
    fileParallelism: false,
  },
});
