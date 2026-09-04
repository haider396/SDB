import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * AC-UI-01 — no raw hex colours in components. The only file allowed to
 * contain colour literals is src/styles/tokens.css (05-FRONTEND.md §3.4).
 */
const HEX_COLOUR = "#[0-9a-fA-F]{3,8}\\b";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    /**
     * Public routes are EAGER by deliberate design (router.tsx) so that
     * dnd-kit, TanStack Table and Recharts never reach the entry chunk. A
     * free-canvas builder is the single most likely thing to break that, so
     * the boundary is mechanical rather than a matter of discipline.
     *
     * render/ may be imported by public pages; builder/ may import render/;
     * render/ may never import builder/.
     */
    files: [
      "src/features/form-builder/render/**",
      "src/routes/public/**",
      "src/features/intake-form/**",
      "src/features/candidate-registration/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dnd-kit/*"],
              message:
                "dnd-kit must never reach the public entry chunk (router.tsx code-splitting note).",
            },
            {
              group: ["@tanstack/react-table"],
              message: "TanStack Table must never reach the public entry chunk.",
            },
            {
              group: ["recharts"],
              message: "Recharts must never reach the public entry chunk.",
            },
            {
              group: ["**/form-builder/builder/**"],
              message:
                "render/ must not import builder/. The dependency is one-way.",
            },
          ],
        },
      ],
    },
  },
  {
    // AC-UI-01: hex colour literals banned in all source except src/styles/
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/styles/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `Literal[value=/${HEX_COLOUR}/]`,
          message:
            "Raw hex colours are banned in components (AC-UI-01). Use a token from src/styles/tokens.css via its Tailwind utility.",
        },
        {
          selector: `TemplateElement[value.raw=/${HEX_COLOUR}/]`,
          message:
            "Raw hex colours are banned in components (AC-UI-01). Use a token from src/styles/tokens.css via its Tailwind utility.",
        },
        {
          selector: `JSXAttribute[value.value=/${HEX_COLOUR}/]`,
          message:
            "Raw hex colours are banned in components (AC-UI-01). Use a token from src/styles/tokens.css via its Tailwind utility.",
        },
      ],
    },
  },
);
