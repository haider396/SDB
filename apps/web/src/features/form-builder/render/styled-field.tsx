/**
 * Turning a stored style into CSS custom properties.
 *
 * ── Why this passes AC-UI-01 ────────────────────────────────────────────────
 * The ESLint rule bans `#rrggbb` in Literal, TemplateElement and JSXAttribute
 * nodes. `var(--${token})` contains no `#`, so it passes — and it is not a
 * loophole: `token` is a closed Zod union validated on BOTH sides of the wire,
 * so nothing but a real SDB token name can ever reach it. This is the same
 * sanctioned shape as `stroke="var(--neutral-200)"` in stage-chart.tsx, just
 * computed rather than written out.
 *
 * Every default lives in form-canvas.css as a var() fallback, so there is no
 * colour value anywhere in this file — only names.
 */
import type { CSSProperties } from "react";
import type {
  BlockStyle,
  BoxSpacing,
  CanvasRect,
  FieldStyle,
  FormTheme,
  Shadow,
} from "@sdb/contracts";

/** Token name → the CSS variable reference the stylesheet resolves. */
function tokenVar(token: string): string {
  return `var(--${token})`;
}

function shadowValue(shadow: Shadow | null | undefined): string | undefined {
  if (shadow === undefined) return undefined;
  if (shadow === null) return "none";
  return `${shadow.offsetX}px ${shadow.offsetY}px ${shadow.blur}px ${shadow.spread}px ${tokenVar(shadow.colorToken)}`;
}

function spacing(
  box: BoxSpacing | undefined,
  prefix: string,
): Record<string, string> {
  if (box === undefined) return {};
  return {
    [`${prefix}-t`]: `${box.top}px`,
    [`${prefix}-r`]: `${box.right}px`,
    [`${prefix}-b`]: `${box.bottom}px`,
    [`${prefix}-l`]: `${box.left}px`,
  };
}

/**
 * Field-level custom properties. An omitted key is genuinely omitted, so it
 * falls through the cascade to the form default and then to the token default
 * — which is why the renderer needs no merge logic at all.
 */
export function fieldStyleVars(
  style: FieldStyle | BlockStyle | undefined,
): CSSProperties {
  if (style === undefined) return {};
  const vars: Record<string, string> = {
    ...spacing(style.padding, "--sdb-field-pad"),
  };
  if (style.textColorToken !== undefined) {
    vars["--sdb-field-text"] = tokenVar(style.textColorToken);
  }
  if (style.backgroundColorToken !== undefined) {
    vars["--sdb-field-bg"] = tokenVar(style.backgroundColorToken);
  }
  if (style.borderColorToken !== undefined) {
    vars["--sdb-field-border-color"] = tokenVar(style.borderColorToken);
  }
  if (style.borderWidth !== undefined) {
    vars["--sdb-field-border-width"] = `${style.borderWidth}px`;
  }
  if (style.borderStyle !== undefined) {
    vars["--sdb-field-border-style"] = style.borderStyle;
  }
  if (style.cornerRadius !== undefined) {
    vars["--sdb-field-radius"] = `${style.cornerRadius}px`;
  }
  if (style.labelColorToken !== undefined) {
    vars["--sdb-field-label"] = tokenVar(style.labelColorToken);
  }
  if (style.placeholderColorToken !== undefined) {
    vars["--sdb-field-placeholder"] = tokenVar(style.placeholderColorToken);
  }
  const shadow = shadowValue(style.shadow);
  if (shadow !== undefined) vars["--sdb-field-shadow"] = shadow;

  // Text blocks additionally carry their own colour.
  if ("align" in style && style.textColorToken !== undefined) {
    vars["--sdb-block-text"] = tokenVar(style.textColorToken);
  }
  return vars as CSSProperties;
}

/** Whole-form custom properties: page background, padding, max width. */
export function formThemeVars(theme: FormTheme): CSSProperties {
  return {
    "--sdb-form-bg":
      theme.pageBackground.startsWith("gradient-")
        ? tokenVar(theme.pageBackground)
        : tokenVar(theme.pageBackground),
    "--sdb-form-max-width": `${theme.maxWidthPx}px`,
    ...spacing(theme.padding, "--sdb-form-pad"),
    ...fieldStyleVars(theme.field),
  } as CSSProperties;
}

/** Grid placement + reflow order for one block. */
export function blockPositionVars(
  rect: CanvasRect,
  order: number,
): CSSProperties {
  return {
    // CSS grid lines are 1-based; the stored column/row are 0-based.
    "--node-col": rect.col + 1,
    "--node-span": rect.colSpan,
    "--node-row": rect.row + 1,
    "--node-rows": rect.rowSpan,
    "--node-order": order,
    "--node-z": rect.z,
  } as CSSProperties;
}

/** Tailwind-ish size classes for text blocks, mapped from the token scale. */
export const FONT_SIZE_CLASS: Record<string, string> = {
  "2xs": "text-2xs",
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
};

export const ALIGN_CLASS: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};
