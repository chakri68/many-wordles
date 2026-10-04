/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // any static host, any sub-path
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node', setupFiles: ['src/test/setup.ts'] },
});
