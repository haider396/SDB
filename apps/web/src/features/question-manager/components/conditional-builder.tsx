/**
 * Conditional visibility builder (03 §2.2): show this question only when a
 * controller question satisfies an operator. The operator list adapts to the
 * controller's type and the value input adapts to both (select options,
 * number, boolean-none, or free text). Server-rejected cycles
 * (422 CIRCULAR_CONDITION) surface inline via `serverError`.
 */
import type { ConditionalOperator, Question } from "@sdb/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  OPERATOR_LABELS,
  operatorsForControllerType,
  type ConditionalDraft,
  type ConditionalValue,
} from "../guard-rails";

function defaultValueFor(operator: ConditionalOperator): ConditionalValue {
  if (operator === "is_true" || operator === "is_false") return null;
  if (operator === "in") return [];
  return null;
}

export function ConditionalBuilder({
  value,
  onChange,
  candidates,
  serverError,
}: {
  value: ConditionalDraft | null;
  onChange: (next: ConditionalDraft | null) => void;
  /** Same-form questions eligible as controllers (self excluded by caller). */
  candidates: Question[];
  serverError?: string;
}) {
  const controller =
    value !== null
      ? candidates.find((candidate) => candidate.key === value.questionKey)
      : undefined;
  const operators =
    controller !== undefined
      ? operatorsForControllerType(controller.questionType)
      : [];

  const setController = (questionKey: string) => {
    if (questionKey === "") {
      onChange(null);
      return;
    }
    const next = candidates.find((candidate) => candidate.key === questionKey);
    if (next === undefined) return;
    const [firstOperator] = operatorsForControllerType(next.questionType);
    if (firstOperator === undefined) return;
    onChange({
      questionKey,
      operator: firstOperator,
      value: defaultValueFor(firstOperator),
    });
  };

  const setOperator = (operator: ConditionalOperator) => {
    if (value === null) return;
    onChange({ ...value, operator, value: defaultValueFor(operator) });
  };

  const setValue = (next: ConditionalValue) => {
    if (value === null) return;
    onChange({ ...value, value: next });
  };

  const needsValue =
    value !== null &&
    value.operator !== "is_true" &&
    value.operator !== "is_false";

  const renderValueInput = () => {
    if (value === null || controller === undefined || !needsValue) return null;

    const activeOptions = controller.options.filter(
      (option) => option.isActive,
    );

    if (value.operator === "in") {
      const selected = Array.isArray(value.value)
        ? value.value.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
      if (activeOptions.length > 0) {
        return (
          <fieldset className="space-y-1">
            <legend className="block text-sm font-medium text-neutral-800">
              Any of these values
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {activeOptions.map((option) => (
                <label
                  key={option.id}
                  className="flex items-center gap-1.5 text-sm text-neutral-800"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option.value)}
                    onChange={(event) =>
                      setValue(
                        event.target.checked
                          ? [...selected, option.value]
                          : selected.filter((entry) => entry !== option.value),
                      )
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        );
      }
      return (
        <div className="space-y-1">
          <Label htmlFor="conditional-value">Values (comma separated)</Label>
          <Input
            id="conditional-value"
            value={selected.join(", ")}
            onChange={(event) =>
              setValue(
                event.target.value
                  .split(",")
                  .map((entry) => entry.trim())
                  .filter((entry) => entry.length > 0),
              )
            }
          />
        </div>
      );
    }

    if (activeOptions.length > 0) {
      return (
        <div className="space-y-1">
          <Label htmlFor="conditional-value">Value</Label>
          <NativeSelect
            id="conditional-value"
            value={typeof value.value === "string" ? value.value : ""}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="" disabled>
              Choose an option…
            </option>
            {activeOptions.map((option) => (
              <option key={option.id} value={option.value}>
                {option.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      );
    }

    if (
      controller.questionType === "number" ||
      controller.questionType === "scale"
    ) {
      return (
        <div className="space-y-1">
          <Label htmlFor="conditional-value">Value</Label>
          <Input
            id="conditional-value"
            type="number"
            inputMode="numeric"
            value={typeof value.value === "number" ? value.value : ""}
            onChange={(event) =>
              setValue(
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          />
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <Label htmlFor="conditional-value">Value</Label>
        <Input
          id="conditional-value"
          value={typeof value.value === "string" ? value.value : ""}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="conditional-controller">Show only when</Label>
        <NativeSelect
          id="conditional-controller"
          value={value?.questionKey ?? ""}
          onChange={(event) => setController(event.target.value)}
        >
          <option value="">Always shown (no condition)</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </NativeSelect>
      </div>

      {value !== null && controller !== undefined ? (
        <div className="space-y-1">
          <Label htmlFor="conditional-operator">Condition</Label>
          <NativeSelect
            id="conditional-operator"
            value={value.operator}
            onChange={(event) =>
              setOperator(event.target.value as ConditionalOperator)
            }
          >
            {operators.map((operator) => (
              <option key={operator} value={operator}>
                {OPERATOR_LABELS[operator]}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}

      {renderValueInput()}

      {value !== null && controller === undefined ? (
        <p className="text-xs text-warning-text">
          The controlling question ({value.questionKey}) is no longer
          available. Clear the condition or pick another question.
        </p>
      ) : null}

      {serverError !== undefined ? (
        <p role="alert" className="text-xs text-danger-text">
          {serverError}
        </p>
      ) : null}
    </div>
  );
}
