/**
 * Schema for the `questions.validation` jsonb rule bag.
 * Source: docs/02-DATABASE.md §6 — the accepted keys are exhaustive; unknown
 * keys must be rejected on write with `422 INVALID_VALIDATION_RULE`, which is
 * why this schema is `.strict()`.
 */
import { z } from 'zod';
import { RateUnitSchema } from './enums.js';
import { RepeatingGroupConfigSchema } from './repeating-group.js';

export const ValidationRulesSchema = z
  .object({
    minLength: z.number().int().nonnegative().optional(),
    maxLength: z.number().int().nonnegative().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    minSelections: z.number().int().nonnegative().optional(),
    maxSelections: z.number().int().nonnegative().optional(),
    pattern: z.string().optional(),
    scaleMin: z.number().int().optional(),
    scaleMax: z.number().int().optional(),
    scaleMinLabel: z.string().optional(),
    scaleMaxLabel: z.string().optional(),
    currency: z.string().length(3).optional(),
    allowedUnits: z.array(RateUnitSchema).optional(),
    acceptedMimeTypes: z.array(z.string()).optional(),
    maxFileSizeMb: z.number().positive().optional(),
    /**
     * Column definitions for question_type = 'repeating_group'. Structure, not
     * a rule — but it lives here because buildSnapshot() already copies
     * `validation` into question_snapshot, so the columns are captured for
     * free, and 03 §1.3 blesses this column as "an open-ended rule bag whose
     * keys vary by question type".
     *
     * Optional with no default, so every `validation` value already in the
     * column still parses to exactly what it parsed to before — proved by the
     * byte-identity block in validation-rules.test.ts, not asserted.
     */
    repeatingGroup: RepeatingGroupConfigSchema.optional(),
  })
  .strict();

export type ValidationRules = z.infer<typeof ValidationRulesSchema>;
