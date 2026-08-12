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
