/**
 * Candidate Form Builder contracts.
 *
 * An admin builds a candidate form on a canvas, activates it, and shares the
 * resulting public link. These schemas are validated on BOTH sides of the wire:
 * the API rejects anything that fails them, and the builder derives its form
 * state from the same definitions.
 *
 * ── Why colours are token NAMES, not hex ─────────────────────────────────────
 * The web bans hex literals in components (AC-UI-01), but that ESLint rule is
 * purely static — a colour arriving at runtime from the database passes it
 * cleanly. So the lint rule is NOT what keeps a form on-brand.
 *
 * `FormColorTokenSchema` is. It is a closed enum of the tokens defined in
 * apps/web/src/styles/tokens.css, so an out-of-palette colour is a 400 rather
 * than a design review. The renderer emits `var(--${token})`, which is why the
 * values here are the CSS custom-property names verbatim, minus the leading
 * `--`: no case conversion sits between this list and the stylesheet, so the
 * two cannot drift.
 *
 * A brand refresh is then a tokens.css edit with zero data migration.
 */
import { z } from 'zod';
import { IntakeAnswerSchema } from './intake.js';
import {
  RegistrationFileRefSchema,
  TypingAttemptSchema,
} from './candidate-registration.js';

/* ── Colour ─────────────────────────────────────────────────────────────── */

/**
 * Every colour an admin may choose. Mirrors tokens.css exactly.
 *
 * Two deliberate omissions:
 *
 * - `brand-blue-bright` — 05-FRONTEND §3.5 states it fails AA on white and
 *   must never be used as text on a light background. Do not offer a foot-gun.
 * - The semantic tokens (`danger`, `success`, `warning`, `info` and their
 *   -text/-subtle variants) — §3.6 reserves those for state. If a decorative
 *   border can be `danger`, error states stop meaning anything.
 */
export const FORM_COLOR_TOKENS = [
  // Brand
  'brand-navy',
  'brand-navy-deep',
  'brand-navy-ink',
  'brand-navy-hover',
  'brand-navy-subtle',
  'brand-blue',
  'brand-blue-hover',
  'brand-blue-subtle',
  'brand-slate',
  'brand-teal',
  'brand-teal-bright',
  'brand-on-dark',
  // Surfaces
  'surface-page',
  'surface-raised',
  'surface-subtle',
  'surface-inverse',
  'border-default',
  // Neutral ramp
  'neutral-50',
  'neutral-100',
  'neutral-200',
  'neutral-300',
  'neutral-400',
  'neutral-500',
  'neutral-600',
  'neutral-700',
  'neutral-800',
  'neutral-900',
  // Not a token — the explicit "no fill" choice.
  'transparent',
] as const;

export const FormColorTokenSchema = z.enum(FORM_COLOR_TOKENS);
export type FormColorToken = (typeof FORM_COLOR_TOKENS)[number];

/** Gradients are backgrounds only — never text, never borders. */
export const FORM_GRADIENT_TOKENS = ['gradient-brand', 'gradient-progress'] as const;
export const FormGradientTokenSchema = z.enum(FORM_GRADIENT_TOKENS);
export type FormGradientToken = (typeof FORM_GRADIENT_TOKENS)[number];

export const FormBackgroundSchema = z.union([
  FormColorTokenSchema,
  FormGradientTokenSchema,
]);
export type FormBackground = z.infer<typeof FormBackgroundSchema>;

/* ── Geometry ───────────────────────────────────────────────────────────── */

/**
 * Canvas units, not pixels: 24 columns wide, 8px rows. Absolute pixels would
 * break the form at any viewport width other than the author's monitor.
 */
export const CANVAS_COLUMNS = 24;
export const CANVAS_ROW_PX = 8;
export const MIN_COL_SPAN = 2;
export const MIN_ROW_SPAN = 4;

/**
 * One block's rectangle. Every axis is bounded — a free canvas that accepts a
 * width of 900,000 is a renderer denial-of-service, not a feature.
 */
export const CanvasRectSchema = z
  .object({
    col: z.number().int().min(0).max(CANVAS_COLUMNS - 1),
    row: z.number().int().min(0).max(2000),
    colSpan: z.number().int().min(MIN_COL_SPAN).max(CANVAS_COLUMNS),
    rowSpan: z.number().int().min(MIN_ROW_SPAN).max(400),
    z: z.number().int().min(0).max(999).default(0),
  })
  .strict()
  .refine((rect) => rect.col + rect.colSpan <= CANVAS_COLUMNS, {
    message: `A block must fit inside the ${CANVAS_COLUMNS}-column canvas.`,
    path: ['colSpan'],
  });
