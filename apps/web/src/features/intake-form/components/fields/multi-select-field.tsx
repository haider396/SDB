/**
 * multi_select → checkbox group at ≤8 options, searchable multi-combobox
 * above that (05 §5 mapping table). The combobox follows the ARIA combobox
 * pattern: ArrowUp/Down move the active option, Enter toggles it, Escape
 * closes, Backspace on an empty query removes the last selection.
 */
import { useId, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import type { IntakeFormOption } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { describedBy, fieldId, GroupShell } from "./field-shell";
import type { FieldProps } from "./types";

const CHECKBOX_GROUP_MAX_OPTIONS = 8;

function selectedValues(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function CheckboxOptions({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const selected = selectedValues(value);
  const groupDescribedBy = describedBy(question, error !== undefined);

  const toggle = (optionValue: string) => {
    onChange(
      selected.includes(optionValue)
        ? selected.filter((item) => item !== optionValue)
        : [...selected, optionValue],
    );
  };

  return (
    <div className="space-y-2">
      {question.options.map((option) => {
        const optionId = `${fieldId(question.key)}-${option.value}`;
        return (
          <label
            key={option.value}
            htmlFor={optionId}
            className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800"
          >
            <input
              id={optionId}
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
              onBlur={onBlur}
              aria-describedby={groupDescribedBy}
              className="h-4 w-4 rounded-sm accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

function MultiCombobox({
  question,
  value,
  onChange,
  onBlur,
  error,
}: FieldProps) {
  const selected = selectedValues(value);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const optionByValue = new Map(
    question.options.map((option) => [option.value, option]),
  );
  const matches = question.options.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const activeOption: IntakeFormOption | undefined =
    matches[Math.min(activeIndex, Math.max(matches.length - 1, 0))];

  const toggle = (optionValue: string) => {
    onChange(
      selected.includes(optionValue)
        ? selected.filter((item) => item !== optionValue)
        : [...selected, optionValue],
    );
  };

  const close = () => {
    setIsOpen(false);
    setActiveIndex(0);
  };

  return (
    <div className="relative">
      {selected.length > 0 ? (
        <ul
          aria-label={`Selected: ${question.label}`}
          className="mb-2 flex flex-wrap gap-1.5"
        >
          {selected.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded-full bg-brand-blue-subtle px-2.5 py-0.5 text-xs font-medium text-brand-blue"
            >
              {optionByValue.get(item)?.label ?? item}
              <button
                type="button"
                aria-label={`Remove ${optionByValue.get(item)?.label ?? item}`}
                onClick={() => toggle(item)}
                className="rounded-full p-0.5 hover:bg-brand-blue hover:text-brand-on-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-blue"
              >
                <X aria-hidden="true" className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Input
        id={`${fieldId(question.key)}-search`}
        ref={inputRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && activeOption !== undefined
            ? `${listboxId}-${activeOption.value}`
            : undefined
        }
        placeholder={question.placeholder ?? "Search options…"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIsOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          close();
          onBlur();
        }}
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
              toggle(activeOption.value);
            }
          } else if (event.key === "Escape") {
            close();
          } else if (
            event.key === "Backspace" &&
            query === "" &&
            selected.length > 0
          ) {
            onChange(selected.slice(0, -1));
          }
        }}
        aria-invalid={error !== undefined || undefined}
        aria-describedby={describedBy(question, error !== undefined)}
      />

      <ul
        id={listboxId}
        role="listbox"
        aria-label={question.label}
        aria-multiselectable="true"
        className={cn(
          "absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border-default bg-surface-raised py-1 shadow-md",
          !isOpen && "hidden",
        )}
      >
        {matches.length === 0 ? (
          <li className="px-3 py-2 text-sm text-neutral-500" role="presentation">
            No options match “{query}”.
          </li>
        ) : (
          matches.map((option, index) => {
            const isSelected = selected.includes(option.value);
            return (
              <li
                key={option.value}
                id={`${listboxId}-${option.value}`}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "flex cursor-pointer items-center justify-between px-3 py-2 text-sm text-neutral-800",
                  index === activeIndex && "bg-surface-subtle",
                )}
                // Mousedown, not click: keep focus in the input so the
                // listbox does not close before the toggle lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  toggle(option.value);
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

export function MultiSelectField(props: FieldProps) {
  const { question, error } = props;
  return (
    <GroupShell question={question} error={error}>
      {question.options.length <= CHECKBOX_GROUP_MAX_OPTIONS ? (
        <CheckboxOptions {...props} />
      ) : (
        <MultiCombobox {...props} />
      )}
    </GroupShell>
  );
}
