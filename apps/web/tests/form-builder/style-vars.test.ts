/**
 * Per-form styling → CSS custom properties.
 *
 * The important assertion is the last one: NO hex ever appears in a rendered
 * style. AC-UI-01's ESLint rule is static and cannot see a colour that arrives
 * from the database, so this is the runtime net that backs the closed
 * FormColorTokenSchema enum.
 */
import { describe, expect, it } from "vitest";
import {
  blockPositionVars,
  fieldStyleVars,
  formThemeVars,
} from "@/features/form-builder/render/styled-field";

const HEX = /#[0-9a-fA-F]{3,8}\b/;

describe("field style variables", () => {
  it("emits var() references, never colour values", () => {
    const vars = fieldStyleVars({
      textColorToken: "brand-navy",
      backgroundColorToken: "surface-raised",
      borderColorToken: "border-default",
    }) as Record<string, string>;

    expect(vars["--sdb-field-text"]).toBe("var(--brand-navy)");
    expect(vars["--sdb-field-bg"]).toBe("var(--surface-raised)");
    expect(vars["--sdb-field-border-color"]).toBe("var(--border-default)");
  });

  it("omits anything unset, so the cascade supplies the default", () => {
    const vars = fieldStyleVars({ borderWidth: 2 }) as Record<string, string>;
    expect(vars["--sdb-field-border-width"]).toBe("2px");
    // Absent, not empty: an empty value would override the fallback chain.
    expect("--sdb-field-text" in vars).toBe(false);
    expect("--sdb-field-bg" in vars).toBe(false);
  });

  it("distinguishes an explicit 'no shadow' from 'inherit'", () => {
    const none = fieldStyleVars({ shadow: null }) as Record<string, string>;
    expect(none["--sdb-field-shadow"]).toBe("none");

    const inherited = fieldStyleVars({}) as Record<string, string>;
    expect("--sdb-field-shadow" in inherited).toBe(false);
  });

  it("composes a full shadow from its parts", () => {
    const vars = fieldStyleVars({
      shadow: {
        colorToken: "neutral-300",
        offsetX: 1,
        offsetY: 2,
        blur: 6,
        spread: -1,
      },
    }) as Record<string, string>;
    expect(vars["--sdb-field-shadow"]).toBe("1px 2px 6px -1px var(--neutral-300)");
  });

  it("expands padding into four sides", () => {
    const vars = fieldStyleVars({
      padding: { top: 1, right: 2, bottom: 3, left: 4 },
    }) as Record<string, string>;
    expect(vars["--sdb-field-pad-t"]).toBe("1px");
    expect(vars["--sdb-field-pad-r"]).toBe("2px");
    expect(vars["--sdb-field-pad-b"]).toBe("3px");
    expect(vars["--sdb-field-pad-l"]).toBe("4px");
  });

  it("returns nothing for an unstyled block", () => {
    expect(fieldStyleVars(undefined)).toEqual({});
  });
});

describe("theme variables", () => {
  const theme = {
    pageBackground: "surface-page" as const,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    maxWidthPx: 880,
    card: {},
    field: { textColorToken: "neutral-900" as const },
    headingColorToken: "brand-navy-ink" as const,
    bodyColorToken: "neutral-800" as const,
    accentColorToken: "brand-blue" as const,
    showLogo: true,
    logoPosition: "center" as const,
    logoHeightPx: 32,
    showBrandGradientBar: true,
  };

  it("carries the page background, width and padding", () => {
    const vars = formThemeVars(theme) as Record<string, string>;
    expect(vars["--sdb-form-bg"]).toBe("var(--surface-page)");
    expect(vars["--sdb-form-max-width"]).toBe("880px");
    expect(vars["--sdb-form-pad-t"]).toBe("24px");
  });

  it("folds the form-wide field default in", () => {
    const vars = formThemeVars(theme) as Record<string, string>;
    expect(vars["--sdb-field-text"]).toBe("var(--neutral-900)");
  });
});

describe("block position", () => {
  it("converts 0-based storage to 1-based CSS grid lines", () => {
    const vars = blockPositionVars(
      { col: 0, row: 0, colSpan: 12, rowSpan: 8, z: 3 },
      5,
    ) as Record<string, number>;
    expect(vars["--node-col"]).toBe(1);
    expect(vars["--node-row"]).toBe(1);
    expect(vars["--node-span"]).toBe(12);
    expect(vars["--node-order"]).toBe(5);
    expect(vars["--node-z"]).toBe(3);
  });
});

describe("AC-UI-01 runtime net", () => {
  it("produces no hex anywhere, for any styling an admin can choose", () => {
    const everything = fieldStyleVars({
      textColorToken: "brand-navy",
      backgroundColorToken: "gradient-brand",
      borderColorToken: "neutral-300",
      borderWidth: 3,
      borderStyle: "dashed",
      cornerRadius: 12,
      padding: { top: 8, right: 8, bottom: 8, left: 8 },
      shadow: { colorToken: "brand-navy", offsetX: 0, offsetY: 4, blur: 8, spread: 0 },
      labelColorToken: "neutral-700",
      placeholderColorToken: "neutral-400",
    }) as Record<string, string>;

    for (const value of Object.values(everything)) {
      expect(String(value)).not.toMatch(HEX);
    }
  });
});
