import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import eslintConfigPrettier from 'eslint-config-prettier'

export default defineConfig([
  // vendor/ is the OS's kit, byte for byte: never linted or rewritten here.
  globalIgnores(['dist', 'vendor', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      eslintConfigPrettier,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@imbatranim/core', '@imbatranim/core/*'],
              message:
                "The desktop's own package. An app reaches the OS through useSystem() and the kit, never core.",
            },
            {
              group: ['@imbatranim/ui/*'],
              message: 'The kit is lent as one module: import from "@imbatranim/ui".',
            },
          ],
        },
      ],
    },
  },
  {
    // Build code and scripts run in Node.
    files: ['packages/shared/src/build/**', 'tools/**', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Test helpers and tests export what they like.
    files: ['**/*.test.{ts,tsx}', 'packages/shared/src/testing/**', 'packages/shared/test/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
