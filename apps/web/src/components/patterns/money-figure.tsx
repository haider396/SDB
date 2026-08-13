/**
 * Money as an instrument reading: the amount (or range) is the emphasized
 * tabular figure; currency and "/ month" render as a muted 2xs suffix.
 * Used by table cells and rail quick-facts. Null parts render an em dash.
 */
import type { MoneyParts } from "@/lib/format";

export function MoneyFigure({ parts }: { parts: MoneyParts | null }) {
  if (parts === null) return <>—</>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-medium text-neutral-800">{parts.amount}</span>
      {parts.suffix !== null ? (
        <span className="ml-1 text-2xs text-neutral-500">{parts.suffix}</span>
      ) : null}
    </span>
  );
}
