/**
 * Exhaustive question_type → field component map (05 §5 req 3, AC-IF-18).
 *
 * Two compile-time guards ensure a new QuestionType cannot ship without a
 * renderer:
 *   1. The switch below ends in a `never` guard — an unhandled member makes
 *      the assignment to `never` a type error.
 *   2. HANDLED_QUESTION_TYPES must satisfy Record<QuestionType, true> — the
 *      type-level test in tests/intake-form/exhaustiveness.test.ts pins it.
 */
import type { QuestionType } from "@sdb/contracts";
import { CurrencyRangeField } from "./fields/currency-range-field";
import { FileUploadField } from "./fields/file-upload-field";
import { MultiSelectField } from "./fields/multi-select-field";
import { RepeatingGroupField } from "./fields/repeating-group-field";
import {
  ScaleField,
  SingleSelectField,
  YesNoField,
} from "./fields/select-fields";
import {
  DateField,
  LongTextField,
  NumberField,
  TextField,
} from "./fields/text-fields";
import type { FieldProps } from "./fields/types";

/** Compile-time completeness witness for AC-IF-18. */
export const HANDLED_QUESTION_TYPES = {
  short_text: true,
  long_text: true,
  email: true,
  phone: true,
  number: true,
  currency_range: true,
  single_select: true,
  multi_select: true,
  yes_no: true,
  date: true,
  scale: true,
  file_upload: true,
  repeating_group: true,
} as const satisfies Record<QuestionType, true>;

export function QuestionField(props: FieldProps) {
  const type = props.question.questionType;
  switch (type) {
    case "short_text":
    case "email":
    case "phone":
      return <TextField {...props} />;
    case "long_text":
      return <LongTextField {...props} />;
    case "number":
      return <NumberField {...props} />;
    case "currency_range":
      return <CurrencyRangeField {...props} />;
    case "single_select":
      return <SingleSelectField {...props} />;
    case "multi_select":
      return <MultiSelectField {...props} />;
    case "yes_no":
      return <YesNoField {...props} />;
    case "date":
      return <DateField {...props} />;
    case "scale":
      return <ScaleField {...props} />;
    case "file_upload":
      return <FileUploadField {...props} />;
    case "repeating_group":
      return <RepeatingGroupField {...props} />;
    default: {
      const unhandled: never = type;
      throw new Error(`Unhandled question type: ${String(unhandled)}`);
    }
  }
}
