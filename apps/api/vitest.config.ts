import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only. Integration tests (real Postgres) live in
// tests/integration and run via vitest.integration.config.ts
// (`pnpm test:integration`); `pnpm test:all` runs both.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/integration/**'],
  },
});
