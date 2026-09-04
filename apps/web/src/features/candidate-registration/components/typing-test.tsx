/**
 * In-form typing test (T10).
 *
 * Rebecca, 18:01 → 20:41:
 *   "let's just have that be a flat field. They should always put words per
 *    minute. And then let's also have it pop out a typing test if they don't
 *    know."
 *   "they can retake it as many times as they want, and it would log their
 *    average."
 *   Haider: "Average or highest?"  Rebecca: "Let's do average."
 *
 * Measurement follows the conventions real typing tools use (Monkeytype,
 * 10FastFingers), because a candidate who has taken one of those expects the
 * same number here — and a score that disagrees with them is worse than no
 * score at all:
 *
 * 1. **The timer starts on the first keystroke**, not on a button. Pressing
 *    Start then reading the passage must not cost seconds.
 * 2. **Scoring is word-by-word, not character-position.** A positional
 *    comparison cascades: omit one letter early and every later character
 *    misaligns, so a near-perfect run scores ~7%. Comparing word to word
 *    contains the damage to the word actually mistyped.
 * 3. **WPM = correct characters ÷ 5 ÷ minutes** — the standard definition of
 *    a "word" as five characters. Only characters in correctly-typed words
 *    count, so accuracy is priced into the headline number (this is net WPM).
 * 4. **Accuracy counts keystrokes, not the finished text** — a mistake that
 *    was backspaced away still counts against you, because first-pass
 *    accuracy is the thing worth measuring. See `keystrokeAccuracy`.
 * 5. **The passage never runs out.** Words are drawn from a pool and the
 *    supply is topped up as they type, so a fast typist is not capped by the
 *    length of the text (a fixed 400-character passage caps everyone at
 *    80 wpm — precisely the people worth identifying).
 * 6. **Live per-character feedback** so mistakes are visible and correctable,
 *    which is what these tools measure: typing with self-correction, not
 *    typing blind.
 *
 * Paste is blocked. Attempts are sent individually; the SERVER computes the
 * average (candidate-registration.service.ts), so the client never submits a
 * figure it could round differently or inflate.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import type { TypingAttempt } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const TEST_SECONDS = 60;
/** Words kept ahead of the caret so the supply never runs dry. */
const VISIBLE_WORDS = 60;

/**
 * Neutral, common-vocabulary word pool — no jargon, no proper nouns, nothing
 * that advantages a native speaker over a fluent second-language one. These
 * candidates are LATAM-based and English is often their second language;
 * measuring typing speed should not accidentally measure vocabulary.
 */
const WORD_POOL = [
  "the", "of", "and", "to", "in", "is", "you", "that", "it", "he", "was", "for",
  "on", "are", "as", "with", "his", "they", "at", "be", "this", "have", "from",
  "one", "had", "by", "word", "but", "not", "what", "all", "were", "we", "when",
  "your", "can", "said", "there", "use", "an", "each", "which", "she", "do",
  "how", "their", "if", "will", "up", "other", "about", "out", "many", "then",
  "them", "these", "so", "some", "her", "would", "make", "like", "him", "into",
  "time", "has", "look", "two", "more", "write", "go", "see", "number", "no",
  "way", "could", "people", "my", "than", "first", "water", "been", "call",
  "who", "its", "now", "find", "long", "down", "day", "did", "get", "come",
  "made", "may", "part", "work", "team", "client", "email", "call", "note",
  "plan", "task", "list", "week", "month", "report", "meeting", "answer",
  "question", "message", "office", "manager", "project", "support", "service",
] as const;

/** The passage as one string, for per-keystroke comparison. */
export function targetString(words: readonly string[]): string {
  return words.join(" ");
}

function drawWords(count: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i += 1) {
    words.push(WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]!);
  }
  return words;
}

export interface TypingResult {
  wpm: number;
  correctChars: number;
  typedChars: number;
}

/**
 * Accuracy the way real typing tools define it: correct keystrokes over ALL
 * keystrokes, counted as they happen.
 *
 * Deliberately not derived from the final text. If it were, a candidate who
 * mistypes a word and backspaces to fix it would score 100% — the mistake
 * vanishes from the finished string. Monkeytype and 10FastFingers both count
 * the original keypress, because first-pass accuracy is the thing worth
 * measuring; a recruiter reading "98%" should be able to trust it means
 * "types cleanly", not "corrects diligently".
 */
export function keystrokeAccuracy(correct: number, total: number): number {
  if (total === 0) return 0;
  return Math.min(100, Math.round((correct / total) * 100));
}

/**
 * Score a run word-by-word.
 *
 * A word counts only when it matches its target exactly; its characters (plus
 * the space that follows) then count toward correct characters. The word
 * currently being typed is scored on its correct prefix so the live counter
 * does not lurch at each space.
 *
 * Exported for unit testing — the cascade bug this replaces was invisible
 * until scored directly.
 */
