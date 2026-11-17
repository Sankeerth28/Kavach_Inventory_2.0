import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    // Integration tests share one throwaway PostgreSQL database (test/global-setup.ts).
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  // SWC emits the decorator metadata that Nest's dependency injection relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
