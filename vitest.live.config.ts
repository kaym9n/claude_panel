import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __SDK_VERSION__: JSON.stringify('live'), __PLUGIN_VERSION__: JSON.stringify('live') },
  test: {
    include: ['tests/live/**/*.live.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