export function scoreRun(
  typed: string,
  targetWords: readonly string[],
  elapsedSeconds: number,
): TypingResult {
  const typedWords = typed.split(" ");
  const endsWithSpace = typed.endsWith(" ");
  let correctChars = 0;

  for (let i = 0; i < typedWords.length; i += 1) {
    // Past the end of the supplied words there is nothing to match against.
    // Without this guard a trailing space produces an empty typed segment
    // that "matches" an out-of-range empty target and earns a free character.
    if (i >= targetWords.length) break;

    const typedWord = typedWords[i] ?? "";
    const targetWord = targetWords[i] ?? "";
    const isFinished = i < typedWords.length - 1 || endsWithSpace;

    if (isFinished) {
      // A completed word scores all-or-nothing, plus its trailing space.
      if (typedWord === targetWord) correctChars += targetWord.length + 1;
    } else {
      // In-progress word: credit the correct prefix only.
      let prefix = 0;
      while (
        prefix < typedWord.length &&
        prefix < targetWord.length &&
        typedWord[prefix] === targetWord[prefix]
      ) {
        prefix += 1;
      }
      correctChars += prefix;
    }
  }

  const typedChars = typed.length;
  const minutes = elapsedSeconds / 60;
  const wpm = minutes > 0 ? Math.round(correctChars / 5 / minutes) : 0;

  return { wpm, correctChars, typedChars };
}

interface Props {
  attempts: TypingAttempt[];
  onAttemptsChange: (attempts: TypingAttempt[]) => void;
  /** Manually entered WPM — used when the candidate already knows their speed. */
  manualWpm: string;
  onManualWpmChange: (value: string) => void;
}

