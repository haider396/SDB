/**
 * Generic searchable multi-select combobox over {id, label} options — the
 * same ARIA combobox pattern as the intake renderer's multi_select, reused
 * for the tools filter and the tools/skills pickers.
 */
import { Check, X } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ComboOption {
  id: string;
  label: string;
}

export interface MultiSelectComboboxProps {
  inputId: string;
  options: ComboOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  /** Accessible name for the listbox and chip list. */
  label: string;
  /** Hide the selected chips (when the caller renders its own rows). */
  hideChips?: boolean;
  isLoading?: boolean;
  loadError?: string | null;
}

export function MultiSelectCombobox({
  inputId,
  options,
  selectedIds,
  onChange,
  placeholder,
  label,
  hideChips = false,
  isLoading = false,
  loadError = null,
}: MultiSelectComboboxProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxId = useId();

  const optionById = new Map(options.map((option) => [option.id, option]));
  const matches = options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeOption =
    matches[Math.min(activeIndex, Math.max(matches.length - 1, 0))];

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id],
    );
  };

  const close = () => {
    setIsOpen(false);
    setActiveIndex(0);
  };

  if (loadError !== null) {
    return <p className="text-xs text-danger-text">{loadError}</p>;
  }

  return (
    <div className="relative">
      {!hideChips && selectedIds.length > 0 ? (
        <ul aria-label={`Selected: ${label}`} className="mb-2 flex flex-wrap gap-1.5">
          {selectedIds.map((id) => (
            <li
              key={id}
              className="flex items-center gap-1 rounded-full bg-brand-blue-subtle px-2.5 py-0.5 text-xs font-medium text-brand-blue"
            >
              {optionById.get(id)?.label ?? id}
              <button
                type="button"
                aria-label={`Remove ${optionById.get(id)?.label ?? id}`}
                onClick={() => toggle(id)}
                className="rounded-full p-0.5 hover:bg-brand-blue hover:text-brand-on-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-blue"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        id={inputId}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && activeOption !== undefined
            ? `${listboxId}-${activeOption.id}`
            : undefined
        }
        placeholder={isLoading ? "Loading…" : (placeholder ?? "Search…")}
        disabled={isLoading}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={close}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            if (isOpen && activeOption !== undefined) {
              event.preventDefault();
              toggle(activeOption.id);
            }
          } else if (event.key === "Escape") {
            close();
          } else if (
            event.key === "Backspace" &&
            query === "" &&
            !hideChips &&
            selectedIds.length > 0
          ) {
            onChange(selectedIds.slice(0, -1));
          }
        }}
      />

      <ul
        id={listboxId}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        className={cn(
          "absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-default bg-surface-raised py-1 shadow-md",
          !isOpen && "hidden",
        )}
      >
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-sm text-neutral-500" role="presentation">
            {options.length === 0 ? "No options available." : `No options match “${query}”.`}
          </li>
        ) : (
          matches.map((option, index) => {
            const isSelected = selectedIds.includes(option.id);
            return (
              <li
                key={option.id}
                id={`${listboxId}-${option.id}`}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-neutral-800",
                  index === activeIndex && "bg-surface-subtle",
                )}
                // Mousedown keeps focus in the input so the listbox stays open.
                onMouseDown={(event) => {
                  event.preventDefault();
                  toggle(option.id);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                {option.label}
                {isSelected ? (
                  <Check aria-hidden="true" className="h-4 w-4 text-brand-blue" />
                ) : null}
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
