import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // Spikes are reference code with their own toolchains (docs/milestones.md); generated files are never linted.
    ignores: ['**/node_modules/**', '**/dist/**', '.ai-work/**', 'spikes/**', '**/generated/**', 'packages/web/src/generated/**', '.pi-console-dev/**'],
  },
  js.configs.recommended,
  {
    files: ['packages/**/*.ts', 'packages/**/*.tsx'],
    extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': ['error', { allowForKnownSafeCalls: [{ from: 'package', package: 'node:test', name: ['test', 'describe', 'it', 'suite', 'before', 'after', 'beforeEach', 'afterEach'] }] }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Specs and the testkit (promoted M0 spike code: JSON fixtures, mock server) are typed for convenience, not production
    // strictness: they handle untyped JSON and assert instead of narrowing. Production packages keep the strict set.
    files: ['**/*.test.ts', '**/*.test.tsx', 'packages/testkit/**/*.ts', 'packages/contract/src/validate.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    // The TUI indexes arrays and tuples freely (rows[cursor] is checked by length) and splits text into code points on purpose.
    files: ['packages/tui/src/**/*.ts'],
    rules: { '@typescript-eslint/no-unnecessary-condition': 'off', '@typescript-eslint/no-misused-spread': 'off' },
  },
  {
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', performance: 'readonly' } },
  },
);
