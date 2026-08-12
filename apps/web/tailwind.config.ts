import type { Config } from "tailwindcss";

/**
 * Every value below maps to a CSS custom property defined in
 * src/styles/tokens.css — the ONLY file permitted to contain colour
 * literals (05-FRONTEND.md §3.4/§3.5, AC-UI-01).
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      "brand-navy": "var(--brand-navy)",
      "brand-navy-deep": "var(--brand-navy-deep)",
      "brand-navy-ink": "var(--brand-navy-ink)",
      "brand-blue": "var(--brand-blue)",
      "brand-blue-bright": "var(--brand-blue-bright)",
      "brand-slate": "var(--brand-slate)",
      "brand-teal": "var(--brand-teal)",
      "brand-teal-bright": "var(--brand-teal-bright)",
      "brand-on-dark": "var(--brand-on-dark)",
      "brand-navy-hover": "var(--brand-navy-hover)",
      "brand-blue-hover": "var(--brand-blue-hover)",
      "brand-navy-subtle": "var(--brand-navy-subtle)",
      "brand-blue-subtle": "var(--brand-blue-subtle)",
      "surface-page": "var(--surface-page)",
      "surface-raised": "var(--surface-raised)",
      "surface-subtle": "var(--surface-subtle)",
      "surface-inverse": "var(--surface-inverse)",
      "border-default": "var(--border-default)",
      neutral: {
        50: "var(--neutral-50)",
        100: "var(--neutral-100)",
        200: "var(--neutral-200)",
        300: "var(--neutral-300)",
        400: "var(--neutral-400)",
        500: "var(--neutral-500)",
        600: "var(--neutral-600)",
        700: "var(--neutral-700)",
        800: "var(--neutral-800)",
        900: "var(--neutral-900)",
      },
      success: {
        DEFAULT: "var(--success)",
        text: "var(--success-text)",
        subtle: "var(--success-subtle)",
      },
      warning: {
        DEFAULT: "var(--warning)",
        text: "var(--warning-text)",
        subtle: "var(--warning-subtle)",
      },
      danger: {
        DEFAULT: "var(--danger)",
        text: "var(--danger-text)",
        subtle: "var(--danger-subtle)",
      },
      info: {
        DEFAULT: "var(--info)",
        subtle: "var(--info-subtle)",
      },
    },
    fontFamily: {
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    fontSize: {
      xs: ["var(--text-xs)", { lineHeight: "var(--leading-normal)" }],
      sm: ["var(--text-sm)", { lineHeight: "var(--leading-normal)" }],
      base: ["var(--text-base)", { lineHeight: "var(--leading-normal)" }],
      lg: ["var(--text-lg)", { lineHeight: "var(--leading-tight)" }],
      xl: ["var(--text-xl)", { lineHeight: "var(--leading-tight)" }],
      "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-tight)" }],
      "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-tight)" }],
      "4xl": ["var(--text-4xl)", { lineHeight: "var(--leading-tight)" }],
    },
    lineHeight: {
      tight: "var(--leading-tight)",
      normal: "var(--leading-normal)",
      relaxed: "var(--leading-relaxed)",
    },
    letterSpacing: {
      tight: "var(--tracking-tight)",
      normal: "0",
    },
    borderRadius: {
      none: "0",
      sm: "var(--radius-sm)",
      DEFAULT: "var(--radius-md)",
      md: "var(--radius-md)",
      lg: "var(--radius-lg)",
      xl: "var(--radius-xl)",
      full: "9999px",
    },
    boxShadow: {
      none: "none",
      xs: "var(--shadow-xs)",
      sm: "var(--shadow-sm)",
      DEFAULT: "var(--shadow-sm)",
      md: "var(--shadow-md)",
      lg: "var(--shadow-lg)",
    },
    transitionTimingFunction: {
      out: "var(--ease-out)",
    },
    transitionDuration: {
      fast: "var(--duration-fast)",
      base: "var(--duration-base)",
      slow: "var(--duration-slow)",
      DEFAULT: "var(--duration-base)",
    },
    extend: {
      spacing: {
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        10: "var(--space-10)",
        12: "var(--space-12)",
        16: "var(--space-16)",
      },
      backgroundImage: {
        "gradient-brand": "var(--gradient-brand)",
        "gradient-progress": "var(--gradient-progress)",
      },
      maxWidth: {
        content: "1440px",
      },
      width: {
        "sidebar-expanded": "264px",
        "sidebar-collapsed": "64px",
      },
    },
  },
  plugins: [],
};

export default config;
