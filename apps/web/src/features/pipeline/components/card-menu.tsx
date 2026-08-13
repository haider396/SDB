/**
 * Accessible overflow menu for a pipeline card, and the card's keyboard
 * alternative to drag-advance (05 §4.6/§4.7): "Advance to…" lists only the
 * machine-legal targets. No Radix dropdown package exists in this app, so
 * this is a small hand-rolled menu: roving focus with arrow keys, Escape
 * closes and restores focus to the trigger, outside click closes.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CardMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  /** Renders in danger text (Reject…). */
  destructive?: boolean;
}

export interface CardMenuProps {
  /** Accessible name, e.g. "Actions for Maria G.". */
  label: string;
  items: CardMenuItem[];
}

export function CardMenu({ label, items }: CardMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Outside click closes without stealing focus.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        !menuRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        close(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [isOpen, close]);

  // Focus the first item when opening.
  useEffect(() => {
    if (isOpen) {
      const first = menuRef.current?.querySelector<HTMLButtonElement>(
        "[role='menuitem']",
      );
      first?.focus();
    }
  }, [isOpen]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ??
        [],
    );
    const index = menuItems.findIndex(
      (item) => item === document.activeElement,
    );
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      menuItems[(index + 1) % menuItems.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      menuItems[(index - 1 + menuItems.length) % menuItems.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      menuItems[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      menuItems[menuItems.length - 1]?.focus();
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="rounded-sm p-1 text-neutral-400 hover:text-neutral-800"
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-7 z-30 min-w-44 rounded-md border border-border-default bg-surface-raised py-1 shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-subtle focus:bg-surface-subtle focus:outline-none",
                item.destructive ? "text-danger-text" : "text-neutral-800",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
