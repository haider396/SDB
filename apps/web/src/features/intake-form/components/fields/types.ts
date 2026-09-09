/** Props shared by every question field component. */
import type {
  IntakeFormQuestion,
  RepeatingGroupFieldError,
} from "@sdb/contracts";

export interface FieldProps {
  question: IntakeFormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  error: string | undefined;
  /**
   * Cell-precise failures for a repeating_group, flattened out of the nested
   * react-hook-form error object. Optional because `error` — one message for
   * the whole question — is all every other field type has or needs.
   */
  rowErrors?: readonly RepeatingGroupFieldError[];
}
