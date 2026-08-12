/**
 * Opaque keyset-pagination cursors (docs/04-API.md §1: `?limit&cursor=<opaque>`).
 * Encodes the (created_at, id) keyset position as base64url JSON. Opaque to
 * clients; a tampered or malformed cursor is a 400 MALFORMED_REQUEST.
 */
import { z } from 'zod';
import { ApiError } from './errors.js';

export interface KeysetCursor {
  createdAt: string;
  id: string;
}

const CursorPayloadSchema = z.object({
  c: z.string().min(1),
  i: z.string().uuid(),
});

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(
    JSON.stringify({ c: cursor.createdAt, i: cursor.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeCursor(raw: string): KeysetCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new ApiError('MALFORMED_REQUEST', 'Invalid pagination cursor.');
  }
  const result = CursorPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError('MALFORMED_REQUEST', 'Invalid pagination cursor.');
  }
  return { createdAt: result.data.c, id: result.data.i };
}
