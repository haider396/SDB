/**
 * Searchable single-select combobox.
 *
 * A native `<select>` is fine for a handful of options but unusable at the
 * length of a country list — scrolling ~200 entries to find "Colombia" is the
 * kind of friction that loses a registration. Above
 * SEARCHABLE_SELECT_MIN_OPTIONS the single_select renderer switches to this.
 *
 * Same ARIA combobox pattern as the multi_select renderer and
 * candidates/multi-select-combobox: `role="combobox"` on the input,
 * `aria-activedescendant` tracking the highlighted row, arrow/enter/escape
 * keyboard handling. Deliberately not a new interaction vocabulary — a form
 * should not teach two different pickers.
 */
import { Check, ChevronsUpDown } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

export function SearchableSelect({
  inputId,
  options,
  value,
  onChange,
  onBlur,
  label,
  placeholder,
  describedBy,
  invalid = false,
}: {
  inputId: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Accessible name for the listbox. */
  label: string;
  placeholder?: string;
  describedBy?: string | undefined;
  invalid?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = options.find((option) => option.value === value);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return options;
    // Prefix matches first — typing "co" should surface Colombia before
    // Turks and Caicos, which merely contains "co".
    const starts: SelectOption[] = [];
    const contains: SelectOption[] = [];
    for (const option of options) {
      const haystack = option.label.toLowerCase();
      if (haystack.startsWith(needle)) starts.push(option);
      else if (haystack.includes(needle)) contains.push(option);
    }
    return [...starts, ...contains];
  }, [options, query]);

  const activeOption =
    matches[Math.min(activeIndex, Math.max(matches.length - 1, 0))];

  function commit(option: SelectOption) {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
    setActiveIndex(0);
  }

  function close() {
    setIsOpen(false);
    setActiveIndex(0);
    setQuery("");
    onBlur?.();
  }

  return (
    <div className="relative">
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          aria-activedescendant={
            isOpen && activeOption !== undefined
              ? `${listboxId}-${activeOption.value}`
              : undefined
          }
          className="pr-9"
          placeholder={placeholder ?? "Search…"}
          // Closed, the input shows the chosen label; open, it shows what is
          // being typed — so the current answer never disappears mid-search.
          value={isOpen ? query : (selected?.label ?? "")}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
            setQuery("");
          }}
          onBlur={() => {
            // Defer so a click on an option lands before the list unmounts.
            blurTimer.current = setTimeout(close, 120);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((index) =>
                Math.min(index + 1, matches.length - 1),
              );
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              if (isOpen && activeOption !== undefined) {
                event.preventDefault();
                commit(activeOption);
              }
            } else if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        />
        <ChevronsUpDown
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400"
        />
      </div>

      <ul
        id={listboxId}
        role="listbox"
        aria-label={label}
        className={cn(
          "absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-default bg-surface-raised py-1 shadow-md",
          !isOpen && "hidden",
        )}
      >
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-sm text-neutral-500">No matches</li>
        ) : (
          matches.map((option, index) => {
            const isActive = option.value === activeOption?.value;
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listboxId}-${option.value}`}
                role="option"
                aria-selected={isSelected}
                onMouseDown={(event) => {
                  // mousedown, not click: blur fires first otherwise.
                  event.preventDefault();
                  if (blurTimer.current !== null) {
                    clearTimeout(blurTimer.current);
                  }
                  commit(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-sm",
                  isActive ? "bg-surface-subtle" : "bg-transparent",
                  isSelected ? "font-medium text-brand-blue" : "text-neutral-800",
                )}
              >
                {option.label}
                {isSelected ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0" />
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
