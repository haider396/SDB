/**
 * Typing-test scoring (T10).
 *
 * These exist because the first implementation compared characters by
 * POSITION, which cascades: omitting one letter early misaligns everything
 * after it, scoring a near-perfect run at ~7%. The regression test for that
 * is the first case below.
 *
 * The rules being pinned down are the ones real tools (Monkeytype,
 * 10FastFingers) use, so a candidate who has taken one of those gets the same
 * number here.
 */
import { describe, expect, it } from "vitest";
import {
  keystrokeAccuracy,
  scoreRun,
  targetString,
} from "@/features/candidate-registration/components/typing-test";

const WORDS = ["the", "quality", "of", "a", "working", "day"];

describe("scoreRun — net WPM, word-by-word", () => {
  it("does not cascade when a character is omitted early (the positional-compare bug)", () => {
    // "th" instead of "the" — one word wrong, the rest typed perfectly.
    const perfect = scoreRun("the quality of a working day", WORDS, 60);
    const oneWordWrong = scoreRun("th quality of a working day", WORDS, 60);

    // Only "the" (3) + its space is forfeited. Under the old positional
    // compare virtually every character after the omission was scored wrong.
    expect(perfect.correctChars - oneWordWrong.correctChars).toBe(4);
  });

  it("uses the five-characters-per-word standard", () => {
    // 10 words of exactly 4 chars + space = 50 correct chars in 60s.
    const words = Array.from({ length: 10 }, () => "abcd");
    const typed = `${words.join(" ")} `;
    const result = scoreRun(typed, words, 60);
    expect(result.correctChars).toBe(50);
    expect(result.wpm).toBe(10);
  });

  it("doubles WPM when the same text is typed in half the time", () => {
    const words = Array.from({ length: 10 }, () => "abcd");
    const typed = `${words.join(" ")} `;
    expect(scoreRun(typed, words, 30).wpm).toBe(
      scoreRun(typed, words, 60).wpm * 2,
    );
  });

  it("gives a wholly wrong word no credit, but spares its neighbours", () => {
    const perfect = scoreRun("the quality of a working day", WORDS, 60);
    const result = scoreRun("the XXXXXXX of a working day", WORDS, 60);
    // "quality" (7) + its space = 8 characters forfeited, nothing more.
    expect(perfect.correctChars - result.correctChars).toBe(8);
  });

  it("credits the correct prefix of the word being typed", () => {
    const result = scoreRun("the quality of a work", WORDS, 60);
    const upToPreviousWord = scoreRun("the quality of a ", WORDS, 60);
    expect(result.correctChars - upToPreviousWord.correctChars).toBe(4);
  });

  it("gives no credit for characters typed beyond the target word", () => {
    const over = scoreRun("the qualityyyy ", WORDS, 60);
    const exact = scoreRun("the quality ", WORDS, 60);
    // The overtyped word matches nothing, so it forfeits its 8 characters.
    expect(exact.correctChars - over.correctChars).toBe(8);
  });

  it("never scores past the end of the supplied words", () => {
    // A trailing space used to match an out-of-range empty target and earn a
    // free character — 51 where 50 was correct.
    const words = ["ab"];
    expect(scoreRun("ab ", words, 60).correctChars).toBe(3);
  });

  it("returns zeroes for an empty run rather than dividing by zero", () => {
    expect(scoreRun("", WORDS, 0)).toEqual({
      wpm: 0,
      correctChars: 0,
      typedChars: 0,
    });
  });
});

describe("keystrokeAccuracy — counts keypresses, not the finished text", () => {
  it("is 100% when every keystroke was correct", () => {
    expect(keystrokeAccuracy(50, 50)).toBe(100);
  });

  it("counts a mistake that was later corrected", () => {
    // 20 keystrokes, 2 of them wrong — backspacing does not erase the error.
    // A finished-text measure would report 100% here, which is the whole
    // reason accuracy is tracked per keystroke.
    expect(keystrokeAccuracy(18, 20)).toBe(90);
  });

  it("returns 0 rather than NaN before anything is typed", () => {
    expect(keystrokeAccuracy(0, 0)).toBe(0);
  });

  it("rounds to a whole percent", () => {
    expect(keystrokeAccuracy(2, 3)).toBe(67);
  });

  it("never exceeds 100%", () => {
    expect(keystrokeAccuracy(11, 10)).toBe(100);
  });
});

describe("targetString", () => {
  it("joins the word list with single spaces for keystroke comparison", () => {
    expect(targetString(["the", "quick", "fox"])).toBe("the quick fox");
  });

  it("aligns with how scoreRun splits, so index N means the same character", () => {
    const target = targetString(WORDS);
    expect(target.startsWith("the quality")).toBe(true);
    // Position 4 is the first character of the second word in both views.
    expect(target[4]).toBe(WORDS[1]![0]);
  });
});
