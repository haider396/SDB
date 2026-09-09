/**
 * The option shape carried by every choice-style question.
 * Source: docs/03-INTAKE-FORM-ENGINE.md §3.2 — `question_options` rows as they
 * appear on the wire.
 *
 * THIS LIVES IN ITS OWN MODULE FOR A REASON, and moving it back into
 * `intake.ts` reintroduces a bug that does not announce itself.
 *
 * `intake.ts` imports `ValidationRulesSchema`. Once `validation-rules.ts` gained
 * a `repeatingGroup` key, and `repeating-group.ts` needed this option shape for
 * its inline-choice columns, the graph closed into a cycle:
 *
 *   validation-rules → repeating-group → intake → validation-rules
 *
 * Zod schemas are constructed at module-evaluation time, so a cycle here is not
 * a lint nit. Entered from `index.ts` the cycle does not even throw: `intake.ts`
 * evaluates while `validation-rules.js` is still initialising, so
 * `IntakeFormQuestionSchema.shape.validation` comes out `undefined` and every
 * later parse of a form question dies with "Cannot read properties of undefined
 * (reading '_parse')" — at runtime, in all three form read services, with no
 * compile error anywhere. A leaf module both sides can depend on deletes the
 * edge that closed the loop.
 */
import { z } from 'zod';

export const IntakeFormOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type IntakeFormOption = z.infer<typeof IntakeFormOptionSchema>;
