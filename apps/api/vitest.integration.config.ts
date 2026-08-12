import { defineConfig } from 'vitest/config';

/**
 * Integration suite: real Postgres, no mocks (docs/06-BACKEND.md §1).
 *
 * Database resolution (tests/integration/global-setup.ts):
 *   1. TEST_DATABASE_URL, when set — e.g. the scratch cluster started by
 *      `bash scripts/test-db.sh` on machines without Docker.
 *   2. Otherwise a @testcontainers/postgresql postgres:15 container (CI).
 *
 * The global setup builds one template database with migrations 0001–0011
 * applied; each test file clones it (`create database ... template ...`),
 * so files are fully isolated and safe to run in parallel.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    teardownTimeout: 60_000,
  },
});
