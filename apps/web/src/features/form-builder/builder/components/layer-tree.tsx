/**
 * The layer tree — the PRIMARY keyboard surface for the builder.
 *
 * Navigating a two-dimensional canvas by tab order is hostile, so the ordered
 * list is what makes the builder operable without a mouse at all: arrow to
 * select, Enter to edit, Alt+Arrow to restack, Delete to remove. The canvas
 * follows the selection.
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { GripVertical, Heading, Minus, SquareStack, Type } from "lucide-react";
import type { FormBlock } from "@sdb/contracts";
import { cn } from "@/lib/utils";
import { describeRect } from "../../geometry";

const ICONS = {
  question: SquareStack,
  heading: Heading,
  paragraph: Type,
  divider: Minus,
  spacer: Minus,
  image: SquareStack,
  row: GripVertical,
  group: GripVertical,
} as const;

export interface LayerTreeProps {
  blocks: readonly FormBlock[];
  selectedIds: readonly string[];
  labelFor: (block: FormBlock) => string;
  onSelect: (ids: readonly string[]) => void;
  onRestack: (id: string, direction: "forward" | "backward") => void;
  onDelete: (ids: readonly string[]) => void;
  onEdit: (id: string) => void;
}

export function LayerTree({
  blocks,
  selectedIds,
  labelFor,
  onSelect,
  onRestack,
  onDelete,
  onEdit,
}: LayerTreeProps) {
  // Topmost first, matching how a designer thinks about layers.
  const ordered = [...blocks].sort(
    (a, b) => b.layout.desktop.z - a.layout.desktop.z || a.id.localeCompare(b.id),
  );

  function onKeyDown(event: KeyboardEvent<HTMLLIElement>, index: number) {
    const block = ordered[index];
    if (block === undefined) return;

    // Checked FIRST: a switch on event.key matches "ArrowUp" before any
    // default branch, so testing altKey afterwards makes restacking dead code.
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      onRestack(block.id, event.key === "ArrowUp" ? "forward" : "backward");
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        onSelect([ordered[Math.min(ordered.length - 1, index + 1)]!.id]);
        break;
      case "ArrowUp":
        event.preventDefault();
        onSelect([ordered[Math.max(0, index - 1)]!.id]);
        break;
      case "Enter":
        event.preventDefault();
        onEdit(block.id);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        onDelete([block.id]);
        break;
      default:
        break;
    }
  }

  /*
   * Move focus with the selection, but ONLY while focus is already inside the
   * tree — selecting a block by clicking the canvas or editing a field in the
   * inspector must never yank focus back here mid-keystroke.
   */
  const treeRef = useRef<HTMLUListElement | null>(null);
  const selectedId = selectedIds[0];
  useEffect(() => {
    const tree = treeRef.current;
    if (tree === null || selectedId === undefined) return;
    if (!tree.contains(document.activeElement)) return;
    const item = tree.querySelector<HTMLLIElement>(`[data-block-id="${selectedId}"]`);
    if (item !== null && item !== document.activeElement) item.focus();
  }, [selectedId]);

  if (ordered.length === 0) {
    return (
      <p className="px-2 py-4 text-xs text-neutral-500">
        Nothing on this step yet. Add a field or a text block from the palette.
      </p>
    );
  }

  return (
    <ul
      ref={treeRef}
      role="tree"
      aria-label="Blocks on this step"
      className="space-y-0.5"
    >
      {ordered.map((block, index) => {
        const selected = selectedIds.includes(block.id);
        const Icon = ICONS[block.blockType as keyof typeof ICONS] ?? SquareStack;
        return (
          <li
            key={block.id}
            data-block-id={block.id}
            role="treeitem"
            aria-selected={selected}
            aria-level={1}
            tabIndex={selected || (selectedIds.length === 0 && index === 0) ? 0 : -1}
            // Position is announced here so a keyboard user is never guessing
            // where a block actually sits.
            aria-label={`${labelFor(block)} — ${describeRect(block.layout.desktop)}`}
            onKeyDown={(event) => onKeyDown(event, index)}
            onClick={() => onSelect([block.id])}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-xs",
              selected
                ? "bg-brand-blue-subtle font-medium text-brand-navy-ink"
                : "text-neutral-700 hover:bg-surface-subtle",
            )}
          >
            <Icon className="h-3 w-3 shrink-0 text-neutral-400" aria-hidden="true" />
            <span className="truncate">{labelFor(block)}</span>
          </li>
        );
      })}
    </ul>
  );
}
