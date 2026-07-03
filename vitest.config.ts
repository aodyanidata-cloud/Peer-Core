import { defineConfig } from 'vitest/config';

export default defineConfig({
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
