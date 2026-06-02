import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import react from 'eslint-plugin-react';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  globalThis: 'readonly',
  AbortController: 'readonly',
  AbortSignal: 'readonly',
  NodeJS: 'readonly',
  ResizeObserver: 'readonly',
  Electron: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  MouseEvent: 'readonly',
};

const domGlobals = {
  window: 'readonly',
  document: 'readonly',
  HTMLDivElement: 'readonly',
  HTMLElement: 'readonly',
  HTMLInputElement: 'readonly',
  HTMLTextAreaElement: 'readonly',
  HTMLButtonElement: 'readonly',
  HTMLButtonAttributes: 'readonly',
  KeyboardEvent: 'readonly',
  globalThis: 'readonly',
  ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly',
  Notification: 'readonly',
  React: 'readonly',
  fetch: 'readonly',
  kbd: 'readonly',
  getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      '.next/**',
      'renderer/out/**',
      'renderer/.next/**',
      'renderer/next-env.d.ts', // Next.js-generated, do not lint
      'coverage/**',
      'release/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...nodeGlobals, module: 'readonly', require: 'readonly', exports: 'writable' },
    },
  },
  {
    // Electron main + shared + tests (node env)
    files: ['electron/**/*.ts', 'shared/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      globals: nodeGlobals,
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
    },
  },
  {
    // Renderer (browser env)
    files: ['renderer/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: { ...nodeGlobals, ...domGlobals },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-unused-vars': 'off',
      'react/jsx-uses-react': 'off',
      'react/react-in-jsx-scope': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
];
