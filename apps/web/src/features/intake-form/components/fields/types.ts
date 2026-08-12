/** Props shared by every question field component. */
import type { IntakeFormQuestion } from "@sdb/contracts";

export interface FieldProps {
  question: IntakeFormQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur: () => void;
  error: string | undefined;
}
