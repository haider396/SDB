import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

/**
 * Give `findBy*` and `waitFor` room on a slow machine.
 *
 * Testing Library defaults to 1000ms, which is comfortable on a dev laptop and
 * not on a shared CI runner: the first CI run failed 14 tests in the two
 * async-heavy suites — the built form and the registration form — every one of
 * them with "Unable to find a label with the text of: /First name/" at ~1005ms.
 * Nothing was broken; the render simply had not finished inside a second.
 *
 * This raises the ceiling for waiting, not the time a passing test takes: a
 * query that resolves quickly still resolves quickly. A test that genuinely
 * hangs now fails against vitest's own testTimeout instead, with a clearer
 * message than a truncated query.
 */
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer (P6 stats
// chart) requires one. A no-op stub is enough — chart geometry is not
// asserted in jsdom.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
