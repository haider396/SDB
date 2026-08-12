import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from '../src/lib/env.js';
import { TEST_ENV_VARS } from './helpers.js';

describe('loadEnv (AC-NFR-05)', () => {
  it('fails fast on an empty environment, listing every missing key', () => {
    let caught: unknown;
    try {
      loadEnv({}, {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    for (const key of [
      'DATABASE_URL',
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_JWT_JWKS_URL',
      'SUPABASE_STORAGE_BUCKET_CANDIDATES',
      'WEBHOOK_INBOUND_TOKEN',
      'GHL_API_BASE_URL',
      'GHL_PRIVATE_INTEGRATION_TOKEN',
      'GHL_LOCATION_ID',
      'PUBLIC_APP_URL',
      'CORS_ALLOWED_ORIGINS',
    ]) {
      expect(err.missing).toContain(key);
      expect(err.message).toContain(key);
    }
  });

  it('treats empty strings as missing (an untouched .env.example fails)', () => {
    expect(() =>
      loadEnv({ ...TEST_ENV_VARS, DATABASE_URL: '' }, {}),
    ).toThrowError(/DATABASE_URL/);
  });

  it('reports invalid values separately from missing ones', () => {
    let caught: unknown;
    try {
      loadEnv({ ...TEST_ENV_VARS, SUPABASE_URL: 'not-a-url' }, {});
    } catch (error) {
      caught = error;
    }
    const err = caught as EnvValidationError;
    expect(err).toBeInstanceOf(EnvValidationError);
    expect(err.invalid).toContain('SUPABASE_URL');
    expect(err.missing).not.toContain('SUPABASE_URL');
  });

  it('parses a complete environment and applies defaults', () => {
    const env = loadEnv(
      { ...TEST_ENV_VARS, NODE_ENV: undefined, LOG_LEVEL: undefined },
      {},
    );
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('splits CORS_ALLOWED_ORIGINS into a trimmed array', () => {
    const env = loadEnv(
      {
        ...TEST_ENV_VARS,
        CORS_ALLOWED_ORIGINS:
          'https://a.example.com, https://b.example.com ,https://c.example.com',
      },
      {},
    );
    expect(env.CORS_ALLOWED_ORIGINS).toEqual([
      'https://a.example.com',
      'https://b.example.com',
      'https://c.example.com',
    ]);
  });

  it('accepts absent optional vars and keeps required ones required', () => {
    const env = loadEnv(TEST_ENV_VARS, {});
    expect(env.TRANSACTIONAL_EMAIL_PROVIDER_KEY).toBeUndefined();
    expect(env.GHL_WEBHOOK_URL_INTAKE_SUBMITTED).toBeUndefined();
  });

  it('does not read process.env when a base is supplied', () => {
    process.env.__SDB_TEST_SENTINEL__ = 'x';
    const env = loadEnv(TEST_ENV_VARS, {});
    expect(
      (env as unknown as Record<string, unknown>).__SDB_TEST_SENTINEL__,
    ).toBeUndefined();
    delete process.env.__SDB_TEST_SENTINEL__;
  });
});
