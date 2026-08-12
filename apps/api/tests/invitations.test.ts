import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/errors.js';
import {
  issueInvitationToken,
  verifyInvitationToken,
} from '../src/services/invitations.js';

const KEY = 'service-role-key-for-tests-only';

describe('invitation tokens', () => {
  it('round-trips issue → verify', () => {
    const userId = randomUUID();
    const clientId = randomUUID();
    const token = issueInvitationToken(KEY, { userId, clientId });
    const payload = verifyInvitationToken(KEY, token);
    expect(payload.userId).toBe(userId);
    expect(payload.clientId).toBe(clientId);
    expect(payload.exp * 1000).toBeGreaterThan(Date.now());
  });

  it('rejects a tampered payload', () => {
    const token = issueInvitationToken(KEY, {
      userId: randomUUID(),
      clientId: randomUUID(),
    });
    const [body, sig] = token.split('.') as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        userId: randomUUID(),
        clientId: randomUUID(),
        exp: Math.floor(Date.now() / 1000) + 9999,
      }),
    ).toString('base64url');
    expect(() => verifyInvitationToken(KEY, `${forged}.${sig}`)).toThrowError(
      ApiError,
    );
    expect(() => verifyInvitationToken(KEY, `${body}.AAAA${sig}`)).toThrowError(
      ApiError,
    );
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueInvitationToken('another-secret', {
      userId: randomUUID(),
      clientId: randomUUID(),
    });
    expect(() => verifyInvitationToken(KEY, token)).toThrowError(
      /invalid/i,
    );
  });

  it('rejects an expired token with a distinct message', () => {
    const token = issueInvitationToken(
      KEY,
      { userId: randomUUID(), clientId: randomUUID(), ttlSeconds: 60 },
      () => Date.now() - 120_000,
    );
    expect(() => verifyInvitationToken(KEY, token)).toThrowError(/expired/i);
  });

  it('rejects garbage tokens with VALIDATION_FAILED', () => {
    for (const garbage of ['', 'abc', 'a.b.c', 'not-base64.!!!!']) {
      try {
        verifyInvitationToken(KEY, garbage);
        expect.unreachable(`accepted garbage token: ${garbage}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).code).toBe('VALIDATION_FAILED');
      }
    }
  });
});
