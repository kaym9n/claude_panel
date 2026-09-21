// 가짜 obsidian 모듈로 main.js를 Node에서 require해 최상위 로드 오류(ESM 구문, import.meta 등)를 잡는다.
const Module = require('node:module');
const path = require('node:path');

const obsidianStub = new Proxy({}, { get: (_t, key) => (key === '__esModule' ? false : class {}) });
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'obsidian') return obsidianStub;
  return originalLoad.call(this, request, parent, isMain);
};

const mod = require(path.resolve(__dirname, '..', 'main.js'));
const PluginClass = mod.default ?? mod;
if (typeof PluginClass !== 'function') {
  console.error('smoke-load: main.js가 플러그인 클래스를 내보내지 않음');
  process.exit(1);
}
console.log('smoke-load: OK');