export type CanvasRect = z.infer<typeof CanvasRectSchema>;

/**
 * Desktop and phone arrangements (Haider, 4 Sep: "arrange the phone version
 * too"). `mobile: null` means auto-stack in reading order — top-to-bottom then
 * left-to-right — so an admin only positions the blocks the default gets
 * wrong, rather than re-arranging every form twice.
 */
export const BlockLayoutSchema = z
  .object({
    desktop: CanvasRectSchema,
    mobile: CanvasRectSchema.nullable().default(null),
  })
  .strict();
export type BlockLayout = z.infer<typeof BlockLayoutSchema>;

/* ── Style ──────────────────────────────────────────────────────────────── */

const px = (min: number, max: number) => z.number().int().min(min).max(max);

export const BoxSpacingSchema = z
  .object({
    top: px(0, 200),
    right: px(0, 200),
    bottom: px(0, 200),
    left: px(0, 200),
  })
  .strict();
export type BoxSpacing = z.infer<typeof BoxSpacingSchema>;

/** Shadow colour is a token; the geometry is free, because it is pure layout. */
export const ShadowSchema = z
  .object({
    colorToken: FormColorTokenSchema,
    offsetX: px(-64, 64),
    offsetY: px(-64, 64),
    blur: px(0, 128),
    spread: px(-64, 64),
  })
  .strict();
export type Shadow = z.infer<typeof ShadowSchema>;

export const BorderStyleSchema = z.enum(['none', 'solid', 'dashed', 'dotted']);
export type BorderStyle = z.infer<typeof BorderStyleSchema>;

/**
 * Input-field appearance — the controls Haider listed: font colour, border
 * width/colour/style, corner radius, background, padding on each side, and the
 * full shadow.
 *
 * Every key is optional. An omitted key inherits: per-block style falls back to
 * the form default, which falls back to the token defaults in form-canvas.css,
 * which render exactly like the standard `<Input>`. That inheritance is plain
 * CSS custom-property cascade, so the renderer needs no merge logic.
 */
export const FieldStyleSchema = z
  .object({
    textColorToken: FormColorTokenSchema.optional(),
    backgroundColorToken: FormBackgroundSchema.optional(),
    borderColorToken: FormColorTokenSchema.optional(),
    borderWidth: px(0, 24).optional(),
    borderStyle: BorderStyleSchema.optional(),
    cornerRadius: px(0, 200).optional(),
    padding: BoxSpacingSchema.optional(),
    /** null is meaningful: "explicitly no shadow", distinct from "inherit". */
    shadow: ShadowSchema.nullable().optional(),
    labelColorToken: FormColorTokenSchema.optional(),
    placeholderColorToken: FormColorTokenSchema.optional(),
  })
  .strict();
export type FieldStyle = z.infer<typeof FieldStyleSchema>;

/** Text blocks (heading, paragraph) reuse the box controls plus type controls. */
export const BlockStyleSchema = FieldStyleSchema.extend({
  align: z.enum(['left', 'center', 'right']).optional(),
  fontSize: z
    .enum(['2xs', 'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'])
    .optional(),
  fontWeight: z.enum(['400', '500', '600', '700']).optional(),
}).strict();
export type BlockStyle = z.infer<typeof BlockStyleSchema>;

/** Whole-form appearance, including the SDB brand furniture. */
export const FormThemeSchema = z
  .object({
    pageBackground: FormBackgroundSchema.default('surface-page'),
    /** Form padding — the outer box. */
    padding: BoxSpacingSchema.default({ top: 24, right: 24, bottom: 24, left: 24 }),
    maxWidthPx: px(480, 1600).default(880),
    card: FieldStyleSchema.default({}),
    /** The form-wide field default; per-block style overrides it. */
    field: FieldStyleSchema.default({}),
    headingColorToken: FormColorTokenSchema.default('brand-navy-ink'),
    bodyColorToken: FormColorTokenSchema.default('neutral-800'),
    accentColorToken: FormColorTokenSchema.default('brand-blue'),
    /** SDB branding: the logo lock-up and the gradient strip on /register. */
    showLogo: z.boolean().default(true),
    logoPosition: z.enum(['left', 'center']).default('center'),
    logoHeightPx: px(24, 96).default(32),
    showBrandGradientBar: z.boolean().default(true),
  })
  .strict();
