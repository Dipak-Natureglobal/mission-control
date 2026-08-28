import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          // Allow renamed destructured params and generic catch-ignore
          // patterns: `function Foo({ icon: Icon, ... })` is a substrate
          // idiom (Confirm.Section, VinValidate.MismatchCard, etc).
          argsIgnorePattern: '^(_|[A-Z])',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // vite.config.js runs in Node, not the browser. Without this block
    // it trips no-undef on __dirname.
    files: ['vite.config.{js,jsx}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
