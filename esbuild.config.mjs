import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';
const sdkVersion = JSON.parse(readFileSync('node_modules/@anthropic-ai/claude-agent-sdk/package.json', 'utf8')).version;
const pluginVersion = JSON.parse(readFileSync('manifest.json', 'utf8')).version;

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2022',
  inject: ['src/util/nodeAbortController.ts'],
  outfile: 'main.js',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
  // SDK는 ESM 전용이고 최상위에서 createRequire(import.meta.url)를 호출한다.
  // CJS 번들에서는 import.meta가 비므로 main.js 파일 URL로 치환한다.
  define: {
    'import.meta.url': '__cpImportMetaUrl',
    __SDK_VERSION__: JSON.stringify(sdkVersion),
    __PLUGIN_VERSION__: JSON.stringify(pluginVersion),
  },
  banner: {
    js: "var __cpImportMetaUrl = require('url').pathToFileURL(typeof __filename === 'string' ? __filename : require('path').join(process.cwd(), 'main.js')).href;",
  },
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
