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
    // The PDF engine, moved from the OS (brief 06) with the lint settings it
    // had there: it spans the browser (render, text layer) and Node (its
    // tests), and its one `@ts-ignore` (pdf.js's untyped legacy build) says why.
    files: ['packages/pdfcore-engine/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
    },
  },
  {
    // Nothing in a browser bundle may reach the engine's Node entry (it binds
    // pdf.js to @napi-rs/canvas, a native module).
    files: ['apps/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@pdfcore/engine/node', '@pdfcore/engine/src/*'],
              message:
                "The engine's Node entry and its internals stay out of the browser build: import '@pdfcore/engine' (types) or load it as app/engine.ts does.",
            },
          ],
        },
      ],
    },
  },
  {
    // PDF's first page (brief 06): every module on the way to it imports only
    // types from the engine and pdf.js, and none of the chunks that load after
    // it. lazy.ts and app/engine.ts reach those with dynamic imports.
    files: ['apps/pdf/src/**/*.{ts,tsx}'],
    ignores: [
      'apps/pdf/src/**/*.test.{ts,tsx}',
      'apps/pdf/src/app/engineModule.ts',
      'apps/pdf/src/panels/**',
      'apps/pdf/src/forms/**',
      'apps/pdf/src/organize/**',
      'apps/pdf/src/editor/AnnotateToolbar.tsx',
      'apps/pdf/src/editor/PageAnnotateLayer.tsx',
      'apps/pdf/src/editor/SignatureDialog.tsx',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@pdfcore/engine',
              allowTypeImports: true,
              message:
                'The engine (pdf-lib) loads after the first page: type imports only here; values come from app/engine.ts.',
            },
            {
              name: '@pdfcore/engine/browser',
              allowTypeImports: true,
              message:
                'The engine (pdf-lib) loads after the first page: type imports only here; values come from app/engine.ts.',
            },
            {
              name: 'pdfjs-dist',
              allowTypeImports: true,
              message: 'pdf.js is a dynamic import (reader/pdfjs.ts): type imports only here.',
            },
          ],
          patterns: [
            {
              group: ['@pdfcore/engine/node', '@pdfcore/engine/src/*'],
              message: "The engine's Node entry and its internals stay out of the browser build.",
            },
            {
              group: [
                '**/panels/*',
                '**/forms/*',
                '**/organize/*',
                '**/editor/AnnotateToolbar',
                '**/editor/PageAnnotateLayer',
                '**/editor/SignatureDialog',
                '**/app/engineModule',
              ],
              allowTypeImports: true,
              message: 'Loaded after the first page: reach it through lazy.ts (or app/engine.ts).',
            },
          ],
        },
      ],
    },
  },
  {
    // Test helpers and tests export what they like.
    files: ['**/*.test.{ts,tsx}', 'packages/shared/src/testing/**', 'packages/shared/test/**'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
