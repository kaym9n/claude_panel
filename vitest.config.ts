import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)) } },
  define: { __SDK_VERSION__: JSON.stringify('test'), __PLUGIN_VERSION__: JSON.stringify('test') },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/live/**'], environment: 'node' },
});
