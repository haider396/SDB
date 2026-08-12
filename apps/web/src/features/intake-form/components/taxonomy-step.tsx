/**
 * Cascading engine → department → role category selects, driven by
 * GET /api/v1/taxonomy/public (01 §3 J1 step 3). Selecting a role category
 * triggers a refetch of the form with role-scoped questions.
 */
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { PublicTaxonomy } from "../taxonomy";

export interface TaxonomySelection {
  engineId: string | undefined;
  departmentId: string | undefined;
  roleCategoryId: string | undefined;
}

export const EMPTY_TAXONOMY_SELECTION: TaxonomySelection = {
  engineId: undefined,
  departmentId: undefined,
  roleCategoryId: undefined,
};

export interface TaxonomyErrors {
  engineId?: string;
  departmentId?: string;
  roleCategoryId?: string;
}

/** Required-select validation for the role step. */
export function validateTaxonomySelection(
  selection: TaxonomySelection,
): TaxonomyErrors {
  const errors: TaxonomyErrors = {};
  if (selection.engineId === undefined) {
    errors.engineId = "Choose an engine.";
  }
  if (selection.departmentId === undefined) {
    errors.departmentId = "Choose a department.";
  }
  if (selection.roleCategoryId === undefined) {
    errors.roleCategoryId = "Choose a role category.";
  }
  return errors;
}

function SelectRow({
  id,
  label,
  placeholder,
  value,
  options,
  disabled,
  disabledHint,
  error,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string | undefined;
  options: readonly { id: string; label: string }[];
  disabled: boolean;
  disabledHint: string;
  error: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const errorElementId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
        aria-invalid={error !== undefined || undefined}
        aria-describedby={error !== undefined ? errorElementId : undefined}
      >
        <option value="">{disabled ? disabledHint : placeholder}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
      {error !== undefined ? (
        <p id={errorElementId} className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TaxonomyStep({
  taxonomy,
  selection,
  errors,
  onChange,
}: {
  taxonomy: PublicTaxonomy;
  selection: TaxonomySelection;
  errors: TaxonomyErrors;
  onChange: (selection: TaxonomySelection) => void;
}) {
  const engine = taxonomy.engines.find((item) => item.id === selection.engineId);
  const department = engine?.departments.find(
    (item) => item.id === selection.departmentId,
  );
  const roleCategory = department?.roleCategories.find(
    (item) => item.id === selection.roleCategoryId,
  );

  return (
    <div className="space-y-4">
      <SelectRow
        id="taxonomy-engine"
        label="Which part of your business is this hire for?"
        placeholder="Select an engine…"
        value={selection.engineId}
        options={taxonomy.engines}
        disabled={false}
        disabledHint=""
        error={errors.engineId}
        onChange={(engineId) =>
          onChange({
            engineId,
            departmentId: undefined,
            roleCategoryId: undefined,
          })
        }
      />
      {engine?.description !== undefined && engine?.description !== null ? (
        <p className="text-xs text-neutral-500">{engine.description}</p>
      ) : null}

      <SelectRow
        id="taxonomy-department"
        label="Department"
        placeholder="Select a department…"
        value={selection.departmentId}
        options={engine?.departments ?? []}
        disabled={engine === undefined}
        disabledHint="Choose an engine first"
        error={errors.departmentId}
        onChange={(departmentId) =>
          onChange({
            engineId: selection.engineId,
            departmentId,
            roleCategoryId: undefined,
          })
        }
      />

      <SelectRow
        id="taxonomy-role-category"
        label="Role category"
        placeholder="Select a role category…"
        value={selection.roleCategoryId}
        options={department?.roleCategories ?? []}
        disabled={department === undefined}
        disabledHint="Choose a department first"
        error={errors.roleCategoryId}
        onChange={(roleCategoryId) =>
          onChange({ ...selection, roleCategoryId })
        }
      />

      {roleCategory !== undefined ? (
        <div className="rounded-md bg-brand-blue-subtle p-3 text-sm text-brand-navy-ink">
          <p className="font-medium">
            {roleCategory.advertisedTitle ?? roleCategory.label}
          </p>
          {roleCategory.description !== undefined &&
          roleCategory.description !== null ? (
            <p className="mt-1 text-xs text-neutral-600">
              {roleCategory.description}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