export type FormTheme = z.infer<typeof FormThemeSchema>;

/* ── Blocks and forms ───────────────────────────────────────────────────── */

/**
 * `question` blocks carry ONLY a question id. Label, type, options, validation
 * and conditionals resolve from `questions` at render time, so a block can
 * never hold a stale copy of a question — and `question_snapshot` keeps
 * recording what the candidate actually saw.
 */
export const FormBlockTypeSchema = z.enum([
  'question',
  'row',
  'group',
  'heading',
  'paragraph',
  'image',
  'divider',
  'spacer',
]);
export type FormBlockType = z.infer<typeof FormBlockTypeSchema>;

/** Content for non-question blocks only. A question block carries none. */
export const FormBlockPropsSchema = z
  .object({
    text: z.string().max(5000).optional(),
    level: z.number().int().min(1).max(4).optional(),
    storagePath: z.string().max(1000).optional(),
    altText: z.string().max(500).optional(),
  })
  .strict();
export type FormBlockProps = z.infer<typeof FormBlockPropsSchema>;

export const FormBlockSchema = z
  .object({
    id: z.string().uuid(),
    parentBlockId: z.string().uuid().nullable().default(null),
    blockType: FormBlockTypeSchema,
    /** Required for `question` blocks, null for every other type. */
    questionId: z.string().uuid().nullable().default(null),
    pageIndex: z.number().int().min(0).max(50),
    sortOrder: z.number().int().min(0).max(5000),
    layout: BlockLayoutSchema,
    style: BlockStyleSchema.default({}),
    props: FormBlockPropsSchema.default({}),
    /**
     * "Required ON THIS FORM" — form-scoped policy, not question content.
     * null means inherit `questions.is_required`.
     */
    isRequiredOverride: z.boolean().nullable().default(null),
    /**
     * Per-form wording. null = use the library's.
     *
     * These are applied to the resolved question BEFORE validateSubmission, so
     * buildSnapshot records the wording the candidate actually saw. An empty
     * string is a real override (a deliberately blank help line), which is why
     * "unset" is null rather than "".
     */
    labelOverride: z.string().max(300).nullable().default(null),
    placeholderOverride: z.string().max(300).nullable().default(null),
    helpTextOverride: z.string().max(1000).nullable().default(null),
    /**
     * Which of the question's choices this form offers, in this order.
     * null = all of them.
     *
     * A SUBSET, never new values: the values still reference real
     * question_options rows, so an answer given here means the same thing as
     * the same answer on any other form. Adding a genuinely new choice is a
     * change to the question, not to one form.
     */
    optionValueOverrides: z.array(z.string()).max(500).nullable().default(null),
  })
  .strict()
  .refine(
    (block) =>
      block.blockType === 'question'
        ? block.questionId !== null
        : block.questionId === null,
    {
      message: 'questionId is required for question blocks and forbidden otherwise.',
      path: ['questionId'],
    },
  );
export type FormBlock = z.infer<typeof FormBlockSchema>;

/** One step of the form. Steps come from pages, not question categories. */
export const FormPageSchema = z
  .object({
    index: z.number().int().min(0).max(50),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().default(null),
  })
  .strict();
export type FormPage = z.infer<typeof FormPageSchema>;

export const FormStatusSchema = z.enum(['draft', 'active', 'inactive']);
export type FormStatus = z.infer<typeof FormStatusSchema>;

/**
 * Per-form step toggles.
 *
 * There is deliberately NO consent flag. Consent is unconditional: without it a
 * candidate can never be presented to a client (422 CONSENT_MISSING), so it is
 * not form content and there must be nothing here to set wrong.
 */
export const FormStepSettingsSchema = z
  .object({
    hasTypingTest: z.boolean().default(false),
    hasDocumentsStep: z.boolean().default(false),
  })
  .strict();
export type FormStepSettings = z.infer<typeof FormStepSettingsSchema>;

