import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // Match Next's automatic JSX runtime so component files (which don't import
  // React) transform correctly under vitest.
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['electron/**/*.ts', 'renderer/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['**/*.d.ts', '**/node_modules/**', '**/dist/**', '**/.next/**'],
    },
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'shared'),
    },
  },
});
