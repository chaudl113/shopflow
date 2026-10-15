import { defineConfig } from 'vitest/config';

const testDb = process.env.TEST_DATABASE_URL ?? 'postgres://shopflow:shopflow@localhost:5442/shopflow_test';

export default defineConfig({
  test: {
    // Integration tests hit a real Postgres; files share one database, so run them one at a time.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: testDb, JWT_SECRET: 'test-secret', BCRYPT_ROUNDS: '4', NODE_ENV: 'test' },
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
