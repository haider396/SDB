/**
 * Shared drag-reorder list for both panes (05 §4.7), built on dnd-kit.
 *
 * Keyboard support is two-fold (05 §4.6):
 *   - dnd-kit's KeyboardSensor on the drag handle (space to lift, arrows to
 *     move, space to drop)
 *   - explicit "Move up/down" buttons as a plain-button alternative
 * Both call the same onReorder(orderedIds).
 */
import type { ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SortableRowProps {
  id: string;
  label: string;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  children: ReactNode;
  className?: string;
}

function SortableRow({
  id,
  label,
  index,
  count,
  onMove,
  children,
  className,
}: SortableRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-md bg-surface-raised shadow-xs",
        isDragging && "z-10 opacity-80 shadow-md",
        className,
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${label}`}
        className="cursor-grab touch-none rounded-sm p-1 text-neutral-400 hover:text-neutral-700"
        {...attributes}
        {...listeners}
      >
        <GripVertical aria-hidden="true" className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex flex-col">
        <button
          type="button"
          aria-label={`Move ${label} up`}
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
          className="rounded-sm p-0.5 text-neutral-400 hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move ${label} down`}
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
          className="rounded-sm p-0.5 text-neutral-400 hover:text-neutral-700 disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export interface SortableItem {
  id: string;
  /** Accessible name used in the handle / move-button labels. */
  label: string;
}

export interface SortableListProps<T extends SortableItem> {
  items: readonly T[];
  /** Called with the full id list in its new order. */
  onReorder: (orderedIds: string[]) => void;
  renderItem: (item: T) => ReactNode;
  ariaLabel: string;
  rowClassName?: string;
  className?: string;
}

export function SortableList<T extends SortableItem>({
  items,
  onReorder,
  renderItem,
  ariaLabel,
  rowClassName,
  className,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    onReorder(arrayMove([...items], from, to).map((item) => item.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from === -1 || to === -1) return;
    move(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul aria-label={ariaLabel} className={cn("space-y-2", className)}>
          {items.map((item, index) => (
            <SortableRow
              key={item.id}
              id={item.id}
              label={item.label}
              index={index}
              count={items.length}
              onMove={move}
              className={rowClassName}
            >
              {renderItem(item)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
