/**
 * Schema for the `questions.validation` jsonb rule bag.
 * Source: docs/02-DATABASE.md §6 — the accepted keys are exhaustive; unknown
 * keys must be rejected on write with `422 INVALID_VALIDATION_RULE`, which is
 * why this schema is `.strict()`.
 */
import { z } from 'zod';
import { RateUnitSchema } from './enums.js';

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
  })
  .strict();

export type ValidationRules = z.infer<typeof ValidationRulesSchema>;
