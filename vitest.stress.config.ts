/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Isolated config — stress tests only (do not run src/**/*.test.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test/pdfjs-worker-setup.ts'],
    include: ['scripts/stress/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
