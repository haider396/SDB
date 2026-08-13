import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CollectionResponseSchema,
  CursorPaginationQuerySchema,
  SingleResponseSchema,
} from './envelopes.js';
import { ApiErrorSchema, ERROR_CODES, makeApiError } from './errors.js';

const ItemSchema = z.object({ id: z.string(), name: z.string() });

describe('SingleResponseSchema', () => {
  it('round-trips a single-resource envelope', () => {
    const schema = SingleResponseSchema(ItemSchema);
    const payload = { data: { id: 'a', name: 'Alpha' } };
    expect(schema.parse(payload)).toEqual(payload);
  });

  it('rejects a payload missing the data wrapper', () => {
    const schema = SingleResponseSchema(ItemSchema);
    expect(schema.safeParse({ id: 'a', name: 'Alpha' }).success).toBe(false);
  });
});

describe('CollectionResponseSchema', () => {
  it('round-trips a collection envelope with a next cursor', () => {
    const schema = CollectionResponseSchema(ItemSchema);
    const payload = {
      data: [{ id: 'a', name: 'Alpha' }],
      meta: { count: 1, nextCursor: 'eyJpZCI6' },
    };
    expect(schema.parse(payload)).toEqual(payload);
  });

  it('round-trips a last page with a null cursor', () => {
    const schema = CollectionResponseSchema(ItemSchema);
    const payload = { data: [], meta: { count: 0, nextCursor: null } };
    expect(schema.parse(payload)).toEqual(payload);
  });

  it('accepts an optional meta.total and rejects a negative one (UX 2.9)', () => {
    const schema = CollectionResponseSchema(ItemSchema);
    const payload = {
      data: [{ id: 'a', name: 'Alpha' }],
      meta: { count: 1, nextCursor: null, total: 41 },
    };
    expect(schema.parse(payload)).toEqual(payload);
    expect(
      schema.safeParse({
        data: [],
        meta: { count: 0, nextCursor: null, total: -1 },
      }).success,
    ).toBe(false);
  });

  it('rejects a collection without meta', () => {
    const schema = CollectionResponseSchema(ItemSchema);
    expect(schema.safeParse({ data: [] }).success).toBe(false);
  });
});

describe('CursorPaginationQuerySchema', () => {
  it('defaults limit to 25', () => {
    expect(CursorPaginationQuerySchema.parse({})).toEqual({ limit: 25 });
  });

  it('coerces string query values', () => {
    expect(CursorPaginationQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual(
      { limit: 50, cursor: 'abc' },
    );
  });

  it('rejects limit above 100 and below 1', () => {
    expect(CursorPaginationQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(CursorPaginationQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('round-trips the documented error envelope', () => {
    const payload = {
      error: {
        code: 'REQUIRED_ANSWER_MISSING',
        message: 'Some required answers are missing.',
        details: { missingKeys: ['company_name', 'budget_range'] },
        requestId: '01J9X8',
      },
    };
    expect(ApiErrorSchema.parse(payload)).toEqual(payload);
  });

  it('rejects unknown error codes', () => {
    expect(
      ApiErrorSchema.safeParse({
        error: { code: 'NOPE', message: 'x', requestId: 'r' },
      }).success,
    ).toBe(false);
  });

  it('makeApiError produces a schema-valid envelope', () => {
    const err = makeApiError('PAYMENT_NOT_CONFIRMED', 'Payment first.', 'req-1');
    expect(ApiErrorSchema.parse(err)).toEqual(err);
    expect(err.error.details).toBeUndefined();
  });

  it('maps every documented code to its HTTP status', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(23);
    expect(ERROR_CODES.WRONG_TENANT).toBe(403);
    expect(ERROR_CODES.INVALID_VALIDATION_RULE).toBe(422);
    expect(ERROR_CODES.FILE_TOO_LARGE).toBe(413);
    expect(ERROR_CODES.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(ERROR_CODES.RATE_LIMITED).toBe(429);
  });
});