export const CandidateFormSchema = z.object({
  id: z.string().uuid(),
  /** The public link segment. DB-generated, never client-supplied. */
  slug: z.string().min(3).max(64),
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  /** Null only for the seeded default form, which is not role-specific. */
  roleCategoryId: z.string().uuid().nullable(),
  hasTypingTest: z.boolean(),
  hasDocumentsStep: z.boolean(),
  isDefault: z.boolean(),
  status: FormStatusSchema,
  publishedVersionId: z.string().uuid().nullable(),
  activatedAt: z.string().datetime({ offset: true }).nullable(),
  deactivatedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export type CandidateForm = z.infer<typeof CandidateFormSchema>;

/** The whole editable document the builder saves in one PUT. */
export const FormDocumentSchema = z
  .object({
    pages: z.array(FormPageSchema).min(1).max(50),
    theme: FormThemeSchema,
    blocks: z.array(FormBlockSchema).max(500),
  })
  .strict();
export type FormDocument = z.infer<typeof FormDocumentSchema>;

/* ── Submissions ────────────────────────────────────────────────────────── */

export const FormSubmissionSourceSchema = z.enum(['public_form', 'backfill', 'admin']);
export type FormSubmissionSource = z.infer<typeof FormSubmissionSourceSchema>;

/**
 * Resolve a form's public URL. One shared link per form (Haider, 4 Sep) — not
 * a per-candidate token.
 */
export function publicFormPath(slug: string): string {
  return `/f/${slug}`;
}

/** The seeded template keeps the original /register URL working. */
export const DEFAULT_FORM_KEY = 'default_registration';
export const DEFAULT_FORM_PATH = '/register';

export function formPublicPath(form: Pick<CandidateForm, 'slug' | 'isDefault'>): string {
  return form.isDefault ? DEFAULT_FORM_PATH : publicFormPath(form.slug);
}

/* ── Versions ───────────────────────────────────────────────────────────── */

/**
 * A version with `publishedAt === null` is THE draft — the one the builder
 * edits. Activating stamps `publishedAt`; editing an already-active form means
 * creating a new draft that copies the published blocks and theme.
 */
export const CandidateFormVersionSchema = z.object({
  id: z.string().uuid(),
  formId: z.string().uuid(),
  versionNumber: z.number().int().positive(),
  pages: z.array(FormPageSchema),
  theme: FormThemeSchema,
  blocks: z.array(FormBlockSchema),
  createdAt: z.string().datetime({ offset: true }),
  publishedAt: z.string().datetime({ offset: true }).nullable(),
});
export type CandidateFormVersion = z.infer<typeof CandidateFormVersionSchema>;

/**
 * A row in the forms list. The base form plus the three things the table
 * shows — without these the Submissions column renders blank and the public
 * link has nothing to copy.
 */
export const CandidateFormSummarySchema = CandidateFormSchema.extend({
  roleCategory: z
    .object({ id: z.string().uuid(), key: z.string(), label: z.string() })
    .nullable(),
  publicPath: z.string(),
  submissionCount: z.number().int().nonnegative(),
});
export type CandidateFormSummary = z.infer<typeof CandidateFormSummarySchema>;

export const CandidateFormDetailSchema = CandidateFormSummarySchema.extend({
  /** The editable version. Null once published with no newer draft started. */
  draftVersion: CandidateFormVersionSchema.nullable(),
  /** What the public link currently serves. Null until first activation. */
  publishedVersion: CandidateFormVersionSchema.nullable(),
});
export type CandidateFormDetail = z.infer<typeof CandidateFormDetailSchema>;

/* ── Requests ───────────────────────────────────────────────────────────── */

export const CreateCandidateFormBodySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, numbers and underscores.'),
    label: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    roleCategoryId: z.string().uuid().nullable().optional(),
    hasTypingTest: z.boolean().optional(),
    hasDocumentsStep: z.boolean().optional(),
    /**
     * Start from an existing form instead of a blank canvas.
     *
     * The source is COPIED and never modified — its blocks, theme and steps are
     * duplicated into the new form's draft. That is what makes the seeded
     * registration form usable as a starting template while /register keeps
     * serving exactly what it serves today.
     */
    templateFormId: z.string().uuid().optional(),
  })
  .strict();
export type CreateCandidateFormBody = z.infer<typeof CreateCandidateFormBodySchema>;

/**
 * `key` and `slug` are absent on purpose. The key is the stable machine
 * identifier and the slug is the public link already shared with candidates —
 * neither may be edited after creation.
 */
export const UpdateCandidateFormBodySchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    roleCategoryId: z.string().uuid().nullable().optional(),
    hasTypingTest: z.boolean().optional(),
    hasDocumentsStep: z.boolean().optional(),
  })
  .strict();
export type UpdateCandidateFormBody = z.infer<typeof UpdateCandidateFormBodySchema>;

/** Whole-document save from the builder's Save button. */
export const SaveFormDocumentBodySchema = FormDocumentSchema;
export type SaveFormDocumentBody = z.infer<typeof SaveFormDocumentBodySchema>;

/**
 * Single-block patch — the drag/resize endpoint. One row updated, so two
 * admins arranging the same canvas cannot overwrite each other's work.
 */
export const UpdateFormBlockBodySchema = z
  .object({
    layout: BlockLayoutSchema.optional(),
    style: BlockStyleSchema.optional(),
    props: FormBlockPropsSchema.optional(),
    pageIndex: z.number().int().min(0).max(50).optional(),
    sortOrder: z.number().int().min(0).max(5000).optional(),
    isRequiredOverride: z.boolean().nullable().optional(),
    labelOverride: z.string().max(300).nullable().optional(),
    placeholderOverride: z.string().max(300).nullable().optional(),
    helpTextOverride: z.string().max(1000).nullable().optional(),
    optionValueOverrides: z.array(z.string()).max(500).nullable().optional(),
  })
  .strict();
export type UpdateFormBlockBody = z.infer<typeof UpdateFormBlockBodySchema>;

export const CreateFormBlockBodySchema = z
  .object({
    blockType: FormBlockTypeSchema,
    questionId: z.string().uuid().nullable().optional(),
    parentBlockId: z.string().uuid().nullable().optional(),
    pageIndex: z.number().int().min(0).max(50),
    sortOrder: z.number().int().min(0).max(5000),
    layout: BlockLayoutSchema,
    style: BlockStyleSchema.optional(),
    props: FormBlockPropsSchema.optional(),
    isRequiredOverride: z.boolean().nullable().optional(),
    labelOverride: z.string().max(300).nullable().optional(),
    placeholderOverride: z.string().max(300).nullable().optional(),
    helpTextOverride: z.string().max(1000).nullable().optional(),
    optionValueOverrides: z.array(z.string()).max(500).nullable().optional(),
  })
  .strict();
export type CreateFormBlockBody = z.infer<typeof CreateFormBlockBodySchema>;

export const ListCandidateFormsQuerySchema = z
  .object({
    status: FormStatusSchema.optional(),
    roleCategoryId: z.string().uuid().optional(),
    includeArchived: z.coerce.boolean().optional(),
  })
  .strict();
export type ListCandidateFormsQuery = z.infer<typeof ListCandidateFormsQuerySchema>;

/** Activation returns the shareable link, so the builder can offer "Copy". */
export const ActivateFormResultSchema = z.object({
  form: CandidateFormSchema,
  publicPath: z.string(),
});
export type ActivateFormResult = z.infer<typeof ActivateFormResultSchema>;

/* ── Public submission ──────────────────────────────────────────────────── */

/**
 * A submission from a built form's public link.
 *
 * `formVersionId` pins the version the candidate actually saw, so a block
 * removed between fetch and submit does not produce a spurious UNKNOWN_QUESTION
 * for an answer they legitimately gave.
 *
 * Consent is a plain boolean and is always required: it is not form content
 * (see FormStepSettingsSchema), and without it a candidate can never be
 * presented to a client.
 */
export const CandidateFormSubmissionSchema = z
  .object({
    sessionId: z.string().uuid(),
    /**
     * Optional so the legacy /candidate-registrations body — which predates
     * versioning — stays valid unchanged. When present it pins the version the
     * candidate actually saw.
     */
    formVersionId: z.string().uuid().optional(),
    formVersionHash: z.string(),
    answers: z.array(IntakeAnswerSchema).min(1),
    typingAttempts: z.array(TypingAttemptSchema).max(50).default([]),
    files: z.array(RegistrationFileRefSchema).max(10).default([]),
    consentToShareProfile: z.boolean(),
  })
  .strict();
export type CandidateFormSubmission = z.infer<typeof CandidateFormSubmissionSchema>;
