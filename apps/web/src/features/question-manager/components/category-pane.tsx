/**
 * Left pane: question categories (03 §2.1). Drag/keyboard reorder, inline
 * create and rename, optimistic active toggle. Deactivating a category hides
 * it and all of its questions from every form without touching per-question
 * state — the toggle's help text says so.
 */
import { useState } from "react";
import { FolderPlus, Pencil } from "lucide-react";
import type { QuestionCategory } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  useCreateCategory,
  useReorderCategories,
  useSetCategoryActive,
  useUpdateCategory,
} from "../api";
import { ActiveToggle, Chip } from "./chips";
import { SortableList } from "./sortable-list";

function CategoryRow({
  category,
  isSelected,
  onSelect,
}: {
  category: QuestionCategory;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const updateCategory = useUpdateCategory();
  const setActive = useSetCategoryActive();
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(category.label);
  const [editError, setEditError] = useState<string | null>(null);

  const saveRename = async () => {
    const label = draftLabel.trim();
    if (label.length === 0 || label === category.label) {
      setIsEditing(false);
      setDraftLabel(category.label);
      return;
    }
    try {
      await updateCategory.mutateAsync({ id: category.id, body: { label } });
      setIsEditing(false);
      setEditError(null);
    } catch (error) {
      setEditError(
        error instanceof ApiError
          ? error.message
          : "Could not rename the category.",
      );
    }
  };

  if (isEditing) {
    return (
      <form
        className="flex-1 space-y-1 py-1.5 pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          void saveRename();
        }}
      >
        <Label htmlFor={`category-rename-${category.id}`} className="sr-only">
          Category name
        </Label>
        <div className="flex items-center gap-1.5">
          <Input
            id={`category-rename-${category.id}`}
            value={draftLabel}
            onChange={(event) => setDraftLabel(event.target.value)}
            autoFocus
            className="h-7 text-sm"
          />
          <Button type="submit" size="sm" disabled={updateCategory.isPending}>
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsEditing(false);
              setDraftLabel(category.label);
              setEditError(null);
            }}
          >
            Cancel
          </Button>
        </div>
        {editError !== null ? (
          <p className="text-xs text-danger-text">{editError}</p>
        ) : null}
      </form>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-1">
      <button
        type="button"
        onClick={onSelect}
        aria-current={isSelected ? "true" : undefined}
        className={cn(
          "min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-left text-sm",
          isSelected
            ? "font-semibold text-brand-navy-ink"
            : "text-neutral-600 hover:text-brand-navy-ink",
        )}
      >
        {category.label}
        <span className="ml-1.5 font-normal text-neutral-400">
          {category.questionCount}
        </span>
      </button>
      {!category.isActive ? <Chip tone="warning">Inactive</Chip> : null}
      <button
        type="button"
        aria-label={`Rename ${category.label}`}
        onClick={() => setIsEditing(true)}
        className="rounded-sm p-1 text-neutral-400 hover:text-neutral-800"
      >
        <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <ActiveToggle
        isActive={category.isActive}
        label={`Active: ${category.label}. Deactivating hides this category and all of its questions from every form.`}
        onChange={(next) =>
          setActive.mutate({ id: category.id, isActive: next })
        }
      />
    </div>
  );
}

function CreateCategoryForm({ autoFocus }: { autoFocus?: boolean }) {
  const createCategory = useCreateCategory();
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = label.trim();
    if (trimmed.length === 0) return;
    try {
      await createCategory.mutateAsync({ label: trimmed });
      setLabel("");
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not create the category.",
      );
    }
  };

  return (
    <form
      className="space-y-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Label htmlFor="new-category-label">New category</Label>
      <div className="flex items-center gap-1.5">
        <Input
          id="new-category-label"
          value={label}
          placeholder="e.g. Working style"
          autoFocus={autoFocus}
          onChange={(event) => setLabel(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={createCategory.isPending}>
          {createCategory.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      {error !== null ? (
        <p className="text-xs text-danger-text">{error}</p>
      ) : null}
    </form>
  );
}

export function CategoryPane({
  categories,
  selectedCategoryId,
  onSelectCategory,
}: {
  categories: QuestionCategory[];
  selectedCategoryId: string | undefined;
  onSelectCategory: (id: string) => void;
}) {
  const reorderCategories = useReorderCategories();

  if (categories.length === 0) {
    return (
      <EmptyState
        icon={FolderPlus}
        title="No categories yet"
        description="Categories group intake questions into form steps. Create the first one to start building the form."
        action={<CreateCategoryForm autoFocus />}
      />
    );
  }

  return (
    <div className="space-y-4">
      <SortableList
        ariaLabel="Question categories"
        items={categories.map((category) => ({
          ...category,
          label: category.label,
        }))}
        onReorder={(orderedIds) => reorderCategories.mutate(orderedIds)}
        renderItem={(category) => (
          <CategoryRow
            category={category}
            isSelected={category.id === selectedCategoryId}
            onSelect={() => onSelectCategory(category.id)}
          />
        )}
        rowClassName="px-2"
      />
      <CreateCategoryForm />
    </div>
  );
}
