/**
 * Candidate registration service (T38) — unit level, no database.
 *
 * The averaging rule is the one Rebecca was explicit about on the 13 Aug call
 * (20:26–20:41): the stored figure is the AVERAGE across attempts, never the
 * best. It is computed server-side precisely so a client cannot submit a
 * pre-averaged number it rounded differently or inflated, which makes it worth
 * pinning down here.
 */
import { describe, expect, it } from 'vitest';
import { averageWpm } from '../src/services/candidate-registration.service.js';

describe('averageWpm', () => {
  it('returns null when no attempts were made', () => {
    expect(averageWpm([])).toBeNull();
  });

  it('returns the single attempt unchanged', () => {
    expect(averageWpm([{ wpm: 62 }])).toBe(62);
  });

  it('averages across attempts rather than taking the best', () => {
    const attempts = [{ wpm: 40 }, { wpm: 80 }];
    expect(averageWpm(attempts)).toBe(60);
    // The explicit anti-assertion: never the maximum.
    expect(averageWpm(attempts)).not.toBe(80);
  });

  it('is not skewed by attempt order', () => {
    expect(averageWpm([{ wpm: 30 }, { wpm: 90 }])).toBe(
      averageWpm([{ wpm: 90 }, { wpm: 30 }]),
    );
  });

  it('rounds to a whole number', () => {
    // 50 + 51 + 53 = 154 / 3 = 51.33…
    expect(averageWpm([{ wpm: 50 }, { wpm: 51 }, { wpm: 53 }])).toBe(51);
  });

  it('keeps a poor retake in the average — retaking can lower the score', () => {
    // A candidate who scores 90 then 30 averages 60, not 90. This is the
    // behaviour Rebecca chose: "you could be sunk very fast, and then the next
    // moment you are just tired."
    expect(averageWpm([{ wpm: 90 }, { wpm: 30 }])).toBe(60);
  });

  it('handles a zero-speed attempt without dividing by zero', () => {
    expect(averageWpm([{ wpm: 0 }, { wpm: 40 }])).toBe(20);
  });
});
