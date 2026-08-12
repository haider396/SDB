import "@testing-library/jest-dom/vitest";

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