export function TypingTest({
  attempts,
  onAttemptsChange,
  manualWpm,
  onManualWpmChange,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isArmed, setIsArmed] = useState(false); // ready, timer not started
  const [isRunning, setIsRunning] = useState(false);
  const [typed, setTyped] = useState("");
  const [words, setWords] = useState<string[]>(() => drawWords(VISIBLE_WORDS));
  const [remaining, setRemaining] = useState(TEST_SECONDS);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Keystroke tallies for accuracy. Refs, not state: they change on every
   * keypress and nothing renders from them directly except the live readout,
   * which re-renders anyway from `typed`.
   */
  const keystrokes = useRef({ total: 0, correct: 0 });
  const [liveAccuracy, setLiveAccuracy] = useState(0);

  const average = useMemo(() => {
    if (attempts.length === 0) return null;
    const total = attempts.reduce((sum, attempt) => sum + attempt.wpm, 0);
    return Math.round(total / attempts.length);
  }, [attempts]);

  const live = useMemo(
    () => scoreRun(typed, words, TEST_SECONDS - remaining),
    [typed, words, remaining],
  );

  const finish = useCallback(() => {
    setIsRunning(false);
    setIsArmed(false);
    const result = scoreRun(typed, words, TEST_SECONDS);
    onAttemptsChange([
      ...attempts,
      {
        wpm: result.wpm,
        accuracy: keystrokeAccuracy(
          keystrokes.current.correct,
          keystrokes.current.total,
        ),
        durationSeconds: TEST_SECONDS,
      },
    ]);
    setTyped("");
    setWords(drawWords(VISIBLE_WORDS));
    setRemaining(TEST_SECONDS);
    keystrokes.current = { total: 0, correct: 0 };
    setLiveAccuracy(0);
  }, [attempts, onAttemptsChange, typed, words]);

  useEffect(() => {
    if (!isRunning) return;
    if (remaining <= 0) {
      finish();
      return;
    }
    const timer = setTimeout(() => setRemaining((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [isRunning, remaining, finish]);

  function arm() {
    setTyped("");
    setWords(drawWords(VISIBLE_WORDS));
    setRemaining(TEST_SECONDS);
    setIsArmed(true);
    setIsRunning(false);
    keystrokes.current = { total: 0, correct: 0 };
    setLiveAccuracy(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleChange(next: string) {
    // Convention 1: the clock starts on the first keystroke.
    if (!isRunning && isArmed && next.length > 0) setIsRunning(true);

    // Count only ADDED characters. A backspace shortens the string and is not
    // a keystroke against the target — but it also never un-counts the wrong
    // character that preceded it, which is the whole point (see
    // keystrokeAccuracy).
    if (next.length > typed.length) {
      const target = targetString(words);
      for (let i = typed.length; i < next.length; i += 1) {
        keystrokes.current.total += 1;
        if (next[i] === target[i]) keystrokes.current.correct += 1;
      }
      setLiveAccuracy(
        keystrokeAccuracy(
          keystrokes.current.correct,
          keystrokes.current.total,
        ),
      );
    }

    setTyped(next);

    // Convention 5: keep the word supply ahead of the caret.
    const typedWordCount = next.split(" ").length;
    if (typedWordCount > words.length - 20) {
      setWords((current) => [...current, ...drawWords(30)]);
    }
  }

  const typedWords = typed.split(" ");
  const activeWordIndex = typedWords.length - 1;

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="typing-wpm">Typing speed (words per minute)</Label>
        <input
          id="typing-wpm"
          type="number"
          inputMode="numeric"
          min={0}
          max={400}
          value={average !== null ? String(average) : manualWpm}
          onChange={(event) => onManualWpmChange(event.target.value)}
          readOnly={average !== null}
          className="h-10 w-40 rounded-md border border-border-default bg-surface-raised px-3 text-sm tabular-nums text-brand-navy-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 read-only:bg-surface-subtle"
          aria-describedby="typing-wpm-help"
        />
        <p id="typing-wpm-help" className="text-xs text-neutral-500">
          {average !== null
            ? `Your average across ${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}. Take the test again to update it.`
            : "Enter it if you know it, or take the quick test below."}
        </p>
      </div>

      {!isOpen ? (
        <Button type="button" variant="secondary" onClick={() => setIsOpen(true)}>
          <Keyboard aria-hidden="true" />
          {attempts.length === 0 ? "Take the typing test" : "Take it again"}
        </Button>
      ) : (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium text-brand-navy-ink">
                Type the words below
              </p>
              <div className="flex items-center gap-4 text-sm tabular-nums text-neutral-600">
                {isRunning ? (
                  <>
                    <span>{live.wpm} wpm</span>
                    <span>{liveAccuracy}%</span>
                  </>
                ) : null}
                <span aria-live="polite" aria-atomic="true">
                  {isRunning
                    ? `${remaining}s`
                    : isArmed
                      ? "Start typing…"
                      : `${TEST_SECONDS}s`}
                </span>
              </div>
            </div>

            {/* Convention 6: live per-character feedback. */}
            <div
              aria-hidden="true"
              className="select-none rounded-md bg-surface-subtle p-3 font-mono text-sm leading-relaxed"
            >
              {words.slice(0, 36).map((word, wordIndex) => {
                const typedWord = typedWords[wordIndex];
                const isActive = isArmed && wordIndex === activeWordIndex;
                const isPast = typedWord !== undefined && !isActive;
                return (
                  <span
                    key={`${word}-${wordIndex}`}
                    className={cn(
                      "mr-2 inline-block rounded px-0.5",
                      isActive && "bg-brand-blue-subtle",
                    )}
                  >
                    {word.split("").map((char, charIndex) => {
                      const typedChar = typedWord?.[charIndex];
                      const state =
                        typedChar === undefined
                          ? "pending"
                          : typedChar === char
                            ? "correct"
                            : "wrong";
                      return (
                        <span
                          key={charIndex}
                          className={cn(
                            state === "correct" && "text-success-text",
                            state === "wrong" &&
                              "bg-danger-subtle text-danger-text",
                            state === "pending" &&
                              (isPast ? "text-neutral-400" : "text-neutral-600"),
                          )}
                        >
                          {char}
                        </span>
                      );
                    })}
                    {/* Extra characters typed beyond the word. */}
                    {typedWord !== undefined && typedWord.length > word.length ? (
                      <span className="bg-danger-subtle text-danger-text">
                        {typedWord.slice(word.length)}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>

            <Label htmlFor="typing-input" className="sr-only">
              Typing test input
            </Label>
            <input
              id="typing-input"
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              value={typed}
              disabled={!isArmed}
              onChange={(event) => handleChange(event.target.value)}
              onPaste={(event) => event.preventDefault()}
              className="w-full rounded-md border border-border-default bg-surface-raised p-3 font-mono text-sm text-brand-navy-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 disabled:bg-surface-subtle"
              placeholder={
                isArmed ? "" : "Press Start, then type the words above."
              }
            />

            <div className="flex flex-wrap items-center gap-2">
              {!isArmed ? (
                <Button type="button" onClick={arm}>
                  {attempts.length === 0 ? "Start" : "Start another attempt"}
                </Button>
              ) : (
                <Button type="button" variant="secondary" onClick={finish}>
                  Finish now
                </Button>
              )}
              {/* No "clear attempts": every attempt counts toward the average
                  by design. Letting a candidate discard the slow ones would
                  turn the average into a best-of, which is exactly what
                  Rebecca ruled out (20:41). */}
            </div>

            {attempts.length > 0 ? (
              <ul className="space-y-1 text-xs tabular-nums text-neutral-600">
                {attempts.map((attempt, index) => (
                  <li key={index}>
                    Attempt {index + 1}: {attempt.wpm} wpm · {attempt.accuracy}%
                    accurate
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
