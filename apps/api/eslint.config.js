// Flat ESLint config for @sdb/api.
// Enforces the strict layering from docs/06-BACKEND.md §2:
//   routes/ → services/ → repositories/ → lib/db
// A layer may only import from the layer below it. Violations fail the build.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Routes: HTTP concerns only. No SQL, no repository access.
    files: ['src/routes/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/repositories/*', '**/repositories'],
              message:
                'Routes may not import repositories. Delegate to a service (docs/06-BACKEND.md §2).',
            },
          ],
        },
      ],
    },
  },
  {
    // Repositories: all SQL, no business logic, no upward imports.
    files: ['src/repositories/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/services/*',
                '**/services',
                '**/routes/*',
                '**/routes',
                '**/middleware/*',
                '**/middleware',
              ],
              message:
                'Repositories may not import services, routes, or middleware (docs/06-BACKEND.md §2).',
            },
          ],
        },
      ],
    },
  },
  {
    // Services: business rules only. No HTTP types, no route imports.
    files: ['src/services/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/routes/*', '**/routes', 'fastify'],
              message:
                'Services must stay HTTP-free: no route imports, no Fastify types (docs/06-BACKEND.md §2).',
            },
          ],
        },
      ],
    },
  },
);
