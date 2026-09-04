/**
 * Candidate Form Builder contracts.
 *
 * The palette tests are the important ones. AC-UI-01's ESLint rule is static
 * and cannot see a colour that arrives from the database at runtime, so this
 * enum is the ONLY thing standing between "SDB palette only" and an admin
 * picking hot pink. Test it like it is load-bearing, because it is.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BlockLayoutSchema,
  CANVAS_COLUMNS,
  CandidateFormSchema,
  CanvasRectSchema,
  DEFAULT_FORM_PATH,
  FORM_COLOR_TOKENS,
  FieldStyleSchema,
  FormBlockSchema,
  FormColorTokenSchema,
  FormDocumentSchema,
  FormStepSettingsSchema,
  FormThemeSchema,
  formPublicPath,
  publicFormPath,
} from './candidate-forms.js';

const UUID = '00000000-0000-4000-8000-000000000001';

function rect(overrides: Record<string, number> = {}) {
  return { col: 0, row: 0, colSpan: 12, rowSpan: 8, z: 0, ...overrides };
}

describe('colour palette', () => {
  it('rejects a raw hex colour', () => {
    expect(FormColorTokenSchema.safeParse('#ff00ff').success).toBe(false);
    expect(FormColorTokenSchema.safeParse('#1E2B67').success).toBe(false);
  });

  it('rejects arbitrary CSS colour syntax', () => {
    for (const value of ['red', 'rgb(255,0,0)', 'hsl(0 100% 50%)', 'var(--brand-navy)']) {
      expect(FormColorTokenSchema.safeParse(value).success).toBe(false);
    }
  });

  it('accepts brand tokens', () => {
    expect(FormColorTokenSchema.safeParse('brand-navy').success).toBe(true);
    expect(FormColorTokenSchema.safeParse('surface-raised').success).toBe(true);
  });

  it('excludes brand-blue-bright — it fails AA as text on white (05 §3.5)', () => {
    expect(FORM_COLOR_TOKENS).not.toContain('brand-blue-bright');
  });

  it('excludes the semantic state tokens, so red keeps meaning "error"', () => {
    for (const token of [
      'danger',
      'danger-text',
      'success',
      'success-text',
      'warning',
      'warning-text',
      'info',
    ]) {
      expect(FORM_COLOR_TOKENS).not.toContain(token);
    }
  });

  it('every token exists in tokens.css, so var(--token) can never dangle', () => {
    // The renderer emits `var(--${token})` with no transformation. If this
    // list and the stylesheet drift, forms render with no colour at all.
    const css = readFileSync(
      new URL('../../../apps/web/src/styles/tokens.css', import.meta.url),
      'utf8',
    );
    const declared = new Set(
      [...css.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((match) => match[1]),
    );
    const missing = FORM_COLOR_TOKENS.filter(
      (token) => token !== 'transparent' && !declared.has(`--${token}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('canvas geometry is bounded', () => {
  it('rejects a block wider than the canvas', () => {
    expect(CanvasRectSchema.safeParse(rect({ colSpan: 40 })).success).toBe(false);
  });

  it('rejects a block that overflows the right edge', () => {
    // Fits on its own, but col 20 + span 12 runs past column 24.
    expect(CanvasRectSchema.safeParse(rect({ col: 20, colSpan: 12 })).success).toBe(
      false,
    );
    expect(CanvasRectSchema.safeParse(rect({ col: 12, colSpan: 12 })).success).toBe(
      true,
    );
  });

  it('rejects an absurd size — a free canvas is not a licence to crash the page', () => {
    expect(CanvasRectSchema.safeParse(rect({ rowSpan: 900_000 })).success).toBe(false);
  });

  it('rejects a field too small to use', () => {
    expect(CanvasRectSchema.safeParse(rect({ colSpan: 1 })).success).toBe(false);
    expect(CanvasRectSchema.safeParse(rect({ rowSpan: 1 })).success).toBe(false);
  });

  it('defaults the mobile arrangement to auto-stack', () => {
    const parsed = BlockLayoutSchema.parse({ desktop: rect() });
    expect(parsed.mobile).toBeNull();
  });

  it('keeps a hand-arranged mobile rectangle', () => {
    const parsed = BlockLayoutSchema.parse({
      desktop: rect({ col: 12, colSpan: 12 }),
      mobile: rect({ col: 0, colSpan: 24 }),
    });
    expect(parsed.mobile?.colSpan).toBe(CANVAS_COLUMNS);
  });
});

describe('field style', () => {
  it('accepts the full set of controls', () => {
    const parsed = FieldStyleSchema.parse({
      textColorToken: 'neutral-900',
      backgroundColorToken: 'surface-raised',
      borderColorToken: 'border-default',
      borderWidth: 2,
      borderStyle: 'dashed',
      cornerRadius: 12,
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      shadow: {
        colorToken: 'neutral-300',
        offsetX: 0,
        offsetY: 2,
        blur: 6,
        spread: 0,
      },
    });
    expect(parsed.borderStyle).toBe('dashed');
  });

  it('rejects an unknown property rather than ignoring it', () => {
    expect(
      FieldStyleSchema.safeParse({ textColour: 'neutral-900' }).success,
    ).toBe(false);
  });

  it('distinguishes "no shadow" from "inherit"', () => {
    expect(FieldStyleSchema.parse({ shadow: null }).shadow).toBeNull();
    expect('shadow' in FieldStyleSchema.parse({})).toBe(false);
  });

  it('rejects a hex anywhere in the style', () => {
    expect(
      FieldStyleSchema.safeParse({ backgroundColorToken: '#ffffff' }).success,
    ).toBe(false);
  });
});

describe('form theme', () => {
  it('defaults to the SDB look with branding on', () => {
    const theme = FormThemeSchema.parse({});
    expect(theme.pageBackground).toBe('surface-page');
    expect(theme.headingColorToken).toBe('brand-navy-ink');
    expect(theme.showLogo).toBe(true);
    expect(theme.showBrandGradientBar).toBe(true);
  });

  it('allows a gradient as a background but not as a text colour', () => {
    expect(FormThemeSchema.safeParse({ pageBackground: 'gradient-brand' }).success).toBe(
      true,
    );
    expect(
      FormThemeSchema.safeParse({ headingColorToken: 'gradient-brand' }).success,
    ).toBe(false);
  });
});

describe('blocks', () => {
  const base = {
    id: UUID,
    blockType: 'question' as const,
    questionId: UUID,
    pageIndex: 0,
    sortOrder: 1,
    layout: { desktop: rect() },
  };

  it('requires a questionId on a question block', () => {
    expect(FormBlockSchema.safeParse({ ...base, questionId: null }).success).toBe(false);
  });

  it('forbids a questionId on a heading block', () => {
    expect(
      FormBlockSchema.safeParse({ ...base, blockType: 'heading', questionId: UUID })
        .success,
    ).toBe(false);
    expect(
      FormBlockSchema.safeParse({ ...base, blockType: 'heading', questionId: null })
        .success,
    ).toBe(true);
  });

  it('inherits the question’s required flag unless overridden', () => {
    expect(FormBlockSchema.parse(base).isRequiredOverride).toBeNull();
    expect(
      FormBlockSchema.parse({ ...base, isRequiredOverride: true }).isRequiredOverride,
    ).toBe(true);
  });
});

describe('step settings', () => {
  it('has no consent flag — consent is unconditional', () => {
    const parsed = FormStepSettingsSchema.parse({});
    expect(Object.keys(parsed).sort()).toEqual(['hasDocumentsStep', 'hasTypingTest']);
  });

  it('refuses to accept a consent toggle even if one is sent', () => {
    expect(
      FormStepSettingsSchema.safeParse({ hasConsentStep: false }).success,
    ).toBe(false);
  });
});

describe('public links', () => {
  it('builds a shared link from the slug', () => {
    expect(publicFormPath('a1b2c3d4e5f6')).toBe('/f/a1b2c3d4e5f6');
  });

  it('keeps the default form on the original /register URL', () => {
    expect(formPublicPath({ slug: 'a1b2c3d4e5f6', isDefault: true })).toBe(
      DEFAULT_FORM_PATH,
    );
    expect(formPublicPath({ slug: 'a1b2c3d4e5f6', isDefault: false })).toBe(
      '/f/a1b2c3d4e5f6',
    );
  });
});

describe('form document', () => {
  it('round-trips a minimal document', () => {
    const parsed = FormDocumentSchema.parse({
      pages: [{ index: 0, title: 'About you' }],
      theme: FormThemeSchema.parse({}),
      blocks: [
        {
          id: UUID,
          blockType: 'question',
          questionId: UUID,
          pageIndex: 0,
          sortOrder: 1,
          layout: { desktop: rect() },
        },
      ],
    });
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.pages[0]?.description).toBeNull();
  });

  it('requires at least one page', () => {
    expect(
      FormDocumentSchema.safeParse({
        pages: [],
        theme: FormThemeSchema.parse({}),
        blocks: [],
      }).success,
    ).toBe(false);
  });
});

describe('candidate form', () => {
  it('allows a null role category only as a shape — the DB enforces the rule', () => {
    const form = CandidateFormSchema.parse({
      id: UUID,
      slug: 'a1b2c3d4e5f6',
      key: 'default_registration',
      label: 'Candidate registration',
      description: null,
      roleCategoryId: null,
      hasTypingTest: true,
      hasDocumentsStep: true,
      isDefault: true,
      status: 'active',
      publishedVersionId: UUID,
      activatedAt: '2026-09-04T00:00:00.000Z',
      deactivatedAt: null,
      createdAt: '2026-09-04T00:00:00.000Z',
      updatedAt: '2026-09-04T00:00:00.000Z',
      archivedAt: null,
    });
    expect(form.isDefault).toBe(true);
  });
});
