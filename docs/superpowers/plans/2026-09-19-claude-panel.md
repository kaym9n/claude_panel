# Claude Panel 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obsidian 사이드바에서 로컬 Claude Code를 그대로 감싸 대화·승인·스레드 관리·선택 영역 고쳐쓰기를 제공하는 개인용 플러그인 1차 버전을 만든다.

**Architecture:** `@anthropic-ai/claude-agent-sdk`의 `query()`를 스트리밍 입력 모드로 열어 로컬 `claude` 실행 파일을 구동한다. SDK 메시지는 `Normalizer`가 패널 이벤트로 바꾸고, `ChatState`가 이를 화면 항목으로 접으며, UI는 Obsidian DOM API로 그 항목만 다시 그린다. SDK·CLI에 닿는 코드(`ClaudeSession`, `ThreadService`, `oneShot`)는 SDK 함수를 주입받아 실제 CLI 없이 테스트한다.

**Tech Stack:** TypeScript 5.9, Obsidian API 1.13, Claude Agent SDK 0.3.278, esbuild 0.28 (CJS 번들), vitest 3.2 + vite 6, jsdiff 9

**Spec:** `docs/superpowers/specs/2026-09-18-claude-panel-design.md`

## Global Constraints

- 개발 위치는 `~/tools/claude-panel`. vault(`.obsidian/plugins/claude-panel/`)에는 `main.js`·`manifest.json`·`styles.css`만 심볼릭 링크한다.
- `@anthropic-ai/claude-agent-sdk`는 `0.3.278`로 고정한다 (`--save-exact`).
- 채팅 세션: `systemPrompt: { type: 'preset', preset: 'claude_code' }`, `settingSources: ['user', 'project', 'local']`, `includePartialMessages: true`. `permissionMode`는 패널에서 바꾼 경우에만, `model`은 패널에서 바꾸거나 기본 모델 설정이 있을 때만 전달한다. hook 사용 off일 때만 `settings: { disableAllHooks: true }`.
- 1회성 호출(연결 테스트·제목 생성·고쳐쓰기): `tools: []`, `persistSession: false`, `settingSources: []`, `maxTurns: 1`.
- `pathToClaudeCodeExecutable`에는 항상 **절대 경로**를 넘긴다 (SDK가 `Claude Code executable not found at …`로 존재 여부를 검사한다).
- 패널 코드에 vault 특화 로직을 넣지 않는다 (Boxx·Personal 어디에나 설치하는 범용 패널).
- UI는 프레임워크 없이 Obsidian DOM API(`createEl`·`createDiv`) + `MarkdownRenderer.render`만 쓴다. UI 문구는 한국어.
- 번들: esbuild `format: 'cjs'` 단일 `main.js`. SDK가 최상위에서 `createRequire(import.meta.url)`를 호출하므로 `import.meta.url`을 define+banner로 치환한다. **`package.json`에 `"type": "module"`을 넣지 않는다** (넣으면 Node가 `main.js`를 ESM으로 읽어 로드 검사가 깨진다).
- `manifest.json`: `id: claude-panel`, `isDesktopOnly: true`.
- 입력창 Enter 처리는 반드시 `evt.isComposing`을 먼저 검사한다 (한글 IME 조합 중 Enter는 글자 확정용).
- Node 20.18 환경이므로 vite 7(Node 20.19+ 필요)을 쓰지 않는다: `vitest@3.2.7` + `vite@6.4.3` 고정.
- 매 커밋 전 `npm test && npm run build`가 통과해야 한다. 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` 줄을 붙인다.
- `[사용자 확인]` 표시된 단계는 Obsidian에서 사람이 직접 확인해야 한다. 에이전트는 그 지점에서 멈추고 확인 요청을 남긴다.

## 사전 검증 결과 (2026-09-19, 계획 작성 중 확인)

- SDK 0.3.278은 ESM 전용(`sdk.mjs`, 런타임 의존성은 Node 내장 모듈뿐). 위 esbuild 설정으로 CJS 번들 → `node -e "require('./main.js')"` 로드 → `query()` 1회 호출(`pong`)까지 Node에서 성공. Obsidian(Electron) 렌더러에서의 로드는 Task 2에서 확인한다.
- 스펙이 쓰는 API는 모두 존재: `listSessions`, `getSessionMessages`, `getSessionInfo`, `forkSession`, `renameSession`, `Query.getContextUsage/setModel/setPermissionMode/applyFlagSettings/interrupt/supportedCommands/supportedModels/close`. 추론 강도는 시작 시 `options.effort`, 세션 중 `applyFlagSettings({ effortLevel })`.
- 실제 스트림(`claude -p … --output-format stream-json --include-partial-messages --verbose`): CLI는 **content block 하나마다 `assistant` 메시지를 하나씩** 보내며, 같은 `message.id`를 공유하고 도착 순서가 `stream_event`의 `index`와 같다. `Normalizer`는 이 성질로 스트리밍 블록과 완성 블록을 `${message.id}#${index}` 키로 맞춘다.
- `~/.local/bin/claude`는 네이티브 ELF 실행 파일(2.1.278)의 심볼릭 링크.

## 스펙 대비 구조 보완

스펙 3장의 구조를 따르되, 테스트 가능성과 파일 크기를 위해 아래를 추가·조정한다.

| 추가/조정 | 이유 |
|---|---|
| `src/types.ts` | 패널 이벤트·승인 요청 타입을 한곳에 둔다 |
| `src/chat/ChatState.ts` | 이벤트 → 화면 항목 상태 변환을 DOM과 분리해 단위 테스트한다 |
| `src/session/InputQueue.ts`, `buildOptions.ts`, `oneShot.ts` | 스트리밍 입력 큐, `query` 옵션 조립(순수 함수), 1회성 호출 공용화 |
| `ApprovalBroker`를 `ClaudeSession`이 소유 | 중단·종료 시 대기 승인 일괄 거부, Plan 승인 후 모드 복귀를 세션 안에서 처리 |
| `src/context/ActiveNoteTracker.ts` | 사이드바에 포커스가 가도 마지막 마크다운 편집기를 기억해야 선택 영역을 읽을 수 있다 |
| `src/ui/Toolbar.ts`, `SlashPopup.ts`, `toolFormat.ts`, `format.ts`, `TextPromptModal.ts`, `RewriteModal.ts` | UI 파일을 책임별로 분리 |
| `src/util/claudePath.ts`, `src/diagnostics.ts` | PATH 보강·절대 경로 해석, 진단 정보 |

동작 결정(스펙에 명시 없던 부분):
- `/`로 시작하는 메시지에는 컨텍스트를 붙이지 않는다 (CLI가 맨 앞의 `/명령`만 명령으로 해석하므로).
- 선택 영역은 한 번 보내면 같은 선택을 다음 메시지에 다시 붙이지 않는다.
- `/` 자동완성 목록을 얻기 위해 입력창 맨 앞에 `/`를 치는 순간 세션을 시작한다 (첫 전송 전이라도).

## 파일 구조

```
~/tools/claude-panel/
├─ package.json · tsconfig.json · esbuild.config.mjs · vitest.config.ts · vitest.live.config.ts
├─ manifest.json · styles.css · .gitignore
├─ scripts/
│  ├─ check-bundle.mjs       번들에 import.meta가 남았는지 검사
│  ├─ smoke-load.cjs         가짜 obsidian 모듈로 main.js를 Node에서 require
│  ├─ record-fixture.sh      실제 CLI 스트림 녹화 → tests/fixtures
│  └─ link-vault.sh          빌드 결과를 vault 플러그인 폴더에 심볼릭 링크
├─ src/
│  ├─ main.ts                플러그인 진입점: 뷰·명령·설정 탭, 세션 설정 조립
│  ├─ settings.ts            설정 정의·설정 탭
│  ├─ types.ts               PanelEvent, ApprovalRequest, TurnUsage
│  ├─ globals.d.ts           __SDK_VERSION__, __PLUGIN_VERSION__
│  ├─ diagnostics.ts         최근 오류·stderr 보관, 진단 보고서
│  ├─ util/claudePath.ts     PATH 보강, 절대 경로 해석, 로그인 셸 탐색, env 조립
│  ├─ session/
│  │  ├─ oneShot.ts          1회성 호출 (QueryFn 타입 정의 포함)
│  │  ├─ normalize.ts        SDK 메시지 → PanelEvent
│  │  ├─ InputQueue.ts       AsyncIterable 입력 큐
│  │  ├─ ApprovalBroker.ts   canUseTool ↔ 승인 카드
│  │  ├─ approvalInputs.ts   AskUserQuestion·ExitPlanMode 입력 해석
│  │  ├─ buildOptions.ts     SessionConfig + 재정의 → SDK Options
│  │  └─ ClaudeSession.ts    query() 래퍼 (패널 1개 = 세션 1개)
│  ├─ chat/ChatState.ts      PanelEvent → ChatItem[]
│  ├─ threads/ThreadService.ts
│  ├─ context/
│  │  ├─ ContextBuilder.ts   프롬프트 조립, 칩 해제 상태
│  │  └─ ActiveNoteTracker.ts
│  ├─ rewrite/RewriteSelection.ts
│  └─ ui/
│     ├─ ChatView.ts  MessageList.ts  Composer.ts  ApprovalCard.ts  Toolbar.ts
│     ├─ SlashPopup.ts  commandMatch.ts  ThreadPicker.ts  TextPromptModal.ts  RewriteModal.ts
│     └─ toolFormat.ts  format.ts
└─ tests/
   ├─ mocks/obsidian.ts  helpers/fakeQuery.ts  fixtures/read-and-reply.jsonl
   ├─ util/ session/ chat/ context/ threads/ rewrite/ ui/   (단위 테스트)
   └─ live/session.live.test.ts                               (npm run test:live)
```

## 단계 구성

| 단계 | Task | 끝나면 |
|---|---|---|
| 0. 번들 검증 | 1–2 | Obsidian 안에서 `query()` 1회 호출 성공 |
| 1. 세션 계층 | 3–7 | UI 없이 대화·승인·중단·이어하기 동작 (실제 CLI 통합 테스트 통과) |
| 2. 기본 채팅 UI | 8–9 | **실사용 가능** (MVP) |
| 3. 승인·모드 | 10–11 | AskUserQuestion·Plan 승인, 모델·추론 강도·권한 모드, 컨텍스트 사용률 |
| 4. 컨텍스트·자동완성 | 12–14 | 노트·선택 영역 첨부 칩, `/` 자동완성 |
| 5. 스레드 | 15–16 | 목록·이어하기·fork·이름 변경·제목 자동 생성 |
| 6. 고쳐쓰기 | 17–18 | 선택 영역 고쳐쓰기 |
| 7. 마무리 | 19–21 | 진단·여러 패널·명령 정리, 수동 점검 완료 |

---

## 0단계 — 번들 검증

### Task 1: 프로젝트 골격·빌드 파이프라인·1회성 호출

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `.gitignore`, `manifest.json`, `styles.css`
- Create: `scripts/check-bundle.mjs`, `scripts/smoke-load.cjs`
- Create: `src/globals.d.ts`, `src/util/claudePath.ts`, `src/session/oneShot.ts`, `src/main.ts`
- Create: `tests/mocks/obsidian.ts`, `tests/helpers/fakeQuery.ts`
- Test: `tests/util/claudePath.test.ts`, `tests/session/oneShot.test.ts`

**Interfaces:**
- Produces:
  - `augmentPath(current: string | undefined, home: string): string`
  - `resolveOnPath(command: string, pathValue: string, exists?: (p: string) => boolean): string | null`
  - `type ExecFn = (file: string, args: string[]) => Promise<string>`; `findClaudeViaLoginShell(exec?: ExecFn): Promise<string | null>`
  - `buildEnv(base?: NodeJS.ProcessEnv, home?: string): Record<string, string | undefined>`
  - `type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query`
  - `interface OneShotConfig { cwd: string; claudePath: string; env: Record<string, string | undefined> }`
  - `oneShot(queryFn: QueryFn, config: OneShotConfig, prompt: string, opts?: { model?: string; systemPrompt?: string }): Promise<{ text: string; model: string | null; cliVersion: string | null }>`
  - 테스트 헬퍼 `FakeQuery`, `fakeQueryFn(): { fn: QueryFn; calls: FakeQuery[] }`, `tick(): Promise<void>`

- [ ] **Step 1: 설정 파일 작성**

`package.json`:
```json
{
  "name": "claude-panel",
  "version": "0.1.0",
  "private": true,
  "description": "Use local Claude Code in the Obsidian sidebar",
  "scripts": {
    "dev": "node esbuild.config.mjs",
    "build": "tsc --noEmit && node esbuild.config.mjs production && node scripts/check-bundle.mjs && node scripts/smoke-load.cjs",
    "test": "vitest run",
    "test:live": "vitest run --config vitest.live.config.ts"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts", "vitest.live.config.ts"]
}
```

`esbuild.config.mjs`:
```js
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
```

`vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/mocks/obsidian.ts', import.meta.url)) } },
  define: { __SDK_VERSION__: JSON.stringify('test'), __PLUGIN_VERSION__: JSON.stringify('test') },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/live/**'], environment: 'node' },
});
```

`.gitignore`:
```
node_modules/
main.js
*.log
```

`manifest.json`:
```json
{
  "id": "claude-panel",
  "name": "Claude Panel",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Use local Claude Code in the Obsidian sidebar.",
  "author": "kayman",
  "isDesktopOnly": true
}
```

`styles.css`:
```css
/* Claude Panel */
```

`src/globals.d.ts`:
```ts
declare const __SDK_VERSION__: string;
declare const __PLUGIN_VERSION__: string;
```

- [ ] **Step 2: 의존성 설치**

```bash
cd ~/tools/claude-panel
npm install --save-exact @anthropic-ai/claude-agent-sdk@0.3.278 diff@9.0.0
npm install -D --save-exact typescript@5.9.3 esbuild@0.28.2 vitest@3.2.7 vite@6.4.3 obsidian@1.13.1 @types/node@20.19.43
```
Expected: 오류 없이 설치. SDK의 peer 의존성(`@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `zod`)은 npm이 자동 설치하며 타입 용도로만 쓰인다 (SDK 번들이 런타임에 import하지 않음).

- [ ] **Step 3: 테스트 목·헬퍼 작성**

`tests/mocks/obsidian.ts` (단위 테스트 대상은 obsidian을 import하지 않지만, 실수로 import해도 로드되도록 최소 목을 둔다):
```ts
export class Notice { constructor(public message: string) {} }
export class Plugin {}
export class ItemView {}
export class Modal {}
export class FuzzySuggestModal<T> { declare readonly _t: T; }
export class PluginSettingTab {}
export class Setting {}
export class MarkdownView {}
export class FileSystemAdapter {}
export class Component {
  addChild<T>(c: T): T { return c; }
  removeChild<T>(c: T): T { return c; }
}
export const MarkdownRenderer = { render: async (): Promise<void> => undefined };
export const Keymap = { isModEvent: (): boolean => false };
export function setIcon(): void {}
```

`tests/helpers/fakeQuery.ts`:
```ts
import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { vi } from 'vitest';
import type { QueryFn } from '../../src/session/oneShot';

type Params = { prompt: string | AsyncIterable<unknown>; options?: Options };

/** SDK Query를 흉내 낸다: emit()으로 메시지를 흘리고, 제어 메서드는 vi.fn으로 기록한다. */
export class FakeQuery {
  readonly sent: unknown[] = [];
  private readonly queue: unknown[] = [];
  private waiter: ((r: IteratorResult<unknown>) => void) | null = null;
  private rejecter: ((e: unknown) => void) | null = null;
  private finished = false;

  interrupt = vi.fn(async () => undefined);
  setModel = vi.fn(async (_model?: string) => undefined);
  setPermissionMode = vi.fn(async (_mode: string) => undefined);
  applyFlagSettings = vi.fn(async (_settings: Record<string, unknown>) => undefined);
  getContextUsage = vi.fn(async () => ({ percentage: 42 }));
  supportedCommands = vi.fn(async () => [{ name: 'ingest', description: 'raw/ 신규 자료 ingest', argumentHint: '' }]);
  supportedModels = vi.fn(async () => []);
  close = vi.fn(() => this.end());

  constructor(readonly params: Params) {
    const prompt = params.prompt;
    if (typeof prompt !== 'string') {
      void (async () => {
        for await (const m of prompt) this.sent.push(m);
      })();
    }
  }

  emit(msg: unknown): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  end(): void {
    this.finished = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: undefined, done: true });
    }
  }

  /** 대기 중인 next()를 예외로 끝낸다 (스트림 도중 프로세스 종료 흉내). */
  fail(err: unknown): void {
    const r = this.rejecter;
    this.waiter = null;
    this.rejecter = null;
    r?.(err);
  }

  next(): Promise<IteratorResult<unknown>> {
    if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift(), done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.rejecter = reject;
    });
  }

  async return(): Promise<IteratorResult<unknown>> {
    this.end();
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}

export function fakeQueryFn(): { fn: QueryFn; calls: FakeQuery[] } {
  const calls: FakeQuery[] = [];
  const fn = ((params: Params) => {
    const q = new FakeQuery(params);
    calls.push(q);
    return q as unknown as Query;
  }) as unknown as QueryFn;
  return { fn, calls };
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
```

- [ ] **Step 4: claudePath 실패 테스트 작성**

`tests/util/claudePath.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { augmentPath, buildEnv, findClaudeViaLoginShell, resolveOnPath } from '../../src/util/claudePath';

describe('augmentPath', () => {
  it('빠진 사용자 bin 경로를 뒤에 덧붙인다', () => {
    const result = augmentPath('/usr/bin:/bin', '/home/u').split(':');
    expect(result.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(result).toContain('/home/u/.local/bin');
    expect(result).toContain('/usr/local/bin');
  });
  it('이미 있는 경로는 중복하지 않는다', () => {
    const result = augmentPath('/home/u/.local/bin:/usr/bin', '/home/u').split(':');
    expect(result.filter((p) => p === '/home/u/.local/bin')).toHaveLength(1);
  });
  it('PATH가 없어도 동작한다', () => {
    expect(augmentPath(undefined, '/home/u')).toContain('/home/u/.local/bin');
  });
});

describe('resolveOnPath', () => {
  const exists = (p: string) => p === '/b/claude' || p === '/abs/claude';
  it('PATH 순서대로 찾아 절대 경로를 돌려준다', () => {
    expect(resolveOnPath('claude', '/a:/b', exists)).toBe('/b/claude');
  });
  it('절대 경로는 존재할 때만 그대로 돌려준다', () => {
    expect(resolveOnPath('/abs/claude', '', exists)).toBe('/abs/claude');
    expect(resolveOnPath('/nope/claude', '', exists)).toBeNull();
  });
  it('못 찾으면 null', () => {
    expect(resolveOnPath('claude', '/a', exists)).toBeNull();
  });
});

describe('findClaudeViaLoginShell', () => {
  it('bash -lc 결과의 마지막 줄을 절대 경로로 받는다', async () => {
    const calls: string[][] = [];
    const exec = async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return 'motd noise\n/home/u/.local/bin/claude\n';
    };
    expect(await findClaudeViaLoginShell(exec)).toBe('/home/u/.local/bin/claude');
    expect(calls[0]).toEqual(['bash', '-lc', 'command -v claude']);
  });
  it('실행 실패나 상대 경로 결과는 null', async () => {
    expect(await findClaudeViaLoginShell(async () => { throw new Error('exit 1'); })).toBeNull();
    expect(await findClaudeViaLoginShell(async () => 'claude\n')).toBeNull();
  });
});

describe('buildEnv', () => {
  it('기존 환경을 유지하고 PATH를 보강하며 클라이언트 식별자를 넣는다', () => {
    const env = buildEnv({ PATH: '/usr/bin', HOME: '/home/u' }, '/home/u');
    expect(env.HOME).toBe('/home/u');
    expect(env.PATH).toContain('/home/u/.local/bin');
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('claude-panel/test');
  });
});
```

- [ ] **Step 5: 실패 확인**

Run: `npx vitest run tests/util/claudePath.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/util/claudePath"`

- [ ] **Step 6: claudePath 구현**

`src/util/claudePath.ts`:
```ts
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

const HOME_BIN_DIRS = ['.local/bin', '.npm-global/bin', 'bin', '.claude/local'];
const SYSTEM_BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin'];

/** 데스크톱 런처로 띄운 Obsidian은 PATH에 ~/.local/bin 등이 빠져 있다. */
export function augmentPath(current: string | undefined, home: string): string {
  const parts = (current ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...HOME_BIN_DIRS.map((d) => join(home, d)), ...SYSTEM_BIN_DIRS]) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(delimiter);
}

/** SDK는 실행 파일 존재 여부를 검사하므로 이름만 있는 설정값을 절대 경로로 바꾼다. */
export function resolveOnPath(command: string, pathValue: string, exists: (p: string) => boolean = existsSync): string | null {
  if (isAbsolute(command)) return exists(command) ? command : null;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export type ExecFn = (file: string, args: string[]) => Promise<string>;

const execDefault: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

/** 로그인 셸의 PATH로 claude를 찾는다 (nvm 등 셸 초기화 파일에서 PATH를 잡는 경우). */
export async function findClaudeViaLoginShell(exec: ExecFn = execDefault): Promise<string | null> {
  try {
    const lines = (await exec('bash', ['-lc', 'command -v claude'])).trim().split('\n');
    const last = lines[lines.length - 1]?.trim() ?? '';
    return isAbsolute(last) ? last : null;
  } catch {
    return null;
  }
}

export function buildEnv(base: NodeJS.ProcessEnv = process.env, home: string = homedir()): Record<string, string | undefined> {
  return { ...base, PATH: augmentPath(base.PATH, home), CLAUDE_AGENT_SDK_CLIENT_APP: `claude-panel/${__PLUGIN_VERSION__}` };
}
```

- [ ] **Step 7: 통과 확인**

Run: `npx vitest run tests/util/claudePath.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 8: oneShot 실패 테스트 작성**

`tests/session/oneShot.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { oneShot } from '../../src/session/oneShot';
import { fakeQueryFn } from '../helpers/fakeQuery';

const config = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' } };
const init = { type: 'system', subtype: 'init', model: 'claude-haiku-4-5', claude_code_version: '2.1.278', session_id: 's1' };

function scripted(messages: unknown[]) {
  const { fn, calls } = fakeQueryFn();
  const wrapped = ((params: Parameters<typeof fn>[0]) => {
    const q = fn(params);
    for (const m of messages) calls[calls.length - 1].emit(m);
    calls[calls.length - 1].end();
    return q;
  }) as typeof fn;
  return { fn: wrapped, calls };
}

describe('oneShot', () => {
  it('도구·설정·세션 기록 없이 호출하고 결과 텍스트를 돌려준다', async () => {
    const { fn, calls } = scripted([init, { type: 'result', subtype: 'success', is_error: false, result: '  pong \n' }]);
    const r = await oneShot(fn, config, 'Reply with exactly: pong', { model: 'haiku' });
    expect(r).toEqual({ text: 'pong', model: 'claude-haiku-4-5', cliVersion: '2.1.278' });
    const options = calls[0].params.options!;
    expect(calls[0].params.prompt).toBe('Reply with exactly: pong');
    expect(options).toMatchObject({
      cwd: '/vault', pathToClaudeCodeExecutable: '/bin/claude', env: { PATH: '/bin' },
      tools: [], persistSession: false, settingSources: [], maxTurns: 1, model: 'haiku',
    });
    expect(options.systemPrompt).toBeUndefined();
  });

  it('systemPrompt를 지정하면 그대로 넘긴다', async () => {
    const { fn, calls } = scripted([{ type: 'result', subtype: 'success', is_error: false, result: 'x' }]);
    await oneShot(fn, config, 'p', { systemPrompt: 'You rewrite.' });
    expect(calls[0].params.options!.systemPrompt).toBe('You rewrite.');
    expect(calls[0].params.options!.model).toBeUndefined();
  });

  it('오류 result면 예외를 던진다', async () => {
    const { fn } = scripted([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('boom');
  });

  it('성공 subtype이어도 is_error면 result 텍스트로 예외를 던진다', async () => {
    const { fn } = scripted([{ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached' }]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('usage limit');
  });

  it('result 없이 끝나면 예외', async () => {
    const { fn } = scripted([init]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('결과 없이');
  });
});
```

- [ ] **Step 9: 실패 확인**

Run: `npx vitest run tests/session/oneShot.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/session/oneShot"`

- [ ] **Step 10: oneShot 구현**

`src/session/oneShot.ts`:
```ts
import type { Options } from '@anthropic-ai/claude-agent-sdk';

export type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query;

export interface OneShotConfig {
  cwd: string;
  claudePath: string;
  env: Record<string, string | undefined>;
}

export interface OneShotOptions {
  model?: string;
  systemPrompt?: string;
}

export interface OneShotResult {
  text: string;
  model: string | null;
  cliVersion: string | null;
}

/** 도구·설정·세션 기록 없이 한 번 묻고 답을 받는다 (연결 테스트·제목 생성·고쳐쓰기). */
export async function oneShot(queryFn: QueryFn, config: OneShotConfig, prompt: string, opts: OneShotOptions = {}): Promise<OneShotResult> {
  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.claudePath,
    env: config.env,
    tools: [],
    persistSession: false,
    settingSources: [],
    maxTurns: 1,
  };
  if (opts.model) options.model = opts.model;
  if (opts.systemPrompt !== undefined) options.systemPrompt = opts.systemPrompt;

  let model: string | null = null;
  let cliVersion: string | null = null;
  for await (const msg of queryFn({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      model = msg.model;
      cliVersion = msg.claude_code_version;
    } else if (msg.type === 'result') {
      if (msg.subtype === 'success' && !msg.is_error) return { text: msg.result.trim(), model, cliVersion };
      const detail = msg.subtype === 'success' ? msg.result : msg.errors.join('\n');
      throw new Error(detail || msg.subtype);
    }
  }
  throw new Error('Claude가 결과 없이 종료되었습니다.');
}
```

- [ ] **Step 11: 통과 확인**

Run: `npx vitest run tests/session/oneShot.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 12: 번들 검사 스크립트 작성**

`scripts/check-bundle.mjs`:
```js
import { readFileSync } from 'node:fs';

const src = readFileSync('main.js', 'utf8');
if (/\bimport\.meta\b/.test(src)) {
  console.error('check-bundle: import.meta가 번들에 남아 있음 (esbuild define 확인)');
  process.exit(1);
}
console.log(`check-bundle: OK (${(src.length / 1024 / 1024).toFixed(1)} MB)`);
```

`scripts/smoke-load.cjs`:
```js
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
```

- [ ] **Step 13: 최소 플러그인 작성 (연결 테스트 명령)**

`src/main.ts`:
```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { FileSystemAdapter, Notice, Plugin } from 'obsidian';
import { oneShot } from './session/oneShot';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from './util/claudePath';

export default class ClaudePanelPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.addCommand({ id: 'test-connection', name: 'Test connection', callback: () => void this.testConnection() });
  }

  vaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error('데스크톱 vault에서만 동작합니다.');
  }

  private async testConnection(): Promise<void> {
    const env = buildEnv();
    const claudePath = resolveOnPath('claude', env.PATH ?? '') ?? (await findClaudeViaLoginShell());
    if (!claudePath) {
      new Notice('claude 실행 파일을 찾지 못했습니다.');
      return;
    }
    const notice = new Notice('Claude 연결 확인 중…', 0);
    try {
      const r = await oneShot(query, { cwd: this.vaultPath(), claudePath, env }, 'Reply with exactly: pong', { model: 'haiku' });
      notice.setMessage(`연결 성공: ${r.text} (CLI ${r.cliVersion ?? '?'}, ${r.model ?? '?'})`);
    } catch (err) {
      notice.setMessage(`연결 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    window.setTimeout(() => notice.hide(), 8000);
  }
}
```

- [ ] **Step 14: 전체 검증**

Run: `npm test && npm run build`
Expected: vitest 14 tests PASS, `tsc` 오류 없음, esbuild가 `main.js` 생성, `check-bundle: OK (1.7 MB)` 근처, `smoke-load: OK`.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "chore: scaffold plugin with CJS bundle pipeline and one-shot query

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 2: Obsidian 실기 검증 (진행 게이트)

SDK 번들이 Electron 렌더러에서도 로드되고 `claude`를 띄우는지 확인한다. **실패하면 이후 Task를 진행하지 않고** superpowers:systematic-debugging으로 원인을 찾는다.

**Files:**
- Create: `scripts/link-vault.sh`

**Interfaces:**
- Consumes: Task 1의 `main.js`, `manifest.json`, `styles.css`
- Produces: `scripts/link-vault.sh <vault 경로>` (이후 모든 수동 점검에서 사용)

- [ ] **Step 1: 링크 스크립트 작성**

`scripts/link-vault.sh`:
```bash
#!/usr/bin/env bash
# 사용법: scripts/link-vault.sh <vault 경로>
# 빌드 결과물만 vault 플러그인 폴더에 심볼릭 링크한다 (node_modules는 vault에 들어가지 않음).
set -euo pipefail
vault="${1:?vault 경로를 지정하세요}"
root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$vault/.obsidian/plugins/claude-panel"
mkdir -p "$dest"
for f in main.js manifest.json styles.css; do
  ln -sfn "$root/$f" "$dest/$f"
done
echo "linked into $dest"
```

Run: `chmod +x scripts/link-vault.sh && npm run build && scripts/link-vault.sh ~/Vault/Boxx`
Expected: `linked into /home/kayman/Vault/Boxx/.obsidian/plugins/claude-panel`, `ls -l`로 세 파일이 심볼릭 링크임을 확인.

- [ ] **Step 2: [사용자 확인] Obsidian에서 로드·호출 확인**

사용자에게 다음을 요청하고 결과를 기다린다:
1. Obsidian에서 `Ctrl+R`(앱 재로드) → 설정 › 커뮤니티 플러그인에서 **Claude Panel** 활성화
2. `Ctrl+Shift+I` 개발자 도구 Console을 열어 둔 채 명령 팔레트에서 **Claude Panel: Test connection** 실행
3. 기대 결과: Notice `연결 성공: pong (CLI 2.1.278, claude-haiku-…)`, Console에 빨간 오류 없음

참고: Boxx vault의 remotely-save가 `.obsidian` 폴더를 동기화하도록 설정돼 있다면 `main.js`(약 1.7MB)가 업로드될 수 있으니 설정을 함께 확인한다.

- [ ] **Step 3: Commit**

```bash
git add scripts/link-vault.sh
git commit -m "chore: add vault link script

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 1단계 — 세션 계층

### Task 3: 실제 스트림 녹화 + Normalizer

**Files:**
- Create: `scripts/record-fixture.sh`, `tests/fixtures/read-and-reply.jsonl` (녹화 결과)
- Create: `src/types.ts`, `src/session/normalize.ts`
- Test: `tests/session/normalize.test.ts`

**Interfaces:**
- Produces (`src/types.ts`, 이후 모든 Task가 사용):
```ts
export type BlockType = 'text' | 'thinking';
export interface TurnUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; costUsd: number; durationMs: number }
export interface ApprovalRequest { id: string; toolName: string; input: Record<string, unknown>; title: string | null; reason: string | null; suggestions: PermissionUpdate[]; canAlwaysAllow: boolean }
export type PanelEvent = … (아래 Step 2 전체 정의)
```
- Produces (`src/session/normalize.ts`): `class Normalizer { constructor(options?: { history: boolean }); push(raw: unknown): PanelEvent[] }`, `cleanUserText(raw: string): string`, `toolResultText(content: unknown): string`

- [ ] **Step 1: 녹화 스크립트 작성·실행**

`scripts/record-fixture.sh`:
```bash
#!/usr/bin/env bash
# 실제 CLI 스트림(SDK와 같은 메시지 형식)을 녹화해 normalize 회귀 테스트 입력으로 쓴다.
# 임시 폴더에서 가장 가벼운 모델로, hook을 끄고 실행한다.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/tests/fixtures"
mkdir -p "$out"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
echo "hello-fixture" > note.txt
claude -p "Read note.txt with the Read tool, then reply with its content in one short sentence." \
  --output-format stream-json --include-partial-messages --verbose --model haiku \
  --allowedTools Read --settings '{"disableAllHooks":true}' > "$out/read-and-reply.jsonl"
echo "wrote $out/read-and-reply.jsonl ($(wc -l < "$out/read-and-reply.jsonl") lines)"
```

Run: `chmod +x scripts/record-fixture.sh && scripts/record-fixture.sh`
Expected: `wrote …/read-and-reply.jsonl (40~60 lines)`. `head -c 300 tests/fixtures/read-and-reply.jsonl`의 첫 줄이 `{"type":"system","subtype":"init",…}`.

- [ ] **Step 2: 공용 타입 작성**

`src/types.ts`:
```ts
import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

export type BlockType = 'text' | 'thinking';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** CLI가 만들어 준 승인 문장 (예: "Claude wants to read foo.txt"). 없으면 도구 이름+요약으로 표시 */
  title: string | null;
  reason: string | null;
  suggestions: PermissionUpdate[];
  canAlwaysAllow: boolean;
}

export type PanelEvent =
  // normalize.ts가 SDK 메시지에서 만드는 이벤트
  | { kind: 'init'; sessionId: string; model: string; permissionMode: string; slashCommands: string[]; cliVersion: string; effort: string | null }
  | { kind: 'block-start'; key: string; blockType: BlockType }
  | { kind: 'block-delta'; key: string; text: string }
  | { kind: 'block-final'; key: string; blockType: BlockType; text: string }
  | { kind: 'tool-start'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; toolUseId: string; isError: boolean; output: string }
  | { kind: 'user-text'; text: string }
  | { kind: 'retry'; attempt: number; maxRetries: number }
  | { kind: 'mode-changed'; permissionMode: string }
  | { kind: 'assistant-error'; error: string }
  | { kind: 'turn-end'; ok: boolean; subtype: string; errors: string[]; usage: TurnUsage }
  // ClaudeSession·ApprovalBroker가 만드는 이벤트
  | { kind: 'turn-start'; text: string; contextLabel: string | null }
  | { kind: 'interrupted' }
  | { kind: 'stream-error'; message: string; code: string | null }
  | { kind: 'context-usage'; percentage: number }
  | { kind: 'approval-request'; request: ApprovalRequest }
  | { kind: 'approval-settled'; id: string; summary: string };
```

- [ ] **Step 3: 실패 테스트 작성**

`tests/session/normalize.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Normalizer, cleanUserText, toolResultText } from '../../src/session/normalize';
import type { PanelEvent } from '../../src/types';

type Of<K extends PanelEvent['kind']> = Extract<PanelEvent, { kind: K }>;
const ofKind = <K extends PanelEvent['kind']>(events: PanelEvent[], kind: K): Of<K>[] =>
  events.filter((e): e is Of<K> => e.kind === kind);

function replay(file: string): PanelEvent[] {
  const n = new Normalizer();
  const lines = readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
  return lines.flatMap((line) => n.push(JSON.parse(line)));
}

describe('Normalizer — 녹화된 실제 스트림', () => {
  const events = replay('read-and-reply.jsonl');

  it('init으로 시작해 성공한 turn-end로 끝난다', () => {
    expect(events[0]).toMatchObject({ kind: 'init' });
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn-end', ok: true, subtype: 'success' });
  });

  it('Read 도구 시작과 결과가 같은 id로 짝지어진다', () => {
    const [start] = ofKind(events, 'tool-start');
    const [result] = ofKind(events, 'tool-result');
    expect(start.name).toBe('Read');
    expect(result.toolUseId).toBe(start.toolUseId);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('hello-fixture');
  });

  it('delta를 이어 붙인 텍스트가 같은 키의 최종 블록 텍스트와 같다', () => {
    const finals = ofKind(events, 'block-final').filter((e) => e.blockType === 'text');
    expect(finals.length).toBeGreaterThan(0);
    for (const f of finals) {
      const streamed = ofKind(events, 'block-delta').filter((d) => d.key === f.key).map((d) => d.text).join('');
      expect(streamed).toBe(f.text);
      expect(ofKind(events, 'block-start').some((s) => s.key === f.key)).toBe(true);
    }
  });

  it('실시간 모드에서는 user-text를 만들지 않는다', () => {
    expect(ofKind(events, 'user-text')).toHaveLength(0);
  });
});

describe('Normalizer — 개별 경우', () => {
  it('stream_event 키와 assistant 블록 키가 같은 규칙으로 맞춰진다', () => {
    const n = new Normalizer();
    const out = [
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hm' }] } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 2, content_block: { type: 'text' } } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'done' }] } }),
    ];
    expect(out).toEqual([
      { kind: 'block-start', key: 'm1#0', blockType: 'thinking' },
      { kind: 'block-delta', key: 'm1#0', text: 'hm' },
      { kind: 'block-final', key: 'm1#0', blockType: 'thinking', text: 'hm' },
      { kind: 'tool-start', toolUseId: 'tu1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'block-start', key: 'm1#2', blockType: 'text' },
      { kind: 'block-final', key: 'm1#2', blockType: 'text', text: 'done' },
    ]);
  });

  it('모르는 메시지 타입과 서브에이전트 메시지는 무시한다', () => {
    const n = new Normalizer();
    expect(n.push({ type: 'rate_limit_event' })).toEqual([]);
    expect(n.push(null)).toEqual([]);
    expect(n.push({ type: 'assistant', parent_tool_use_id: 'tu9', message: { id: 'x', content: [{ type: 'text', text: 'sub' }] } })).toEqual([]);
  });

  it('api_retry·status·init을 변환한다', () => {
    const n = new Normalizer();
    expect(n.push({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10 })).toEqual([{ kind: 'retry', attempt: 2, maxRetries: 10 }]);
    expect(n.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan' })).toEqual([{ kind: 'mode-changed', permissionMode: 'plan' }]);
    expect(n.push({ type: 'system', subtype: 'status', status: 'requesting' })).toEqual([]);
    expect(n.push({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', permissionMode: 'auto', slash_commands: ['ingest'], claude_code_version: '2.1.278', effort: 'high' }))
      .toEqual([{ kind: 'init', sessionId: 's1', model: 'm', permissionMode: 'auto', slashCommands: ['ingest'], cliVersion: '2.1.278', effort: 'high' }]);
  });

  it('오류 result와 is_error인 success를 실패한 turn-end로 만든다', () => {
    const n = new Normalizer();
    const [a] = n.push({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'], usage: { input_tokens: 5, output_tokens: 1 }, total_cost_usd: 0.01, duration_ms: 900 });
    expect(a).toEqual({ kind: 'turn-end', ok: false, subtype: 'error_during_execution', errors: ['boom'], usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01, durationMs: 900 } });
    const [b] = n.push({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1760000000' });
    expect(b).toMatchObject({ ok: false, errors: ['Claude AI usage limit reached|1760000000'] });
  });

  it('assistant의 error 필드를 assistant-error로 만든다', () => {
    const n = new Normalizer();
    const out = n.push({ type: 'assistant', parent_tool_use_id: null, error: 'authentication_failed', message: { id: 'e1', content: [{ type: 'text', text: 'Invalid API key' }] } });
    expect(out[0]).toEqual({ kind: 'assistant-error', error: 'authentication_failed' });
  });

  it('배열 형태 tool_result와 is_error를 처리한다', () => {
    const n = new Normalizer();
    const out = n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'a' }, { type: 'image' }] }] } });
    expect(out).toEqual([{ kind: 'tool-result', toolUseId: 't1', isError: true, output: 'a\n[image]' }]);
  });

  it('history 모드에서는 사용자 텍스트를 정리해 user-text로 만든다', () => {
    const n = new Normalizer({ history: true });
    expect(n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: '<context>\n현재 노트: a.md\n</context>\n\n요약해 줘' } }))
      .toEqual([{ kind: 'user-text', text: '요약해 줘' }]);
    expect(n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } })).toEqual([]);
  });
});

describe('cleanUserText / toolResultText', () => {
  it('슬래시 명령 표식을 /명령 인자 형태로 바꾼다', () => {
    expect(cleanUserText('<command-message>ingest</command-message>\n<command-name>/ingest</command-name>\n<command-args>raw/a.pdf</command-args>')).toBe('/ingest raw/a.pdf');
    expect(cleanUserText('<command-name>/clear</command-name><command-args></command-args>')).toBe('/clear');
  });
  it('로컬 명령 출력은 빈 문자열', () => {
    expect(cleanUserText('<local-command-stdout>ok</local-command-stdout>')).toBe('');
  });
  it('문자열·배열·기타 content', () => {
    expect(toolResultText('x')).toBe('x');
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(toolResultText(undefined)).toBe('');
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npx vitest run tests/session/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/session/normalize"`

- [ ] **Step 5: Normalizer 구현**

`src/session/normalize.ts`:
```ts
import type { BlockType, PanelEvent, TurnUsage } from '../types';

// SDK 메시지는 버전마다 필드가 늘어나므로 필요한 필드만 느슨하게 읽는다.
type Loose = Record<string, any>;

const CONTEXT_RE = /<context>[\s\S]*?<\/context>\s*/g;
const COMMAND_NAME_RE = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;

export interface NormalizerOptions {
  /** true면 getSessionMessages로 불러온 과거 대화: 사용자 텍스트도 이벤트로 만든다. */
  history: boolean;
}

/**
 * SDK 메시지 → 패널 이벤트.
 * 실시간 스트림에서 CLI는 content block 하나마다 assistant 메시지를 하나씩 보내고,
 * 같은 message.id 안에서 도착 순서가 stream_event의 index와 같다. 이 순서로 블록 키를 맞춘다.
 */
export class Normalizer {
  private readonly blockCount = new Map<string, number>();
  private streamMessageId: string | null = null;

  constructor(private readonly options: NormalizerOptions = { history: false }) {}

  push(raw: unknown): PanelEvent[] {
    if (!raw || typeof raw !== 'object') return [];
    const msg = raw as Loose;
    if (msg.parent_tool_use_id) return []; // 서브에이전트 내부 흐름은 1차 버전에서 표시하지 않음
    switch (msg.type) {
      case 'system':
        return this.system(msg);
      case 'stream_event':
        return this.stream(msg.event ?? {});
      case 'assistant':
        return this.assistant(msg);
      case 'user':
        return this.user(msg);
      case 'result':
        return [resultEvent(msg)];
      default:
        console.debug('[claude-panel] 표시하지 않는 SDK 메시지', msg.type);
        return [];
    }
  }

  private system(msg: Loose): PanelEvent[] {
    switch (msg.subtype) {
      case 'init':
        return [{
          kind: 'init',
          sessionId: String(msg.session_id ?? ''),
          model: String(msg.model ?? ''),
          permissionMode: String(msg.permissionMode ?? 'default'),
          slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands.map(String) : [],
          cliVersion: String(msg.claude_code_version ?? ''),
          effort: typeof msg.effort === 'string' ? msg.effort : null,
        }];
      case 'api_retry':
        return [{ kind: 'retry', attempt: Number(msg.attempt ?? 0), maxRetries: Number(msg.max_retries ?? 0) }];
      case 'status':
        return typeof msg.permissionMode === 'string' ? [{ kind: 'mode-changed', permissionMode: msg.permissionMode }] : [];
      default:
        return [];
    }
  }

  private stream(event: Loose): PanelEvent[] {
    if (event.type === 'message_start') {
      this.streamMessageId = typeof event.message?.id === 'string' ? event.message.id : null;
      return [];
    }
    if (!this.streamMessageId || typeof event.index !== 'number') return [];
    const key = `${this.streamMessageId}#${event.index}`;
    if (event.type === 'content_block_start') {
      const t = event.content_block?.type;
      return t === 'text' || t === 'thinking' ? [{ kind: 'block-start', key, blockType: t }] : [];
    }
    if (event.type === 'content_block_delta') {
      const d: Loose = event.delta ?? {};
      if (d.type === 'text_delta') return [{ kind: 'block-delta', key, text: String(d.text ?? '') }];
      if (d.type === 'thinking_delta') return [{ kind: 'block-delta', key, text: String(d.thinking ?? '') }];
    }
    return [];
  }

  private assistant(msg: Loose): PanelEvent[] {
    const out: PanelEvent[] = [];
    if (typeof msg.error === 'string') out.push({ kind: 'assistant-error', error: msg.error });
    const messageId = String(msg.message?.id ?? msg.uuid ?? '');
    const content: Loose[] = Array.isArray(msg.message?.content) ? msg.message.content : [];
    for (const block of content) {
      const index = this.blockCount.get(messageId) ?? 0;
      this.blockCount.set(messageId, index + 1);
      const key = `${messageId}#${index}`;
      if (block.type === 'text') out.push(finalBlock(key, 'text', block.text));
      else if (block.type === 'thinking') out.push(finalBlock(key, 'thinking', block.thinking));
      else if (block.type === 'tool_use') {
        out.push({ kind: 'tool-start', toolUseId: String(block.id), name: String(block.name), input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return out;
  }

  private user(msg: Loose): PanelEvent[] {
    const content = msg.message?.content;
    const out: PanelEvent[] = [];
    if (typeof content === 'string') {
      if (this.options.history) pushUserText(out, content);
      return out;
    }
    if (!Array.isArray(content)) return out;
    for (const block of content as Loose[]) {
      if (block.type === 'tool_result') {
        out.push({ kind: 'tool-result', toolUseId: String(block.tool_use_id), isError: block.is_error === true, output: toolResultText(block.content) });
      } else if (block.type === 'text' && this.options.history) {
        pushUserText(out, String(block.text ?? ''));
      }
    }
    return out;
  }
}

function finalBlock(key: string, blockType: BlockType, text: unknown): PanelEvent {
  return { kind: 'block-final', key, blockType, text: String(text ?? '') };
}

function pushUserText(out: PanelEvent[], raw: string): void {
  const text = cleanUserText(raw);
  if (text) out.push({ kind: 'user-text', text });
}

/** 과거 대화의 사용자 메시지에서 패널이 붙인 컨텍스트와 CLI 내부 표식을 걷어낸다. */
export function cleanUserText(raw: string): string {
  const command = COMMAND_NAME_RE.exec(raw);
  if (command) {
    const args = COMMAND_ARGS_RE.exec(raw)?.[1]?.trim() ?? '';
    return args ? `${command[1]} ${args}` : command[1];
  }
  const text = raw.replace(CONTEXT_RE, '').trim();
  if (text.startsWith('<local-command') || text.startsWith('<system-reminder>')) return '';
  return text;
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Loose[]).map((part) => (part.type === 'text' ? String(part.text ?? '') : `[${String(part.type)}]`)).join('\n');
}

function resultEvent(msg: Loose): PanelEvent {
  const u: Loose = msg.usage ?? {};
  const usage: TurnUsage = {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
    costUsd: Number(msg.total_cost_usd ?? 0),
    durationMs: Number(msg.duration_ms ?? 0),
  };
  const ok = msg.subtype === 'success' && msg.is_error !== true;
  let errors: string[] = [];
  if (Array.isArray(msg.errors)) errors = msg.errors.map(String);
  else if (!ok && typeof msg.result === 'string' && msg.result) errors = [msg.result];
  return { kind: 'turn-end', ok, subtype: String(msg.subtype ?? ''), errors, usage };
}
```
- [ ] **Step 6: 통과 확인**

Run: `npx vitest run tests/session/normalize.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/record-fixture.sh tests/fixtures src/types.ts src/session/normalize.ts tests/session/normalize.test.ts
git commit -m "feat: normalize SDK messages into panel events with recorded fixture

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 4: ChatState (이벤트 → 화면 항목)

**Files:**
- Create: `src/chat/ChatState.ts`
- Test: `tests/chat/ChatState.test.ts`

**Interfaces:**
- Consumes: `PanelEvent`, `ApprovalRequest`, `TurnUsage`, `BlockType` (Task 3)
- Produces:
```ts
export type NoticeAction = 'reconnect' | 'find-claude' | 'open-settings';
export type ChatItem = …(아래 정의);
export type ItemOf<T extends ChatItem['type']> = Extract<ChatItem, { type: T }>;
export class ChatState {
  readonly items: ChatItem[]; busy: boolean;
  constructor(now?: () => number);
  get(id: string): ChatItem | undefined;
  clear(): void;
  apply(e: PanelEvent): string[];            // 바뀌거나 추가된 항목 id
  notice(level: 'info' | 'error', text: string, action?: NoticeAction | null): string;
}
export function friendlyError(text: string): string;   // 사용량 한도 문구에 리셋 시각을 붙인다
```
항목 id 규칙: 사용자 `u:n`, 블록 `b:<key>`, 도구 `t:<toolUseId>`, 승인 `a:<requestId>`, 알림 `n:n`·`n:retry:<turn>`, 사용량 `f:n`.

- [ ] **Step 1: 실패 테스트 작성**

`tests/chat/ChatState.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ChatState, friendlyError, type ChatItem } from '../../src/chat/ChatState';
import type { ApprovalRequest, TurnUsage } from '../../src/types';

const usage: TurnUsage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 1000 };
const request: ApprovalRequest = { id: 'apr-1', toolName: 'Write', input: {}, title: null, reason: null, suggestions: [], canAlwaysAllow: false };

function make() {
  let t = 1000;
  const state = new ChatState(() => t);
  return { state, advance: (ms: number) => { t += ms; } };
}
const find = (state: ChatState, id: string) => state.get(id) as ChatItem;

describe('ChatState', () => {
  it('turn-start는 사용자 항목을 추가하고 busy가 된다', () => {
    const { state } = make();
    const ids = state.apply({ kind: 'turn-start', text: '안녕', contextLabel: '📄 a' });
    expect(state.busy).toBe(true);
    expect(find(state, ids[0])).toMatchObject({ type: 'user', text: '안녕', contextLabel: '📄 a' });
  });

  it('블록 start → delta → final을 한 항목에 접고 경과 시간을 기록한다', () => {
    const { state, advance } = make();
    state.apply({ kind: 'block-start', key: 'm#0', blockType: 'thinking' });
    state.apply({ kind: 'block-delta', key: 'm#0', text: 'a' });
    expect(state.apply({ kind: 'block-delta', key: 'm#0', text: 'b' })).toEqual(['b:m#0']);
    expect(find(state, 'b:m#0')).toMatchObject({ text: 'ab', streaming: true, endedAt: null });
    advance(8000);
    state.apply({ kind: 'block-final', key: 'm#0', blockType: 'thinking', text: 'abc' });
    expect(find(state, 'b:m#0')).toMatchObject({ text: 'abc', streaming: false, startedAt: 1000, endedAt: 9000 });
    expect(state.items).toHaveLength(1);
  });

  it('start 없이 온 final은 완성된 블록으로 추가한다 (과거 대화)', () => {
    const { state } = make();
    state.apply({ kind: 'block-final', key: 'h#0', blockType: 'text', text: 'hi' });
    expect(find(state, 'b:h#0')).toMatchObject({ type: 'block', text: 'hi', streaming: false, endedAt: null });
  });

  it('도구 시작과 결과를 짝짓는다', () => {
    const { state } = make();
    state.apply({ kind: 'tool-start', toolUseId: 'tu1', name: 'Read', input: { file_path: '/v/a.md' } });
    state.apply({ kind: 'tool-result', toolUseId: 'tu1', isError: false, output: 'body' });
    expect(find(state, 't:tu1')).toMatchObject({ status: 'done', output: 'body' });
    state.apply({ kind: 'tool-start', toolUseId: 'tu2', name: 'Bash', input: {} });
    state.apply({ kind: 'tool-result', toolUseId: 'tu2', isError: true, output: 'fail' });
    expect(find(state, 't:tu2')).toMatchObject({ status: 'error' });
  });

  it('중단하면 진행 중 도구·블록·승인을 멈추고, 이후 도착한 tool_result는 무시한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'block-start', key: 'm#0', blockType: 'text' });
    state.apply({ kind: 'tool-start', toolUseId: 'tu1', name: 'Bash', input: {} });
    state.apply({ kind: 'approval-request', request });
    state.apply({ kind: 'interrupted' });
    expect(find(state, 'b:m#0')).toMatchObject({ streaming: false });
    expect(find(state, 't:tu1')).toMatchObject({ status: 'cancelled' });
    expect(find(state, 'a:apr-1')).toMatchObject({ settled: '취소됨' });
    expect(state.apply({ kind: 'tool-result', toolUseId: 'tu1', isError: false, output: 'late' })).toEqual([]);
    expect(state.items.some((i) => i.type === 'notice' && i.text === '중단됨')).toBe(true);
  });

  it('중단 뒤의 오류 turn-end는 오류 알림 없이 사용량만 남긴다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'interrupted' });
    state.apply({ kind: 'turn-end', ok: false, subtype: 'error_during_execution', errors: ['aborted'], usage });
    expect(state.busy).toBe(false);
    expect(state.items.filter((i) => i.type === 'notice' && i.level === 'error')).toHaveLength(0);
    expect(state.items[state.items.length - 1]).toMatchObject({ type: 'footer', ok: false });
  });

  it('실패한 turn-end는 오류 알림을 추가한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'turn-end', ok: false, subtype: 'success', errors: ['Claude AI usage limit reached'], usage });
    expect(state.items.find((i) => i.type === 'notice')).toMatchObject({ level: 'error', text: 'Claude AI usage limit reached' });
  });

  it('사용량 한도 오류에는 리셋 시각을 붙인다', () => {
    const text = friendlyError('Claude AI usage limit reached|1760000000');
    expect(text).toContain('사용량 한도에 도달했습니다.');
    expect(text).toContain(new Date(1760000000 * 1000).toLocaleString());
    expect(friendlyError('other')).toBe('other');
  });

  it('retry는 같은 턴 안에서 한 알림을 갱신한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'retry', attempt: 1, maxRetries: 10 });
    state.apply({ kind: 'retry', attempt: 2, maxRetries: 10 });
    const notices = state.items.filter((i) => i.type === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ text: '재시도 중 (2/10)…' });
  });

  it('stream-error는 busy를 풀고 코드에 맞는 조치를 붙인다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    const ids = state.apply({ kind: 'stream-error', message: 'spawn claude ENOENT', code: 'ENOENT' });
    expect(state.busy).toBe(false);
    expect(find(state, ids[ids.length - 1])).toMatchObject({ type: 'notice', level: 'error', action: 'find-claude' });
    const ids2 = state.apply({ kind: 'stream-error', message: 'died', code: null });
    expect(find(state, ids2[ids2.length - 1])).toMatchObject({ action: 'reconnect' });
  });

  it('assistant-error는 알려진 오류를 안내 문구로 바꾼다', () => {
    const { state } = make();
    const [id] = state.apply({ kind: 'assistant-error', error: 'authentication_failed' });
    expect((find(state, id) as { text: string }).text).toContain('로그인');
    const [id2] = state.apply({ kind: 'assistant-error', error: 'weird' });
    expect((find(state, id2) as { text: string }).text).toBe('API 오류: weird');
  });

  it('승인 요청과 결정 요약', () => {
    const { state } = make();
    state.apply({ kind: 'approval-request', request });
    expect(state.apply({ kind: 'approval-settled', id: 'apr-1', summary: '허용함' })).toEqual(['a:apr-1']);
    expect(find(state, 'a:apr-1')).toMatchObject({ settled: '허용함' });
  });

  it('상단 막대용 이벤트는 항목을 만들지 않고, clear는 모두 비운다', () => {
    const { state } = make();
    expect(state.apply({ kind: 'context-usage', percentage: 30 })).toEqual([]);
    state.apply({ kind: 'user-text', text: 'old' });
    state.notice('info', 'hello');
    state.clear();
    expect(state.items).toHaveLength(0);
    expect(state.get('u:1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/chat/ChatState.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/chat/ChatState"`

- [ ] **Step 3: ChatState 구현**

`src/chat/ChatState.ts`:
```ts
import type { ApprovalRequest, BlockType, PanelEvent, TurnUsage } from '../types';

export type NoticeAction = 'reconnect' | 'find-claude' | 'open-settings';

export type ChatItem =
  | { id: string; type: 'user'; text: string; contextLabel: string | null }
  | { id: string; type: 'block'; blockType: BlockType; text: string; streaming: boolean; startedAt: number; endedAt: number | null }
  | { id: string; type: 'tool'; toolUseId: string; name: string; input: Record<string, unknown>; status: 'running' | 'done' | 'error' | 'cancelled'; output: string | null }
  | { id: string; type: 'approval'; request: ApprovalRequest; settled: string | null }
  | { id: string; type: 'notice'; level: 'info' | 'error'; text: string; action: NoticeAction | null }
  | { id: string; type: 'footer'; usage: TurnUsage; ok: boolean };

export type ItemOf<T extends ChatItem['type']> = Extract<ChatItem, { type: T }>;

/** CLI 오류 문구를 안내 문구로 바꾼다. 사용량 한도는 `…usage limit reached|<epoch초>` 형태로 온다. */
export function friendlyError(text: string): string {
  const limit = /usage limit reached\|(\d+)/i.exec(text);
  if (limit) return `사용량 한도에 도달했습니다. ${new Date(Number(limit[1]) * 1000).toLocaleString()}에 초기화됩니다.`;
  return text;
}

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: '로그인이 필요합니다. 터미널에서 `claude`를 실행해 로그인한 뒤 다시 보내세요.',
  oauth_org_not_allowed: '이 계정의 조직에서 Claude Code 사용이 허용되지 않았습니다.',
  billing_error: '결제 정보에 문제가 있습니다.',
  rate_limit: '사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
  overloaded: 'API가 과부하 상태입니다. 잠시 후 다시 시도하세요.',
  model_not_found: '선택한 모델을 찾을 수 없습니다.',
};

/** 패널 이벤트를 화면 항목 목록으로 접는다. DOM을 모른다. */
export class ChatState {
  readonly items: ChatItem[] = [];
  busy = false;
  private readonly byId = new Map<string, ChatItem>();
  private seq = 0;
  private turnNo = 0;
  private interrupted = false;

  constructor(private readonly now: () => number = Date.now) {}

  get(id: string): ChatItem | undefined {
    return this.byId.get(id);
  }

  clear(): void {
    this.items.length = 0;
    this.byId.clear();
    this.busy = false;
    this.interrupted = false;
  }

  /** ChatView가 직접 띄우는 알림 (예: 경로 자동 찾기 결과). */
  notice(level: 'info' | 'error', text: string, action: NoticeAction | null = null): string {
    return this.add({ id: this.nextId('n'), type: 'notice', level, text, action });
  }

  /** 이벤트를 반영하고 바뀌거나 추가된 항목 id를 돌려준다. */
  apply(e: PanelEvent): string[] {
    switch (e.kind) {
      case 'turn-start':
        this.busy = true;
        this.interrupted = false;
        this.turnNo += 1;
        return [this.add({ id: this.nextId('u'), type: 'user', text: e.text, contextLabel: e.contextLabel })];
      case 'user-text':
        return [this.add({ id: this.nextId('u'), type: 'user', text: e.text, contextLabel: null })];
      case 'block-start': {
        const id = `b:${e.key}`;
        if (this.byId.has(id)) return [];
        return [this.add({ id, type: 'block', blockType: e.blockType, text: '', streaming: true, startedAt: this.now(), endedAt: null })];
      }
      case 'block-delta': {
        const item = this.find('block', `b:${e.key}`);
        if (!item) return [];
        item.text += e.text;
        return [item.id];
      }
      case 'block-final': {
        const id = `b:${e.key}`;
        const item = this.find('block', id);
        if (item) {
          item.text = e.text;
          item.streaming = false;
          item.endedAt = this.now();
          return [id];
        }
        return [this.add({ id, type: 'block', blockType: e.blockType, text: e.text, streaming: false, startedAt: this.now(), endedAt: null })];
      }
      case 'tool-start': {
        const id = `t:${e.toolUseId}`;
        if (this.byId.has(id)) return [];
        return [this.add({ id, type: 'tool', toolUseId: e.toolUseId, name: e.name, input: e.input, status: 'running', output: null })];
      }
      case 'tool-result': {
        const item = this.find('tool', `t:${e.toolUseId}`);
        if (!item || item.status === 'cancelled') return [];
        item.status = e.isError ? 'error' : 'done';
        item.output = e.output;
        return [item.id];
      }
      case 'retry': {
        const id = `n:retry:${this.turnNo}`;
        const text = `재시도 중 (${e.attempt}/${e.maxRetries})…`;
        const item = this.find('notice', id);
        if (item) {
          item.text = text;
          return [id];
        }
        return [this.add({ id, type: 'notice', level: 'info', text, action: null })];
      }
      case 'assistant-error':
        return [this.notice('error', ASSISTANT_ERRORS[e.error] ?? `API 오류: ${e.error}`)];
      case 'approval-request':
        return [this.add({ id: `a:${e.request.id}`, type: 'approval', request: e.request, settled: null })];
      case 'approval-settled': {
        const item = this.find('approval', `a:${e.id}`);
        if (!item) return [];
        item.settled = e.summary;
        return [item.id];
      }
      case 'interrupted': {
        this.interrupted = true;
        const changed = this.stopActivity();
        changed.push(this.notice('info', '중단됨'));
        return changed;
      }
      case 'turn-end': {
        this.busy = false;
        const changed = this.stopActivity();
        if (!e.ok && !this.interrupted) {
          changed.push(this.notice('error', e.errors.length > 0 ? e.errors.map(friendlyError).join('\n') : `오류로 끝남 (${e.subtype})`));
        }
        changed.push(this.add({ id: this.nextId('f'), type: 'footer', usage: e.usage, ok: e.ok }));
        return changed;
      }
      case 'stream-error': {
        this.busy = false;
        const changed = this.stopActivity();
        changed.push(this.notice('error', e.message, e.code === 'ENOENT' ? 'find-claude' : 'reconnect'));
        return changed;
      }
      default:
        return []; // init, mode-changed, context-usage는 ChatView가 상단 막대에 반영
    }
  }

  /** 진행 중이던 블록·도구·승인을 멈춘 상태로 바꾼다. */
  private stopActivity(): string[] {
    const changed: string[] = [];
    for (const item of this.items) {
      if (item.type === 'block' && item.streaming) {
        item.streaming = false;
        item.endedAt = this.now();
        changed.push(item.id);
      } else if (item.type === 'tool' && item.status === 'running') {
        item.status = 'cancelled';
        changed.push(item.id);
      } else if (item.type === 'approval' && item.settled === null) {
        item.settled = '취소됨';
        changed.push(item.id);
      }
    }
    return changed;
  }

  private add(item: ChatItem): string {
    this.items.push(item);
    this.byId.set(item.id, item);
    return item.id;
  }

  private find<T extends ChatItem['type']>(type: T, id: string): ItemOf<T> | undefined {
    const item = this.byId.get(id);
    return item && item.type === type ? (item as ItemOf<T>) : undefined;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}:${this.seq}`;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/chat/ChatState.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add src/chat/ChatState.ts tests/chat/ChatState.test.ts
git commit -m "feat: fold panel events into chat items

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 5: InputQueue + ApprovalBroker

**Files:**
- Create: `src/session/InputQueue.ts`, `src/session/ApprovalBroker.ts`
- Test: `tests/session/InputQueue.test.ts`, `tests/session/ApprovalBroker.test.ts`

**Interfaces:**
- Consumes: `PanelEvent`, `ApprovalRequest` (Task 3)
- Produces:
```ts
export class InputQueue<T> implements AsyncIterable<T> { push(value: T): void; end(): void; readonly isEnded: boolean }
export type ApprovalDecision =
  | { type: 'allow' } | { type: 'allow-always' } | { type: 'deny'; message: string }
  | { type: 'answer'; answers: Record<string, string> }
  | { type: 'plan-approve' } | { type: 'plan-revise'; feedback: string };
export interface BrokerHooks { emit(e: PanelEvent): void; onPlanApproved(): Promise<void> | void }
export class ApprovalBroker {
  constructor(hooks: BrokerHooks);
  readonly handle: CanUseTool;
  decide(id: string, decision: ApprovalDecision): void;
  denyAll(reason: string): void;
  readonly pendingCount: number;
}
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/session/InputQueue.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { InputQueue } from '../../src/session/InputQueue';

describe('InputQueue', () => {
  it('먼저 넣은 값과 나중에 넣은 값을 순서대로 내보내고 end로 끝난다', async () => {
    const q = new InputQueue<number>();
    q.push(1);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 1, done: false });
    const pending = it.next();
    q.push(2);
    expect(await pending).toEqual({ value: 2, done: false });
    const last = it.next();
    q.end();
    expect(await last).toEqual({ value: undefined, done: true });
    expect(q.isEnded).toBe(true);
  });

  it('끝난 큐에 넣으면 예외', () => {
    const q = new InputQueue<number>();
    q.end();
    expect(() => q.push(1)).toThrow();
  });
});
```

`tests/session/ApprovalBroker.test.ts`:
```ts
import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalBroker } from '../../src/session/ApprovalBroker';
import type { PanelEvent } from '../../src/types';

type ToolOptions = Parameters<CanUseTool>[2];
const suggestion: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }], behavior: 'allow', destination: 'localSettings' };

function setup() {
  const events: PanelEvent[] = [];
  const onPlanApproved = vi.fn();
  const broker = new ApprovalBroker({ emit: (e) => events.push(e), onPlanApproved });
  const controller = new AbortController();
  const opts = (extra: Partial<ToolOptions> = {}): ToolOptions =>
    ({ signal: controller.signal, toolUseID: 'tu1', requestId: 'r1', ...extra }) as ToolOptions;
  const lastRequestId = () => {
    const req = [...events].reverse().find((e) => e.kind === 'approval-request');
    return req && req.kind === 'approval-request' ? req.request.id : '';
  };
  return { broker, events, onPlanApproved, controller, opts, lastRequestId };
}

describe('ApprovalBroker', () => {
  it('요청을 알리고 허용 결정을 입력 그대로 돌려준다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Bash', { command: 'ls' }, opts({ title: 'Claude wants to run ls', decisionReason: 'no rule' }));
    expect(events[0]).toMatchObject({ kind: 'approval-request', request: { toolName: 'Bash', title: 'Claude wants to run ls', reason: 'no rule', canAlwaysAllow: false } });
    broker.decide(lastRequestId(), { type: 'allow' });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(events[1]).toEqual({ kind: 'approval-settled', id: lastRequestId(), summary: '허용함' });
    expect(broker.pendingCount).toBe(0);
  });

  it('항상 허용은 suggestions를 updatedPermissions로 돌려준다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Bash', { command: 'ls' }, opts({ suggestions: [suggestion] }));
    expect(events[0]).toMatchObject({ request: { canAlwaysAllow: true } });
    broker.decide(lastRequestId(), { type: 'allow-always' });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: [suggestion] });
  });

  it('suppressAlwaysAllowRule이면 항상 허용을 막는다', () => {
    const { broker, events, opts } = setup();
    void broker.handle('Bash', {}, opts({ suggestions: [suggestion], suppressAlwaysAllowRule: true }));
    expect(events[0]).toMatchObject({ request: { canAlwaysAllow: false } });
  });

  it('거부 사유를 Claude에 전달한다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Write', {}, opts());
    broker.decide(lastRequestId(), { type: 'deny', message: '그 파일은 건드리지 마' });
    expect(await p).toEqual({ behavior: 'deny', message: '그 파일은 건드리지 마' });
    expect(events[1]).toMatchObject({ summary: '거부함: 그 파일은 건드리지 마' });
  });

  it('AskUserQuestion 답을 updatedInput.answers로 넘긴다', async () => {
    const { broker, opts, lastRequestId } = setup();
    const input = { questions: [{ question: '어느 쪽?', header: 'H', options: [], multiSelect: false }] };
    const p = broker.handle('AskUserQuestion', input, opts());
    broker.decide(lastRequestId(), { type: 'answer', answers: { '어느 쪽?': 'A' } });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { '어느 쪽?': 'A' } } });
  });

  it('Plan 승인은 허용 후 onPlanApproved를 부르고, 계속 계획은 의견과 함께 거부한다', async () => {
    const { broker, onPlanApproved, opts, lastRequestId } = setup();
    const p1 = broker.handle('ExitPlanMode', { plan: 'x' }, opts());
    broker.decide(lastRequestId(), { type: 'plan-approve' });
    expect(await p1).toEqual({ behavior: 'allow', updatedInput: { plan: 'x' } });
    expect(onPlanApproved).toHaveBeenCalledOnce();
    const p2 = broker.handle('ExitPlanMode', { plan: 'x' }, opts());
    broker.decide(lastRequestId(), { type: 'plan-revise', feedback: '테스트 단계 추가' });
    expect(await p2).toEqual({ behavior: 'deny', message: '테스트 단계 추가' });
  });

  it('signal abort 시 자동으로 거부하고 카드를 닫는다', async () => {
    const { broker, events, controller, opts } = setup();
    const p = broker.handle('Bash', {}, opts());
    controller.abort();
    expect(await p).toMatchObject({ behavior: 'deny' });
    expect(events[1]).toMatchObject({ kind: 'approval-settled', summary: '취소됨' });
  });

  it('denyAll은 대기 중 요청을 모두 interrupt 거부한다', async () => {
    const { broker, opts } = setup();
    const a = broker.handle('Bash', {}, opts());
    const b = broker.handle('Write', {}, opts());
    broker.denyAll('사용자가 중단함');
    expect(await a).toEqual({ behavior: 'deny', message: '사용자가 중단함', interrupt: true });
    expect(await b).toMatchObject({ behavior: 'deny' });
    expect(broker.pendingCount).toBe(0);
  });

  it('없는 id의 결정은 무시한다', () => {
    const { broker } = setup();
    expect(() => broker.decide('nope', { type: 'allow' })).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/session/InputQueue.test.ts tests/session/ApprovalBroker.test.ts`
Expected: FAIL — 두 모듈 모두 `Failed to resolve import`

- [ ] **Step 3: 구현**

`src/session/InputQueue.ts`:
```ts
/** SDK 스트리밍 입력(AsyncIterable<SDKUserMessage>)에 메시지를 밀어 넣는 큐. */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private ended = false;

  get isEnded(): boolean {
    return this.ended;
  }

  push(value: T): void {
    if (this.ended) throw new Error('InputQueue: 이미 종료됨');
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
```

`src/session/ApprovalBroker.ts`:
```ts
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalRequest, PanelEvent } from '../types';

export type ApprovalDecision =
  | { type: 'allow' }
  | { type: 'allow-always' }
  | { type: 'deny'; message: string }
  | { type: 'answer'; answers: Record<string, string> }
  | { type: 'plan-approve' }
  | { type: 'plan-revise'; feedback: string };

export interface BrokerHooks {
  emit(e: PanelEvent): void;
  /** ExitPlanMode 승인 직후: 계획 모드 이전 권한 모드로 되돌린다. */
  onPlanApproved(): Promise<void> | void;
}

interface Pending {
  request: ApprovalRequest;
  resolve: (result: PermissionResult) => void;
  cleanup: () => void;
}

/** canUseTool 호출마다 Promise를 만들고 UI 결정으로 완료한다. 규칙·권한 모드가 이미 허용한 도구는 여기 오지 않는다. */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly hooks: BrokerHooks) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  readonly handle: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      this.seq += 1;
      const id = `apr-${this.seq}`;
      const suggestions = options.suggestions ?? [];
      const request: ApprovalRequest = {
        id,
        toolName,
        input,
        title: options.title ?? null,
        reason: options.decisionReason ?? null,
        suggestions,
        canAlwaysAllow: suggestions.length > 0 && options.suppressAlwaysAllowRule !== true,
      };
      const onAbort = () => this.settle(id, { behavior: 'deny', message: 'Request aborted' }, '취소됨');
      options.signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { request, resolve, cleanup: () => options.signal.removeEventListener('abort', onAbort) });
      this.hooks.emit({ kind: 'approval-request', request });
      if (options.signal.aborted) onAbort();
    });

  decide(id: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    const input = pending.request.input;
    switch (decision.type) {
      case 'allow':
        this.settle(id, { behavior: 'allow', updatedInput: input }, '허용함');
        return;
      case 'allow-always':
        this.settle(id, { behavior: 'allow', updatedInput: input, updatedPermissions: pending.request.suggestions }, '항상 허용함');
        return;
      case 'deny':
        this.settle(id, { behavior: 'deny', message: decision.message || 'User denied this action.' }, decision.message ? `거부함: ${decision.message}` : '거부함');
        return;
      case 'answer':
        this.settle(id, { behavior: 'allow', updatedInput: { ...input, answers: decision.answers } }, '답변함');
        return;
      case 'plan-approve':
        this.settle(id, { behavior: 'allow', updatedInput: input }, '계획 승인함');
        void this.hooks.onPlanApproved();
        return;
      case 'plan-revise':
        this.settle(id, { behavior: 'deny', message: decision.feedback || 'Keep planning.' }, '계획 계속');
        return;
    }
  }

  /** 중단·종료 시 대기 중인 승인을 모두 거부한다. */
  denyAll(reason: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { behavior: 'deny', message: reason, interrupt: true }, '취소됨');
  }

  private settle(id: string, result: PermissionResult, summary: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.resolve(result);
    this.hooks.emit({ kind: 'approval-settled', id, summary });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/session/InputQueue.test.ts tests/session/ApprovalBroker.test.ts`
Expected: PASS (2 + 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/session/InputQueue.ts src/session/ApprovalBroker.ts tests/session/InputQueue.test.ts tests/session/ApprovalBroker.test.ts
git commit -m "feat: add streaming input queue and approval broker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 6: buildOptions + ClaudeSession

**Files:**
- Create: `src/session/buildOptions.ts`, `src/session/ClaudeSession.ts`
- Test: `tests/session/buildOptions.test.ts`, `tests/session/ClaudeSession.test.ts`

**Interfaces:**
- Consumes: `QueryFn` (Task 1), `Normalizer` (Task 3), `InputQueue`, `ApprovalBroker` (Task 5), `PanelEvent` (Task 3)
- Produces:
```ts
// buildOptions.ts
export interface SessionConfig { cwd: string; claudePath: string; env: Record<string, string | undefined>; useHooks: boolean; defaultModel: string }
export interface SessionOverrides { model?: string; effort?: EffortLevel; permissionMode?: PermissionMode; resume?: string }
export function buildOptions(config: SessionConfig, overrides: SessionOverrides, canUseTool: CanUseTool, stderr?: (data: string) => void): Options;
// ClaudeSession.ts
export interface ClaudeSessionDeps { query: QueryFn; getConfig: () => SessionConfig; onStderr?: (data: string) => void }
export interface OutgoingMessage { prompt: string; display: string; contextLabel: string | null }
export class ClaudeSession {
  readonly broker: ApprovalBroker;
  sessionId: string | null; permissionMode: PermissionMode | null; model: string | null; cliVersion: string | null;
  readonly isBusy: boolean; readonly isStarted: boolean;
  constructor(deps: ClaudeSessionDeps);
  on(listener: (e: PanelEvent) => void): () => void;
  resumeFrom(sessionId: string): void;
  ensureStarted(): void;
  send(msg: OutgoingMessage): void;
  interrupt(): Promise<void>;
  setModel(model: string | undefined): Promise<void>;
  setEffort(effort: EffortLevel | undefined): Promise<void>;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  supportedCommands(): Promise<SlashCommand[]>;
  supportedModels(): Promise<ModelInfo[]>;
  reconnect(): void;
  close(): void;
}
export function errorMessage(err: unknown): string;
export function errorCode(err: unknown): string | null;
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/session/buildOptions.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildOptions, type SessionConfig } from '../../src/session/buildOptions';

const config: SessionConfig = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' }, useHooks: true, defaultModel: '' };
const canUseTool = async () => ({ behavior: 'allow' as const });

describe('buildOptions', () => {
  it('터미널과 같은 기본 옵션을 만들고, 바꾸지 않은 모델·권한 모드는 넘기지 않는다', () => {
    const o = buildOptions(config, {}, canUseTool);
    expect(o).toMatchObject({
      cwd: '/vault',
      pathToClaudeCodeExecutable: '/bin/claude',
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      env: { PATH: '/bin' },
    });
    expect(o.canUseTool).toBe(canUseTool);
    for (const key of ['model', 'permissionMode', 'effort', 'resume', 'settings']) expect(o).not.toHaveProperty(key);
  });

  it('기본 모델 설정과 재정의를 반영한다 (재정의 우선)', () => {
    expect(buildOptions({ ...config, defaultModel: 'sonnet' }, {}, canUseTool).model).toBe('sonnet');
    const o = buildOptions({ ...config, defaultModel: 'sonnet' }, { model: 'opus', effort: 'low', permissionMode: 'plan', resume: 's1' }, canUseTool);
    expect(o).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'plan', resume: 's1' });
  });

  it('hook 사용 off면 disableAllHooks를 덧붙인다', () => {
    expect(buildOptions({ ...config, useHooks: false }, {}, canUseTool).settings).toEqual({ disableAllHooks: true });
  });

  it('stderr 콜백을 전달한다', () => {
    const stderr = () => undefined;
    expect(buildOptions(config, {}, canUseTool, stderr).stderr).toBe(stderr);
  });
});
```

`tests/session/ClaudeSession.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../src/session/buildOptions';
import { ClaudeSession, errorCode } from '../../src/session/ClaudeSession';
import type { PanelEvent } from '../../src/types';
import { fakeQueryFn, tick } from '../helpers/fakeQuery';

const config: SessionConfig = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' }, useHooks: true, defaultModel: '' };
const init = (mode = 'auto') => ({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5', permissionMode: mode, slash_commands: [], claude_code_version: '2.1.278' });
const result = { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: {}, total_cost_usd: 0, duration_ms: 10 };
const msg = (prompt: string) => ({ prompt, display: prompt, contextLabel: null });

function setup(cfg: SessionConfig = config) {
  const { fn, calls } = fakeQueryFn();
  const session = new ClaudeSession({ query: fn, getConfig: () => cfg });
  const events: PanelEvent[] = [];
  session.on((e) => events.push(e));
  return { session, calls, events };
}

describe('ClaudeSession', () => {
  it('첫 전송 때 query를 시작하고 사용자 메시지를 입력 큐로 보낸다', async () => {
    const { session, calls, events } = setup();
    expect(calls).toHaveLength(0);
    session.send(msg('안녕'));
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].params.options).toMatchObject({ cwd: '/vault', includePartialMessages: true });
    expect(calls[0].sent).toEqual([{ type: 'user', message: { role: 'user', content: '안녕' }, parent_tool_use_id: null }]);
    expect(events[0]).toEqual({ kind: 'turn-start', text: '안녕', contextLabel: null });
    expect(session.isBusy).toBe(true);
  });

  it('스트림 이벤트를 전달하고 init·turn-end로 상태를 갱신하며 컨텍스트 사용률을 알린다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init('auto'));
    calls[0].emit(result);
    await tick();
    await tick();
    expect(session.sessionId).toBe('sess-1');
    expect(session.permissionMode).toBe('auto');
    expect(session.isBusy).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(['turn-start', 'init', 'turn-end', 'context-usage']);
    expect(events[3]).toEqual({ kind: 'context-usage', percentage: 42 });
  });

  it('시작 전에 바꾼 모델·추론 강도·권한 모드를 시작 옵션에 담는다', async () => {
    const { session, calls } = setup();
    await session.setModel('sonnet');
    await session.setEffort('low');
    await session.setPermissionMode('plan');
    session.send(msg('x'));
    expect(calls[0].params.options).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'plan' });
  });

  it('시작 후 변경은 Query 제어 메서드로 즉시 보낸다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    await session.setModel('haiku');
    await session.setEffort('max');
    await session.setPermissionMode('acceptEdits');
    expect(calls[0].setModel).toHaveBeenCalledWith('haiku');
    expect(calls[0].applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' });
    expect(calls[0].setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(events).toContainEqual({ kind: 'mode-changed', permissionMode: 'acceptEdits' });
  });

  it('중단하면 interrupted를 알리고 대기 승인을 거부한 뒤 interrupt를 호출한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    const approval = session.broker.handle('Bash', {}, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' } as never);
    await session.interrupt();
    expect(events).toContainEqual({ kind: 'interrupted' });
    expect(await approval).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(calls[0].interrupt).toHaveBeenCalledOnce();
  });

  it('대기 중이 아니면 interrupt는 아무것도 하지 않는다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(result);
    await tick();
    await session.interrupt();
    expect(calls[0].interrupt).not.toHaveBeenCalled();
  });

  it('스트림 예외 시 stream-error를 알리고, 다음 전송은 마지막 세션을 resume한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    await tick();
    calls[0].fail(new Error('process exited'));
    await tick();
    expect(events[events.length - 1]).toEqual({ kind: 'stream-error', message: 'process exited', code: null });
    expect(session.isStarted).toBe(false);
    session.send(msg('again'));
    expect(calls).toHaveLength(2);
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('대기 중이 아닐 때 프로세스가 끝나면 조용히 분리하고 다음 전송에서 resume한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    calls[0].emit(result);
    await tick();
    calls[0].end();
    await tick();
    expect(events.some((e) => e.kind === 'stream-error')).toBe(false);
    session.send(msg('y'));
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('reconnect는 전송 없이 resume으로 새 프로세스를 띄운다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    await tick();
    calls[0].fail(new Error('boom'));
    await tick();
    session.reconnect();
    expect(calls).toHaveLength(2);
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('query가 동기적으로 던지면 stream-error로 알리고 멈춘다', () => {
    const session = new ClaudeSession({
      query: (() => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); }) as never,
      getConfig: () => config,
    });
    const events: PanelEvent[] = [];
    session.on((e) => events.push(e));
    session.send(msg('x'));
    expect(events[events.length - 1]).toEqual({ kind: 'stream-error', message: 'spawn claude ENOENT', code: 'ENOENT' });
    expect(session.isBusy).toBe(false);
  });

  it('resumeFrom은 시작 옵션의 resume으로 전달된다', () => {
    const { session, calls } = setup();
    session.resumeFrom('old-1');
    expect(session.sessionId).toBe('old-1');
    session.send(msg('x'));
    expect(calls[0].params.options?.resume).toBe('old-1');
  });

  it('Plan 승인 뒤 계획 모드 이전의 권한 모드로 되돌린다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(init('auto'));
    await tick();
    await session.setPermissionMode('plan');
    const p = session.broker.handle('ExitPlanMode', { plan: 'p' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' } as never);
    session.broker.decide('apr-1', { type: 'plan-approve' });
    await p;
    await tick();
    expect(calls[0].setPermissionMode).toHaveBeenLastCalledWith('auto');
    expect(session.permissionMode).toBe('auto');
  });

  it('close는 프로세스를 닫고 이후 전송을 막는다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    session.close();
    expect(calls[0].close).toHaveBeenCalledOnce();
    expect(() => session.send(msg('y'))).toThrow();
  });

  it('ensureStarted 후 supportedCommands를 조회할 수 있다', async () => {
    const { session, calls } = setup();
    expect(await session.supportedCommands()).toEqual([]);
    session.ensureStarted();
    expect(calls).toHaveLength(1);
    expect((await session.supportedCommands())[0].name).toBe('ingest');
  });
});

describe('errorCode', () => {
  it('code 속성이나 메시지로 ENOENT를 식별한다', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errorCode(new Error('Claude Code executable not found at /x'))).toBe('ENOENT');
    expect(errorCode(new Error('other'))).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/session/buildOptions.test.ts tests/session/ClaudeSession.test.ts`
Expected: FAIL — 두 모듈 모두 `Failed to resolve import`

- [ ] **Step 3: buildOptions 구현**

`src/session/buildOptions.ts`:
```ts
import type { CanUseTool, EffortLevel, Options, PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export interface SessionConfig {
  cwd: string;
  /** 절대 경로 (SDK가 존재 여부를 검사한다) */
  claudePath: string;
  env: Record<string, string | undefined>;
  useHooks: boolean;
  /** 비우면 CLI 설정을 따른다 */
  defaultModel: string;
}

/** 패널에서 바꾼 값. 바꾸지 않은 항목은 넘기지 않아 터미널과 같은 설정을 따른다. */
export interface SessionOverrides {
  model?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  resume?: string;
}

export function buildOptions(config: SessionConfig, overrides: SessionOverrides, canUseTool: CanUseTool, stderr?: (data: string) => void): Options {
  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.claudePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    canUseTool,
    env: config.env,
  };
  const model = overrides.model ?? (config.defaultModel || undefined);
  if (model) options.model = model;
  if (overrides.effort) options.effort = overrides.effort;
  if (overrides.permissionMode) options.permissionMode = overrides.permissionMode;
  if (overrides.resume) options.resume = overrides.resume;
  if (!config.useHooks) options.settings = { disableAllHooks: true };
  if (stderr) options.stderr = stderr;
  return options;
}
```

- [ ] **Step 4: ClaudeSession 구현**

`src/session/ClaudeSession.ts`:
```ts
import type { EffortLevel, ModelInfo, PermissionMode, Query, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { PanelEvent } from '../types';
import { ApprovalBroker } from './ApprovalBroker';
import { buildOptions, type SessionConfig, type SessionOverrides } from './buildOptions';
import { InputQueue } from './InputQueue';
import { Normalizer } from './normalize';
import type { QueryFn } from './oneShot';

export interface ClaudeSessionDeps {
  query: QueryFn;
  /** 시작할 때마다 호출해 최신 설정을 읽는다 */
  getConfig: () => SessionConfig;
  onStderr?: (data: string) => void;
}

export interface OutgoingMessage {
  /** Claude에 보낼 텍스트 (컨텍스트 포함) */
  prompt: string;
  /** 대화 목록에 보일 텍스트 */
  display: string;
  contextLabel: string | null;
}

type Listener = (e: PanelEvent) => void;

/** 패널 1개 = 세션 1개. SDK query()를 호출하는 유일한 객체. */
export class ClaudeSession {
  readonly broker: ApprovalBroker;
  sessionId: string | null = null;
  permissionMode: PermissionMode | null = null;
  model: string | null = null;
  cliVersion: string | null = null;

  private q: Query | null = null;
  private input: InputQueue<SDKUserMessage> | null = null;
  private normalizer = new Normalizer();
  private readonly listeners = new Set<Listener>();
  private readonly overrides: SessionOverrides = {};
  private modeBeforePlan: PermissionMode | null = null;
  private busy = false;
  private closed = false;

  constructor(private readonly deps: ClaudeSessionDeps) {
    this.broker = new ApprovalBroker({ emit: (e) => this.emit(e), onPlanApproved: () => this.restoreModeAfterPlan() });
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get isStarted(): boolean {
    return this.q !== null;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 과거 세션을 이어서 대화한다. 다음 시작 때 resume으로 전달된다. */
  resumeFrom(sessionId: string): void {
    this.sessionId = sessionId;
    this.overrides.resume = sessionId;
  }

  /** 첫 전송 전에 프로세스가 필요할 때(예: `/` 자동완성 목록). */
  ensureStarted(): void {
    if (this.closed) throw new Error('세션이 닫혔습니다.');
    if (!this.q) this.start();
  }

  send(msg: OutgoingMessage): void {
    if (this.closed) throw new Error('세션이 닫혔습니다.');
    this.busy = true;
    this.emit({ kind: 'turn-start', text: msg.display, contextLabel: msg.contextLabel });
    if (!this.q) this.start();
    if (!this.input) return; // 시작 실패는 start()가 stream-error로 알렸다
    this.input.push({ type: 'user', message: { role: 'user', content: msg.prompt }, parent_tool_use_id: null });
  }

  async interrupt(): Promise<void> {
    if (!this.q || !this.busy) return;
    const q = this.q;
    this.emit({ kind: 'interrupted' });
    this.broker.denyAll('사용자가 중단함');
    try {
      await q.interrupt();
    } catch (err) {
      this.deps.onStderr?.(`interrupt 실패: ${errorMessage(err)}`);
    }
  }

  async setModel(model: string | undefined): Promise<void> {
    this.overrides.model = model;
    if (this.q) await this.q.setModel(model);
  }

  async setEffort(effort: EffortLevel | undefined): Promise<void> {
    this.overrides.effort = effort;
    if (this.q) await this.q.applyFlagSettings({ effortLevel: effort ?? null });
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (mode === 'plan' && this.permissionMode !== 'plan') this.modeBeforePlan = this.permissionMode ?? 'default';
    this.overrides.permissionMode = mode;
    this.permissionMode = mode;
    this.emit({ kind: 'mode-changed', permissionMode: mode });
    if (this.q) await this.q.setPermissionMode(mode);
  }

  async supportedCommands(): Promise<SlashCommand[]> {
    return this.q ? this.q.supportedCommands() : [];
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return this.q ? this.q.supportedModels() : [];
  }

  /** 프로세스가 죽은 뒤 [다시 연결]: 마지막 세션 ID로 resume해 새 프로세스를 띄운다. */
  reconnect(): void {
    if (!this.q && !this.closed) this.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.broker.denyAll('패널이 닫힘');
    const q = this.q;
    this.detach();
    q?.close();
  }

  private restoreModeAfterPlan(): Promise<void> {
    const previous = this.modeBeforePlan ?? 'default';
    this.modeBeforePlan = null;
    return this.setPermissionMode(previous);
  }

  private start(): void {
    const input = new InputQueue<SDKUserMessage>();
    this.input = input;
    this.normalizer = new Normalizer();
    let q: Query;
    try {
      const options = buildOptions(this.deps.getConfig(), this.overrides, this.broker.handle, this.deps.onStderr);
      q = this.deps.query({ prompt: input, options });
    } catch (err) {
      this.fail(errorMessage(err), errorCode(err));
      return;
    }
    this.overrides.resume = undefined;
    this.q = q;
    void this.pump(q);
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q) {
        if (this.q !== q) return;
        for (const e of this.normalizer.push(msg)) this.handle(q, e);
      }
      if (this.q !== q) return;
      if (this.busy) this.fail('Claude 프로세스가 종료되었습니다.', null);
      else this.detach();
    } catch (err) {
      if (this.q === q) this.fail(errorMessage(err), errorCode(err));
    }
  }

  private handle(q: Query, e: PanelEvent): void {
    if (e.kind === 'init') {
      this.sessionId = e.sessionId;
      this.model = e.model;
      this.cliVersion = e.cliVersion;
      this.permissionMode = e.permissionMode as PermissionMode;
    } else if (e.kind === 'mode-changed') {
      this.permissionMode = e.permissionMode as PermissionMode;
    } else if (e.kind === 'turn-end') {
      this.busy = false;
    }
    this.emit(e);
    if (e.kind === 'turn-end') void this.refreshContextUsage(q);
  }

  private fail(message: string, code: string | null): void {
    this.detach();
    this.broker.denyAll('Claude 프로세스 종료');
    this.busy = false;
    this.emit({ kind: 'stream-error', message, code });
  }

  private detach(): void {
    this.input?.end();
    this.input = null;
    this.q = null;
    if (this.sessionId && !this.closed) this.overrides.resume = this.sessionId;
  }

  private async refreshContextUsage(q: Query): Promise<void> {
    try {
      const usage = await q.getContextUsage();
      if (this.q === q) this.emit({ kind: 'context-usage', percentage: usage.percentage });
    } catch {
      // 컨텍스트 사용률은 부가 정보라 실패해도 무시한다
    }
  }

  private emit(e: PanelEvent): void {
    for (const listener of this.listeners) listener(e);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return /ENOENT|executable not found/i.test(errorMessage(err)) ? 'ENOENT' : null;
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run tests/session/buildOptions.test.ts tests/session/ClaudeSession.test.ts`
Expected: PASS (4 + 15 tests)

- [ ] **Step 6: 전체 테스트·빌드 후 Commit**

Run: `npm test && npm run build`
Expected: 전부 PASS, `check-bundle: OK`, `smoke-load: OK`

```bash
git add src/session/buildOptions.ts src/session/ClaudeSession.ts tests/session/buildOptions.test.ts tests/session/ClaudeSession.test.ts
git commit -m "feat: wrap SDK query in a lazily started ClaudeSession

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 7: 실제 CLI 통합 테스트 (`npm run test:live`)

**Files:**
- Create: `vitest.live.config.ts`, `tests/live/session.live.test.ts`

**Interfaces:**
- Consumes: `ClaudeSession`, `SessionConfig` (Task 6), `buildEnv`, `resolveOnPath`, `findClaudeViaLoginShell` (Task 1)

- [ ] **Step 1: 설정·테스트 작성**

`vitest.live.config.ts`:
```ts
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
```

`tests/live/session.live.test.ts`:
```ts
// 실제 claude CLI를 띄운다. 임시 폴더(vault 아님)에서 가장 가벼운 모델로, hook을 끄고 실행한다.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../src/session/buildOptions';
import { ClaudeSession } from '../../src/session/ClaudeSession';
import type { PanelEvent } from '../../src/types';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from '../../src/util/claudePath';

const cwd = mkdtempSync(join(tmpdir(), 'claude-panel-live-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

async function config(): Promise<SessionConfig> {
  const env = buildEnv();
  const claudePath = resolveOnPath('claude', env.PATH ?? '') ?? (await findClaudeViaLoginShell());
  if (!claudePath) throw new Error('claude 실행 파일을 찾지 못함');
  return { cwd, claudePath, env, useHooks: false, defaultModel: 'haiku' };
}

async function newSession(): Promise<ClaudeSession> {
  const cfg = await config();
  return new ClaudeSession({ query, getConfig: () => cfg });
}

function waitFor(session: ClaudeSession, pred: (e: PanelEvent) => boolean, ms = 120_000): Promise<PanelEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('timeout'));
    }, ms);
    const off = session.on((e) => {
      if (pred(e)) {
        clearTimeout(timer);
        off();
        resolve(e);
      }
    });
  });
}

function textOf(events: PanelEvent[]): string {
  return events.map((e) => (e.kind === 'block-final' && e.blockType === 'text' ? e.text : '')).join('');
}

function collect(session: ClaudeSession): PanelEvent[] {
  const all: PanelEvent[] = [];
  session.on((e) => all.push(e));
  return all;
}

function childPids(): string[] {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return []; // pgrep은 결과가 없으면 종료 코드 1
  }
}

describe('실제 CLI', () => {
  let firstSessionId = '';

  it('텍스트 응답', async () => {
    const s = await newSession();
    const events = collect(s);
    s.send({ prompt: 'Reply with exactly: pong', display: 'pong?', contextLabel: null });
    expect(await waitFor(s, (e) => e.kind === 'turn-end')).toMatchObject({ ok: true });
    expect(textOf(events).toLowerCase()).toContain('pong');
    firstSessionId = s.sessionId ?? '';
    s.close();
  });

  it('default 모드 파일 쓰기는 canUseTool 승인을 거친다', async () => {
    const s = await newSession();
    await s.setPermissionMode('default');
    s.on((e) => {
      if (e.kind === 'approval-request') s.broker.decide(e.request.id, { type: 'allow' });
    });
    const approval = waitFor(s, (e) => e.kind === 'approval-request');
    s.send({ prompt: 'Use the Write tool to create a file named out.txt containing the word hi. Do nothing else.', display: 'write', contextLabel: null });
    expect(await approval).toMatchObject({ request: { toolName: 'Write' } });
    await waitFor(s, (e) => e.kind === 'turn-end');
    expect(existsSync(join(cwd, 'out.txt'))).toBe(true);
    s.close();
  });

  it('이어하기', async () => {
    expect(firstSessionId).not.toBe('');
    const s = await newSession();
    s.resumeFrom(firstSessionId);
    const events = collect(s);
    s.send({ prompt: 'What exact word did you reply with in your previous message? Answer with that word only.', display: 'recall', contextLabel: null });
    await waitFor(s, (e) => e.kind === 'turn-end');
    expect(textOf(events).toLowerCase()).toContain('pong');
    s.close();
  });

  it('중단', async () => {
    const s = await newSession();
    const firstDelta = waitFor(s, (e) => e.kind === 'block-delta');
    s.send({ prompt: 'Write the numbers from 1 to 400, one per line.', display: 'count', contextLabel: null });
    await firstDelta;
    const end = waitFor(s, (e) => e.kind === 'turn-end' || e.kind === 'stream-error', 60_000);
    await s.interrupt();
    await end;
    expect(s.isBusy).toBe(false);
    s.close();
  });

  it('close 후 자식 프로세스가 남지 않는다', async () => {
    const s = await newSession();
    s.send({ prompt: 'Reply with exactly: ok', display: 'ok', contextLabel: null });
    await waitFor(s, (e) => e.kind === 'turn-end');
    s.close();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(childPids()).toEqual([]);
  });
});
```

- [ ] **Step 2: 실행**

Run: `npm run test:live`
Expected: 5 tests PASS (수 분 소요, 소량의 haiku 사용량 발생). 실패하면 superpowers:systematic-debugging으로 원인을 찾고, 필요하면 `scripts/record-fixture.sh` 방식으로 실제 메시지를 확인한다.

- [ ] **Step 3: Commit**

```bash
git add vitest.live.config.ts tests/live/session.live.test.ts
git commit -m "test: add live CLI integration scenarios

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 2단계 — 기본 채팅 UI

### Task 8: 표시용 순수 함수 (도구 요약·상세, 숫자·시간 표기)

**Files:**
- Create: `src/ui/toolFormat.ts`, `src/ui/format.ts`
- Test: `tests/ui/toolFormat.test.ts`, `tests/ui/format.test.ts`

**Interfaces:**
- Consumes: `TurnUsage` (Task 3)
- Produces:
```ts
// toolFormat.ts
export type DiffLine = { type: 'add' | 'del' | 'same'; text: string };
export type ToolDetail = { kind: 'diff'; lines: DiffLine[] } | { kind: 'text'; label: string; text: string };
export function relativePath(path: string, vaultPath: string): string;
export function oneLine(text: string, max: number): string;
export function truncate(text: string, max: number): string;
export function toolSummary(name: string, input: Record<string, unknown>, vaultPath: string): string;
export function toolDetails(name: string, input: Record<string, unknown>, output: string | null): ToolDetail[];
// format.ts
export function formatTokens(n: number): string;
export function formatSeconds(ms: number): string;
export function formatUsage(u: TurnUsage): string;
export function formatRelativeTime(ms: number, now: number): string;
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/toolFormat.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { oneLine, relativePath, toolDetails, toolSummary, truncate } from '../../src/ui/toolFormat';

const vault = '/home/u/Vault/Boxx';

describe('toolSummary', () => {
  it('파일 도구는 vault 기준 상대 경로', () => {
    expect(toolSummary('Read', { file_path: `${vault}/회의/a.md` }, vault)).toBe('회의/a.md');
    expect(toolSummary('Edit', { file_path: '/etc/hosts' }, vault)).toBe('/etc/hosts');
  });
  it('Bash는 description이 있으면 그것을, 없으면 명령을 한 줄로', () => {
    expect(toolSummary('Bash', { command: 'ls\n-la', description: 'List files' }, vault)).toBe('List files');
    expect(toolSummary('Bash', { command: 'ls\n  -la' }, vault)).toBe('ls -la');
  });
  it('검색·웹·스킬·에이전트 도구', () => {
    expect(toolSummary('Grep', { pattern: 'GAEMI' }, vault)).toBe('GAEMI');
    expect(toolSummary('WebFetch', { url: 'https://x.y' }, vault)).toBe('https://x.y');
    expect(toolSummary('Skill', { skill: 'ingest' }, vault)).toBe('ingest');
    expect(toolSummary('Agent', { description: 'Explore repo' }, vault)).toBe('Explore repo');
    expect(toolSummary('mcp__x__y', { a: 1 }, vault)).toBe('');
  });
  it('80자를 넘으면 줄인다', () => {
    expect(toolSummary('Bash', { command: 'x'.repeat(200) }, vault)).toHaveLength(80);
  });
});

describe('toolDetails', () => {
  it('Edit은 줄 단위 diff', () => {
    expect(toolDetails('Edit', { old_string: 'a\nb', new_string: 'a\nc' }, null)).toEqual([
      { kind: 'diff', lines: [{ type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'add', text: 'c' }] },
    ]);
  });
  it('MultiEdit은 편집마다 diff', () => {
    const d = toolDetails('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, null);
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.kind === 'diff')).toBe(true);
  });
  it('Write는 내용, Bash는 명령과 출력', () => {
    expect(toolDetails('Write', { content: 'hello' }, null)).toEqual([{ kind: 'text', label: '내용', text: 'hello' }]);
    expect(toolDetails('Bash', { command: 'ls' }, 'a.md')).toEqual([
      { kind: 'text', label: '명령', text: 'ls' },
      { kind: 'text', label: '출력', text: 'a.md' },
    ]);
  });
  it('그 밖의 도구는 입력 JSON, 긴 출력은 잘라 표시한다', () => {
    const d = toolDetails('Grep', { pattern: 'x' }, 'y'.repeat(5000));
    expect(d[0]).toEqual({ kind: 'text', label: '입력', text: JSON.stringify({ pattern: 'x' }, null, 2) });
    expect(d[1]).toMatchObject({ label: '출력' });
    expect((d[1] as { text: string }).text).toContain('(1000자 생략)');
  });
});

describe('문자열 보조 함수', () => {
  it('relativePath·oneLine·truncate', () => {
    expect(relativePath(`${vault}/a.md`, `${vault}/`)).toBe('a.md');
    expect(oneLine('a  b\nc', 80)).toBe('a b c');
    expect(oneLine('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 4)).toBe('abcd… (2자 생략)');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
```

`tests/ui/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatSeconds, formatTokens, formatUsage } from '../../src/ui/format';

describe('format', () => {
  it('formatTokens', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12345)).toBe('12.3k');
  });
  it('formatSeconds는 최소 1초', () => {
    expect(formatSeconds(400)).toBe('1초');
    expect(formatSeconds(8200)).toBe('8초');
  });
  it('formatUsage는 캐시 포함 입력·출력 토큰과 시간을 보여 준다', () => {
    expect(formatUsage({ inputTokens: 100, cacheReadTokens: 12000, cacheCreationTokens: 200, outputTokens: 450, costUsd: 0, durationMs: 3100 }))
      .toBe('입력 12.3k · 출력 450 tok · 3초');
  });
  it('formatRelativeTime', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('방금');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5분 전');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3시간 전');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2일 전');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui`
Expected: FAIL — `Failed to resolve import "../../src/ui/toolFormat"` / `"../../src/ui/format"`

- [ ] **Step 3: 구현**

`src/ui/toolFormat.ts`:
```ts
import { diffLines } from 'diff';

export type DiffLine = { type: 'add' | 'del' | 'same'; text: string };
export type ToolDetail = { kind: 'diff'; lines: DiffLine[] } | { kind: 'text'; label: string; text: string };

const MAX_DETAIL = 4000;

export function relativePath(path: string, vaultPath: string): string {
  const prefix = vaultPath.endsWith('/') ? vaultPath : `${vaultPath}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max}자 생략)` : text;
}

function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  return typeof v === 'string' ? v : '';
}

/** 도구 카드 한 줄 요약 */
export function toolSummary(name: string, input: Record<string, unknown>, vaultPath: string): string {
  let s: string;
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
      s = relativePath(str(input, 'file_path'), vaultPath);
      break;
    case 'NotebookEdit':
      s = relativePath(str(input, 'notebook_path'), vaultPath);
      break;
    case 'Bash':
      s = str(input, 'description') || str(input, 'command');
      break;
    case 'Glob':
    case 'Grep':
      s = str(input, 'pattern');
      break;
    case 'WebFetch':
      s = str(input, 'url');
      break;
    case 'WebSearch':
      s = str(input, 'query');
      break;
    case 'Skill':
      s = str(input, 'skill');
      break;
    case 'Agent':
    case 'Task':
      s = str(input, 'description');
      break;
    default:
      s = '';
  }
  return oneLine(s, 80);
}

function diffDetail(before: string, after: string): ToolDetail {
  const lines: DiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const type = part.added ? 'add' : part.removed ? 'del' : 'same';
    for (const line of part.value.replace(/\n$/, '').split('\n')) lines.push({ type, text: line });
  }
  return { kind: 'diff', lines };
}

/** 도구 카드를 펼쳤을 때 보일 내용 */
export function toolDetails(name: string, input: Record<string, unknown>, output: string | null): ToolDetail[] {
  const details: ToolDetail[] = [];
  if (name === 'Edit') {
    details.push(diffDetail(str(input, 'old_string'), str(input, 'new_string')));
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits as Record<string, unknown>[]) details.push(diffDetail(str(edit, 'old_string'), str(edit, 'new_string')));
  } else if (name === 'Write') {
    details.push({ kind: 'text', label: '내용', text: truncate(str(input, 'content'), MAX_DETAIL) });
  } else if (name === 'Bash') {
    details.push({ kind: 'text', label: '명령', text: str(input, 'command') });
  } else {
    details.push({ kind: 'text', label: '입력', text: truncate(JSON.stringify(input, null, 2), MAX_DETAIL) });
  }
  if (output) details.push({ kind: 'text', label: '출력', text: truncate(output, MAX_DETAIL) });
  return details;
}
```

`src/ui/format.ts`:
```ts
import type { TurnUsage } from '../types';

export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

export function formatSeconds(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}초`;
}

export function formatUsage(u: TurnUsage): string {
  const input = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  return `입력 ${formatTokens(input)} · 출력 ${formatTokens(u.outputTokens)} tok · ${formatSeconds(u.durationMs)}`;
}

export function formatRelativeTime(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui`
Expected: PASS (9 + 4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/toolFormat.ts src/ui/format.ts tests/ui
git commit -m "feat: add tool card and usage formatting helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 9: 설정·채팅 뷰·입력창·메시지 목록·기본 승인 카드 (MVP)

UI는 DOM에 의존하므로 단위 테스트 대신 빌드 검증과 Obsidian 수동 점검으로 확인한다. 로직은 이미 Task 3–8에서 테스트됐다.

**Files:**
- Create: `src/settings.ts`, `src/ui/ChatView.ts`, `src/ui/MessageList.ts`, `src/ui/Composer.ts`, `src/ui/ApprovalCard.ts`
- Modify: `src/main.ts` (전체 교체), `styles.css` (전체 교체)

**Interfaces:**
- Consumes: `ClaudeSession`, `SessionConfig` (Task 6), `ChatState`, `ItemOf`, `NoticeAction` (Task 4), `ApprovalDecision` (Task 5), `toolSummary`, `toolDetails` (Task 8), `formatSeconds`, `formatUsage` (Task 8), `oneShot` (Task 1), `buildEnv`, `resolveOnPath`, `findClaudeViaLoginShell` (Task 1)
- Produces:
```ts
// settings.ts
export interface ClaudePanelSettings { claudePath: string; defaultModel: string; attachActiveNote: boolean; sendKey: 'enter' | 'mod-enter'; useHooks: boolean }
export const DEFAULT_SETTINGS: ClaudePanelSettings;
export class ClaudePanelSettingTab extends PluginSettingTab
// main.ts (ClaudePanelPlugin)
settings: ClaudePanelSettings; readonly views: Set<ChatView>;
vaultPath(): string; claudePath(): string; sessionConfig(): SessionConfig;
autoFindClaude(): Promise<boolean>; openSettings(): void; openPanel(newPanel: boolean): Promise<void>; saveSettings(): Promise<void>
// ui/ChatView.ts
export const VIEW_TYPE_CLAUDE_PANEL = 'claude-panel-view';
export class ChatView extends ItemView { newChat(): void; shutdown(): void }
// ui/Composer.ts
export interface ComposerHandlers { sendKey(): 'enter' | 'mod-enter'; onSubmit(text: string): void; onStop(): void; onCycleMode?(): void; onInput?(textarea: HTMLTextAreaElement): void; onKeyDownCapture?(evt: KeyboardEvent): boolean; onFocus?(): void }
export class Composer { readonly el: HTMLElement; readonly chipsEl: HTMLElement; readonly textarea: HTMLTextAreaElement; setBusy(busy: boolean): void; focus(): void; setValue(value: string, cursor: number): void }
// ui/MessageList.ts
export interface MessageListContext { app: App; owner: Component; state: ChatState; vaultPath: string; onDecision(id: string, d: ApprovalDecision): void; onNoticeAction(a: NoticeAction): void }
export class MessageList { update(ids: string[]): void; clear(): void; renderMarkdown(el: HTMLElement, markdown: string, key: string): void }
// ui/ApprovalCard.ts
export interface ApprovalCardContext { vaultPath: string; onDecision(id: string, d: ApprovalDecision): void; renderMarkdown(el: HTMLElement, markdown: string): void }
export function renderApprovalCard(el: HTMLElement, item: ItemOf<'approval'>, ctx: ApprovalCardContext): void;
export function button(parent: HTMLElement, text: string, onClick: () => void, cta?: boolean): HTMLButtonElement;
```

- [ ] **Step 1: 설정 작성**

`src/settings.ts`:
```ts
import { PluginSettingTab, Setting, type App } from 'obsidian';
import type ClaudePanelPlugin from './main';

export interface ClaudePanelSettings {
  claudePath: string;
  defaultModel: string;
  attachActiveNote: boolean;
  sendKey: 'enter' | 'mod-enter';
  useHooks: boolean;
}

export const DEFAULT_SETTINGS: ClaudePanelSettings = {
  claudePath: 'claude',
  defaultModel: '',
  attachActiveNote: true,
  sendKey: 'enter',
  useHooks: true,
};

export class ClaudePanelSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ClaudePanelPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Claude 실행 파일 경로')
      .setDesc('이름만 쓰면 PATH(~/.local/bin 등 보강)에서 찾습니다. 찾지 못하면 절대 경로를 지정하세요.')
      .addText((t) =>
        t.setPlaceholder('claude').setValue(s.claudePath).onChange(async (v) => {
          s.claudePath = v.trim() || 'claude';
          await this.plugin.saveSettings();
        }),
      )
      .addButton((b) =>
        b.setButtonText('자동 찾기').onClick(async () => {
          await this.plugin.autoFindClaude();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('기본 모델')
      .setDesc('비우면 Claude Code 설정을 따릅니다. 예: opus, sonnet, haiku')
      .addText((t) =>
        t.setValue(s.defaultModel).onChange(async (v) => {
          s.defaultModel = v.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('현재 노트 자동 첨부')
      .setDesc('전송할 때 활성 노트 경로를 컨텍스트로 붙입니다.')
      .addToggle((t) =>
        t.setValue(s.attachActiveNote).onChange(async (v) => {
          s.attachActiveNote = v;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('전송 단축키')
      .setDesc('Shift+Enter는 항상 줄바꿈, Ctrl/Cmd+Enter는 항상 전송입니다.')
      .addDropdown((d) =>
        d
          .addOption('enter', 'Enter')
          .addOption('mod-enter', 'Ctrl/Cmd+Enter')
          .setValue(s.sendKey)
          .onChange(async (v) => {
            s.sendKey = v === 'mod-enter' ? 'mod-enter' : 'enter';
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('사용자 hook 사용')
      .setDesc('끄면 패널 세션에서 settings.json의 hook을 실행하지 않습니다. 새 대화부터 적용됩니다.')
      .addToggle((t) =>
        t.setValue(s.useHooks).onChange(async (v) => {
          s.useHooks = v;
          await this.plugin.saveSettings();
        }),
      );
  }
}
```

- [ ] **Step 2: 플러그인 진입점 교체**

`src/main.ts` (전체 교체):
```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { FileSystemAdapter, Notice, Plugin, type WorkspaceLeaf } from 'obsidian';
import type { SessionConfig } from './session/buildOptions';
import { oneShot } from './session/oneShot';
import { ClaudePanelSettingTab, DEFAULT_SETTINGS, type ClaudePanelSettings } from './settings';
import { ChatView, VIEW_TYPE_CLAUDE_PANEL } from './ui/ChatView';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from './util/claudePath';

export default class ClaudePanelPlugin extends Plugin {
  settings: ClaudePanelSettings = { ...DEFAULT_SETTINGS };
  readonly views = new Set<ChatView>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_CLAUDE_PANEL, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon('bot', 'Open Claude panel', () => void this.openPanel(false));
    this.addCommand({ id: 'open-panel', name: 'Open panel', callback: () => void this.openPanel(false) });
    this.addCommand({ id: 'test-connection', name: 'Test connection', callback: () => void this.testConnection() });
    this.addSettingTab(new ClaudePanelSettingTab(this.app, this));
  }

  override onunload(): void {
    // 열린 패널의 claude 프로세스를 모두 정리한다
    for (const view of [...this.views]) view.shutdown();
    this.views.clear();
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<ClaudePanelSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  vaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error('데스크톱 vault에서만 동작합니다.');
  }

  /** 설정값을 절대 경로로 바꾼다. 못 찾으면 설정값 그대로 넘겨 SDK의 "not found" 오류가 [경로 자동 찾기] 카드로 이어지게 한다. */
  claudePath(): string {
    return resolveOnPath(this.settings.claudePath, buildEnv().PATH ?? '') ?? this.settings.claudePath;
  }

  sessionConfig(): SessionConfig {
    return {
      cwd: this.vaultPath(),
      claudePath: this.claudePath(),
      env: buildEnv(),
      useHooks: this.settings.useHooks,
      defaultModel: this.settings.defaultModel,
    };
  }

  async autoFindClaude(): Promise<boolean> {
    const found = await findClaudeViaLoginShell();
    if (!found) {
      new Notice('로그인 셸에서도 claude를 찾지 못했습니다. 설정에 절대 경로를 입력하세요.');
      return false;
    }
    this.settings.claudePath = found;
    await this.saveSettings();
    new Notice(`claude 경로를 저장했습니다: ${found}\n메시지를 다시 보내세요.`);
    return true;
  }

  openSettings(): void {
    // 설정 창 열기는 공개 API가 없어 내부 객체를 쓴다
    const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  async openPanel(newPanel: boolean): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = newPanel ? null : (workspace.getLeavesOfType(VIEW_TYPE_CLAUDE_PANEL)[0] ?? null);
    if (!leaf) {
      leaf = workspace.getRightLeaf(newPanel);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE_CLAUDE_PANEL, active: true });
    }
    await workspace.revealLeaf(leaf);
  }

  private async testConnection(): Promise<void> {
    const notice = new Notice('Claude 연결 확인 중…', 0);
    try {
      const r = await oneShot(query, this.sessionConfig(), 'Reply with exactly: pong', { model: 'haiku' });
      notice.setMessage(`연결 성공: ${r.text} (CLI ${r.cliVersion ?? '?'}, ${r.model ?? '?'})`);
    } catch (err) {
      notice.setMessage(`연결 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    window.setTimeout(() => notice.hide(), 8000);
  }
}
```

- [ ] **Step 3: 입력창 작성**

`src/ui/Composer.ts`:
```ts
export interface ComposerHandlers {
  sendKey(): 'enter' | 'mod-enter';
  onSubmit(text: string): void;
  onStop(): void;
  /** Shift+Tab: 권한 모드 순환 (Task 11) */
  onCycleMode?(): void;
  /** 입력이 바뀔 때 (Task 14 자동완성) */
  onInput?(textarea: HTMLTextAreaElement): void;
  /** 자동완성 팝업이 키를 가로챌 기회. true면 처리 완료 */
  onKeyDownCapture?(evt: KeyboardEvent): boolean;
  /** 입력창 포커스 (Task 13 컨텍스트 칩 갱신) */
  onFocus?(): void;
}

export class Composer {
  readonly chipsEl: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  private readonly button: HTMLButtonElement;
  private busy = false;

  constructor(readonly el: HTMLElement, private readonly h: ComposerHandlers) {
    this.chipsEl = el.createDiv({ cls: 'cp-chips' });
    this.textarea = el.createEl('textarea', { cls: 'cp-input', attr: { rows: '3', placeholder: '메시지 입력 (/ 명령)' } });
    const bar = el.createDiv({ cls: 'cp-composer-bar' });
    this.button = bar.createEl('button', { cls: 'mod-cta', text: '전송' });
    this.button.addEventListener('click', () => (this.busy ? this.h.onStop() : this.submit()));
    this.textarea.addEventListener('keydown', (evt) => this.onKeyDown(evt));
    this.textarea.addEventListener('input', () => {
      this.autosize();
      this.h.onInput?.(this.textarea);
    });
    this.textarea.addEventListener('focus', () => this.h.onFocus?.());
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.button.setText(busy ? '■ 중단' : '전송');
    this.button.toggleClass('mod-cta', !busy);
    this.button.toggleClass('mod-warning', busy);
  }

  focus(): void {
    this.textarea.focus();
  }

  setValue(value: string, cursor: number): void {
    this.textarea.value = value;
    this.textarea.setSelectionRange(cursor, cursor);
    this.autosize();
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (!text || this.busy) return;
    this.setValue('', 0);
    this.h.onSubmit(text);
  }

  private onKeyDown(evt: KeyboardEvent): void {
    if (evt.isComposing || evt.keyCode === 229) return; // 한글 조합 중 Enter는 글자 확정용
    if (this.h.onKeyDownCapture?.(evt)) return;
    if (evt.key === 'Escape' && this.busy) {
      evt.preventDefault();
      this.h.onStop();
      return;
    }
    if (evt.key === 'Tab' && evt.shiftKey && this.h.onCycleMode) {
      evt.preventDefault();
      this.h.onCycleMode();
      return;
    }
    if (evt.key !== 'Enter' || evt.shiftKey) return;
    const mod = evt.ctrlKey || evt.metaKey;
    if (mod || this.h.sendKey() === 'enter') {
      evt.preventDefault();
      this.submit();
    }
  }

  private autosize(): void {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 240)}px`;
  }
}
```

- [ ] **Step 4: 승인 카드(일반 도구) 작성**

`src/ui/ApprovalCard.ts`:
```ts
import type { ItemOf } from '../chat/ChatState';
import type { ApprovalDecision } from '../session/ApprovalBroker';
import type { ApprovalRequest } from '../types';
import { toolSummary } from './toolFormat';

export interface ApprovalCardContext {
  vaultPath: string;
  onDecision(id: string, decision: ApprovalDecision): void;
  renderMarkdown(el: HTMLElement, markdown: string): void;
}

export function button(parent: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
  const btn = parent.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderApprovalCard(el: HTMLElement, item: ItemOf<'approval'>, ctx: ApprovalCardContext): void {
  const { request } = item;
  el.empty();
  const card = el.createDiv({ cls: 'cp-approval' });
  if (item.settled) {
    card.addClass('is-settled');
    card.setText(`${request.toolName} — ${item.settled}`);
    return;
  }
  card.createDiv({ cls: 'cp-approval-title', text: '승인 필요' });
  renderToolApproval(card, request, ctx);
}

function renderToolApproval(card: HTMLElement, request: ApprovalRequest, ctx: ApprovalCardContext): void {
  const summary = toolSummary(request.toolName, request.input, ctx.vaultPath);
  card.createDiv({ cls: 'cp-approval-desc', text: request.title ?? (summary ? `${request.toolName}: ${summary}` : request.toolName) });
  if (request.reason) card.createDiv({ cls: 'cp-approval-reason', text: request.reason });
  const row = card.createDiv({ cls: 'cp-approval-actions' });
  button(row, '허용', () => ctx.onDecision(request.id, { type: 'allow' }), true);
  if (request.canAlwaysAllow) button(row, '항상 허용', () => ctx.onDecision(request.id, { type: 'allow-always' }));
  button(row, '거부…', () => showDenyInput(card, (message) => ctx.onDecision(request.id, { type: 'deny', message })));
}

function showDenyInput(card: HTMLElement, submit: (message: string) => void): void {
  if (card.querySelector('.cp-deny-row')) return;
  const row = card.createDiv({ cls: 'cp-deny-row' });
  const input = row.createEl('input', { type: 'text', attr: { placeholder: '거부 사유 (Claude에 전달, 선택)' } });
  const send = () => submit(input.value.trim());
  button(row, '거부 보내기', send);
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && !evt.isComposing) {
      evt.preventDefault();
      send();
    }
  });
  input.focus();
}
```

- [ ] **Step 5: 메시지 목록 작성**

`src/ui/MessageList.ts`:
```ts
import { Component, Keymap, MarkdownRenderer, type App } from 'obsidian';
import type { ChatItem, ChatState, ItemOf, NoticeAction } from '../chat/ChatState';
import type { ApprovalDecision } from '../session/ApprovalBroker';
import { renderApprovalCard } from './ApprovalCard';
import { formatSeconds, formatUsage } from './format';
import { toolDetails, toolSummary } from './toolFormat';

export interface MessageListContext {
  app: App;
  /** 마크다운 렌더러의 하위 컴포넌트를 붙일 부모 (ChatView) */
  owner: Component;
  state: ChatState;
  vaultPath: string;
  onDecision(id: string, decision: ApprovalDecision): void;
  onNoticeAction(action: NoticeAction): void;
}

const RENDER_INTERVAL_MS = 100;
const STATUS_ICON: Record<ItemOf<'tool'>['status'], string> = { running: '…', done: '✓', error: '✗', cancelled: '⊘' };
const ACTION_LABEL: Record<NoticeAction, string> = { reconnect: '다시 연결', 'find-claude': '경로 자동 찾기', 'open-settings': '설정 열기' };

export class MessageList {
  private readonly els = new Map<string, HTMLElement>();
  private readonly renderers = new Map<string, Component>();
  private readonly pending = new Set<string>();
  private timer: number | null = null;

  constructor(private readonly root: HTMLElement, private readonly ctx: MessageListContext) {
    root.addEventListener('click', (evt) => this.onLinkClick(evt));
  }

  clear(): void {
    for (const component of this.renderers.values()) this.ctx.owner.removeChild(component);
    this.renderers.clear();
    this.els.clear();
    this.pending.clear();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.root.empty();
  }

  update(ids: string[]): void {
    const pinned = this.isPinnedToBottom();
    for (const id of new Set(ids)) {
      const item = this.ctx.state.get(id);
      if (!item) continue;
      let el = this.els.get(id);
      if (!el) {
        el = this.root.createDiv({ cls: `cp-item cp-${item.type}` });
        this.els.set(id, el);
      }
      if (item.type === 'block' && item.blockType === 'text' && item.streaming) {
        this.schedule(id); // 스트리밍 중 마크다운 재렌더는 100ms당 1회
      } else {
        this.pending.delete(id);
        this.render(item, el);
      }
    }
    if (pinned) this.scrollToBottom();
  }

  /** 마크다운을 떼어 낸 요소에 렌더한 뒤 교체한다 (깜박임·경합 방지). 실패하면 일반 텍스트. */
  renderMarkdown(el: HTMLElement, markdown: string, key: string): void {
    const old = this.renderers.get(key);
    if (old) this.ctx.owner.removeChild(old);
    const component = new Component();
    this.ctx.owner.addChild(component);
    this.renderers.set(key, component);
    const target = createDiv();
    MarkdownRenderer.render(this.ctx.app, markdown, target, '', component)
      .then(() => {
        if (this.renderers.get(key) === component) el.replaceChildren(target);
      })
      .catch(() => {
        if (this.renderers.get(key) === component) el.setText(markdown);
      });
  }

  private schedule(id: string): void {
    this.pending.add(id);
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      const pinned = this.isPinnedToBottom();
      for (const pid of this.pending) {
        const item = this.ctx.state.get(pid);
        const el = this.els.get(pid);
        if (item && el) this.render(item, el);
      }
      this.pending.clear();
      if (pinned) this.scrollToBottom();
    }, RENDER_INTERVAL_MS);
  }

  private render(item: ChatItem, el: HTMLElement): void {
    switch (item.type) {
      case 'user':
        return this.renderUser(item, el);
      case 'block':
        if (item.blockType === 'text') {
          el.addClass('markdown-rendered');
          this.renderMarkdown(el, item.text, item.id);
        } else {
          this.renderThinking(item, el);
        }
        return;
      case 'tool':
        return this.renderTool(item, el);
      case 'approval':
        return renderApprovalCard(el, item, {
          vaultPath: this.ctx.vaultPath,
          onDecision: this.ctx.onDecision,
          renderMarkdown: (target, markdown) => this.renderMarkdown(target, markdown, `${item.id}:md`),
        });
      case 'notice':
        return this.renderNotice(item, el);
      case 'footer':
        el.setText(formatUsage(item.usage));
        return;
    }
  }

  private renderUser(item: ItemOf<'user'>, el: HTMLElement): void {
    el.empty();
    if (item.contextLabel) el.createDiv({ cls: 'cp-context-label', text: item.contextLabel });
    el.createDiv({ cls: 'cp-user-text', text: item.text });
  }

  private renderThinking(item: ItemOf<'block'>, el: HTMLElement): void {
    let details = el.querySelector('details');
    if (!details) {
      details = el.createEl('details', { cls: 'cp-thinking' });
      details.createEl('summary');
      details.createDiv({ cls: 'cp-thinking-body' });
    }
    let label = '생각함';
    if (item.streaming) label = '생각 중…';
    else if (item.endedAt !== null) label = `생각함 (${formatSeconds(item.endedAt - item.startedAt)})`;
    details.querySelector('summary')?.setText(label);
    details.querySelector<HTMLElement>('.cp-thinking-body')?.setText(item.text);
  }

  private renderTool(item: ItemOf<'tool'>, el: HTMLElement): void {
    const wasOpen = el.querySelector('details')?.open ?? false;
    el.empty();
    const details = el.createEl('details', { cls: 'cp-tool' });
    details.open = wasOpen;
    const summary = details.createEl('summary');
    summary.createSpan({ cls: 'cp-tool-name', text: item.name });
    summary.createSpan({ cls: 'cp-tool-summary', text: toolSummary(item.name, item.input, this.ctx.vaultPath) });
    summary.createSpan({ cls: `cp-tool-status cp-status-${item.status}`, text: STATUS_ICON[item.status] });
    const body = details.createDiv({ cls: 'cp-tool-body' });
    for (const detail of toolDetails(item.name, item.input, item.output)) {
      if (detail.kind === 'diff') {
        const pre = body.createEl('pre', { cls: 'cp-diff' });
        for (const line of detail.lines) {
          const sign = line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
          pre.createDiv({ cls: `cp-diff-${line.type}`, text: `${sign} ${line.text}` });
        }
      } else {
        body.createDiv({ cls: 'cp-tool-label', text: detail.label });
        body.createEl('pre', { text: detail.text });
      }
    }
  }

  private renderNotice(item: ItemOf<'notice'>, el: HTMLElement): void {
    el.empty();
    el.toggleClass('cp-error', item.level === 'error');
    el.createDiv({ cls: 'cp-notice-text', text: item.text });
    if (!item.action) return;
    const row = el.createDiv({ cls: 'cp-notice-actions' });
    const actions: NoticeAction[] = item.action === 'find-claude' ? ['find-claude', 'open-settings'] : [item.action];
    for (const action of actions) {
      row.createEl('button', { text: ACTION_LABEL[action] }).addEventListener('click', () => this.ctx.onNoticeAction(action));
    }
  }

  private onLinkClick(evt: MouseEvent): void {
    const link = (evt.target as HTMLElement).closest('a.internal-link');
    if (!link) return;
    evt.preventDefault();
    const href = link.getAttribute('data-href') ?? link.getAttribute('href');
    if (href) void this.ctx.app.workspace.openLinkText(href, '', Keymap.isModEvent(evt));
  }

  private isPinnedToBottom(): boolean {
    return this.root.scrollHeight - this.root.scrollTop - this.root.clientHeight < 40;
  }

  private scrollToBottom(): void {
    this.root.scrollTop = this.root.scrollHeight;
  }
}
```

- [ ] **Step 6: 채팅 뷰 작성**

`src/ui/ChatView.ts`:
```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { ChatState, type NoticeAction } from '../chat/ChatState';
import type ClaudePanelPlugin from '../main';
import { ClaudeSession } from '../session/ClaudeSession';
import type { PanelEvent } from '../types';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

export const VIEW_TYPE_CLAUDE_PANEL = 'claude-panel-view';

export class ChatView extends ItemView {
  private session: ClaudeSession | null = null;
  private offSession: (() => void) | null = null;
  private readonly state = new ChatState();
  private list!: MessageList;
  private composer!: Composer;
  private headerEl!: HTMLElement;
  private titleEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ClaudePanelPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_CLAUDE_PANEL;
  }

  getDisplayText(): string {
    return 'Claude';
  }

  override getIcon(): string {
    return 'bot';
  }

  override async onOpen(): Promise<void> {
    this.plugin.views.add(this);
    const root = this.contentEl;
    root.empty();
    root.addClass('cp-root');

    this.headerEl = root.createDiv({ cls: 'cp-header' });
    const titleRow = this.headerEl.createDiv({ cls: 'cp-title-row' });
    this.titleEl = titleRow.createDiv({ cls: 'cp-title', text: '새 대화' });
    const actions = titleRow.createDiv({ cls: 'cp-header-actions' });
    this.iconButton(actions, 'plus', '새 대화', () => this.newChat());

    this.list = new MessageList(root.createDiv({ cls: 'cp-messages' }), {
      app: this.app,
      owner: this,
      state: this.state,
      vaultPath: this.plugin.vaultPath(),
      onDecision: (id, decision) => this.session?.broker.decide(id, decision),
      onNoticeAction: (action) => void this.runNoticeAction(action),
    });

    this.composer = new Composer(root.createDiv({ cls: 'cp-composer' }), {
      sendKey: () => this.plugin.settings.sendKey,
      onSubmit: (text) => this.submit(text),
      onStop: () => void this.session?.interrupt(),
    });

    this.newChat();
  }

  override async onClose(): Promise<void> {
    this.shutdown();
  }

  /** 패널 닫기·플러그인 unload 때 claude 프로세스를 정리한다. */
  shutdown(): void {
    this.offSession?.();
    this.offSession = null;
    this.session?.close();
    this.session = null;
    this.plugin.views.delete(this);
  }

  newChat(): void {
    this.useSession(this.createSession());
    this.setTitle('새 대화');
    this.composer.focus();
  }

  private createSession(): ClaudeSession {
    return new ClaudeSession({ query, getConfig: () => this.plugin.sessionConfig() });
  }

  private useSession(session: ClaudeSession): void {
    this.offSession?.();
    this.session?.close();
    this.session = session;
    this.offSession = session.on((e) => this.onEvent(e));
    this.state.clear();
    this.list.clear();
    this.composer.setBusy(false);
  }

  private setTitle(title: string): void {
    this.titleEl.setText(title);
  }

  private submit(text: string): void {
    this.session?.send({ prompt: text, display: text, contextLabel: null });
  }

  private onEvent(e: PanelEvent): void {
    this.list.update(this.state.apply(e));
    this.composer.setBusy(this.state.busy);
  }

  private async runNoticeAction(action: NoticeAction): Promise<void> {
    if (action === 'reconnect') this.session?.reconnect();
    else if (action === 'find-claude') await this.plugin.autoFindClaude();
    else this.plugin.openSettings();
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLElement {
    const btn = parent.createEl('button', { cls: 'cp-icon-btn clickable-icon', attr: { 'aria-label': label } });
    setIcon(btn, icon);
    btn.addEventListener('click', onClick);
    return btn;
  }
}
```

- [ ] **Step 7: 스타일 작성**

`styles.css` (전체 교체):
```css
/* Claude Panel */
.cp-root { display: flex; flex-direction: column; height: 100%; padding: 0 !important; }
.cp-header { padding: 6px 10px; border-bottom: 1px solid var(--background-modifier-border); }
.cp-title-row { display: flex; align-items: center; gap: 6px; }
.cp-title { flex: 1; min-width: 0; font-weight: var(--font-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.cp-header-actions { display: flex; gap: 2px; }
.cp-messages { flex: 1; overflow-y: auto; padding: 8px 10px; user-select: text; }
.cp-item { margin: 6px 0; }
.cp-user { background: var(--background-secondary); border-radius: var(--radius-m); padding: 6px 10px; }
.cp-user-text { white-space: pre-wrap; word-break: break-word; }
.cp-context-label { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-bottom: 2px; }
.cp-block.markdown-rendered > div > :first-child { margin-top: 0; }
.cp-block.markdown-rendered > div > :last-child { margin-bottom: 0; }
.cp-thinking > summary, .cp-tool > summary { cursor: pointer; color: var(--text-muted); font-size: var(--font-ui-small); }
.cp-thinking-body { white-space: pre-wrap; color: var(--text-faint); font-size: var(--font-ui-small); padding-left: 10px; border-left: 2px solid var(--background-modifier-border); }
.cp-tool > summary { display: flex; gap: 6px; align-items: center; }
.cp-tool-name { font-family: var(--font-monospace); color: var(--text-normal); }
.cp-tool-summary { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cp-status-done { color: var(--color-green); }
.cp-status-error { color: var(--color-red); }
.cp-status-cancelled { color: var(--text-faint); }
.cp-tool-body pre { max-height: 300px; overflow: auto; font-size: var(--font-ui-smaller); margin: 4px 0; white-space: pre-wrap; }
.cp-tool-label { font-size: var(--font-ui-smaller); color: var(--text-faint); }
.cp-diff-add { background: rgba(var(--color-green-rgb), 0.15); }
.cp-diff-del { background: rgba(var(--color-red-rgb), 0.15); }
.cp-notice { font-size: var(--font-ui-small); color: var(--text-muted); }
.cp-notice.cp-error { color: var(--text-error); border: 1px solid var(--background-modifier-error); border-radius: var(--radius-s); padding: 6px 8px; white-space: pre-wrap; }
.cp-notice-actions { display: flex; gap: 6px; margin-top: 4px; }
.cp-footer { text-align: right; font-size: var(--font-ui-smaller); color: var(--text-faint); }
.cp-approval { border: 1px solid var(--interactive-accent); border-radius: var(--radius-m); padding: 8px 10px; }
.cp-approval.is-settled { border-color: var(--background-modifier-border); color: var(--text-muted); font-size: var(--font-ui-small); padding: 4px 10px; }
.cp-approval-title { font-weight: var(--font-semibold); margin-bottom: 4px; }
.cp-approval-desc { font-family: var(--font-monospace); font-size: var(--font-ui-small); word-break: break-all; }
.cp-approval-reason { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 2px; }
.cp-approval-actions, .cp-deny-row { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
.cp-deny-row input { flex: 1; min-width: 0; }
.cp-composer { position: relative; border-top: 1px solid var(--background-modifier-border); padding: 6px 10px 10px; }
.cp-input { width: 100%; resize: none; min-height: 60px; }
.cp-composer-bar { display: flex; justify-content: flex-end; margin-top: 4px; }
```

- [ ] **Step 8: 빌드 검증**

Run: `npm test && npm run build`
Expected: 모든 단위 테스트 PASS, `tsc` 오류 없음, `check-bundle: OK`, `smoke-load: OK`

- [ ] **Step 9: [사용자 확인] MVP 수동 점검**

`scripts/link-vault.sh ~/Vault/Boxx`는 이미 링크돼 있으므로 빌드만 하면 된다. 사용자에게 Obsidian에서 플러그인을 껐다 켜거나(`Ctrl+R`) 다음을 확인해 달라고 요청한다:
- [ ] 리본 아이콘(bot) 또는 **Claude Panel: Open panel** → 오른쪽 사이드바에 패널이 열림
- [ ] "index.md의 첫 5줄을 요약해 줘" 전송 → 글자 단위 스트리밍, thinking 접힘 표시(생각함 (n초)), Read 도구 카드 ✓
- [ ] 답변의 `[[위키링크]]` 클릭 → 노트 열림 (Ctrl+클릭은 새 탭)
- [ ] 임시 노트를 하나 만든 뒤 "그 노트의 제목을 바꿔 줘" → Edit 도구 카드를 펼치면 diff 표시
- [ ] 긴 답변 생성 중 Esc 또는 [■ 중단] → "중단됨" 표시, 입력창 다시 사용 가능
- [ ] [+] 새 대화 → 목록 비워짐
- [ ] 한글 입력 중 Enter → 글자만 확정되고 전송되지 않음, 한 번 더 Enter → 전송
- [ ] 설정에서 실행 파일 경로를 `/nope/claude`로 바꾸고 전송 → 오류 카드 + [경로 자동 찾기] → 경로 저장 Notice, 다시 전송하면 정상
- [ ] 패널을 닫은 뒤 `ps -ef | grep '[c]laude' | grep -v tty`로 패널용 `claude` 프로세스가 남지 않았는지 확인

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add sidebar chat view with streaming, tool cards and approvals

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 3단계 — 승인·모드

### Task 10: AskUserQuestion·ExitPlanMode 승인 카드

**Files:**
- Create: `src/session/approvalInputs.ts`
- Modify: `src/ui/ApprovalCard.ts` (전체 교체), `styles.css` (끝에 추가)
- Test: `tests/session/approvalInputs.test.ts`

**Interfaces:**
- Consumes: `ApprovalDecision` (Task 5), `ApprovalCardContext`, `button` (Task 9), `toolSummary` (Task 8)
- Produces:
```ts
export interface AskOption { label: string; description: string }
export interface AskQuestion { question: string; header: string; options: AskOption[]; multiSelect: boolean }
export function parseQuestions(input: Record<string, unknown>): AskQuestion[];
export function buildAnswers(questions: AskQuestion[], picked: Map<number, Set<string>>, other: Map<number, string>): Record<string, string> | null;
export function extractPlan(input: Record<string, unknown>): string;
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/session/approvalInputs.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildAnswers, extractPlan, parseQuestions } from '../../src/session/approvalInputs';

const input = {
  questions: [
    { question: '어느 폴더?', header: '위치', multiSelect: false, options: [{ label: '회의', description: '회의록' }, { label: '데일리', description: '일일 기록' }] },
    { question: '어떤 태그?', header: '태그', multiSelect: true, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] },
  ],
};

describe('parseQuestions', () => {
  it('질문·선택지를 읽고 형식이 틀린 항목은 버린다', () => {
    const qs = parseQuestions({ questions: [...input.questions, { header: 'no question' }, 'junk'] });
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ question: '어느 폴더?', header: '위치', multiSelect: false, options: [{ label: '회의', description: '회의록' }, { label: '데일리', description: '일일 기록' }] });
    expect(parseQuestions({})).toEqual([]);
  });
});

describe('buildAnswers', () => {
  const qs = parseQuestions(input);
  it('모든 질문에 답이 있어야 한다', () => {
    expect(buildAnswers(qs, new Map([[0, new Set(['회의'])]]), new Map())).toBeNull();
  });
  it('다중 선택은 선택지 순서대로 쉼표로 잇고, 기타 입력을 뒤에 붙인다', () => {
    const picked = new Map([[0, new Set(['데일리'])], [1, new Set(['b', 'a'])]]);
    expect(buildAnswers(qs, picked, new Map([[1, ' 직접 ']]))).toEqual({ '어느 폴더?': '데일리', '어떤 태그?': 'a, b, 직접' });
  });
  it('기타 입력만으로도 답이 된다', () => {
    expect(buildAnswers(qs, new Map(), new Map([[0, 'x'], [1, 'y']]))).toEqual({ '어느 폴더?': 'x', '어떤 태그?': 'y' });
  });
});

describe('extractPlan', () => {
  it('plan 문자열, 계획 파일 경로, 둘 다 없음', () => {
    expect(extractPlan({ plan: '# 계획\n- a' })).toBe('# 계획\n- a');
    expect(extractPlan({ planFilePath: '/home/u/.claude/plans/x.md' })).toBe('계획 파일: /home/u/.claude/plans/x.md');
    expect(extractPlan({})).toBe('(계획 본문 없음)');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/session/approvalInputs.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/session/approvalInputs"`

- [ ] **Step 3: 구현**

`src/session/approvalInputs.ts`:
```ts
export interface AskOption {
  label: string;
  description: string;
}

export interface AskQuestion {
  question: string;
  header: string;
  options: AskOption[];
  multiSelect: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** AskUserQuestion 입력을 방어적으로 읽는다. */
export function parseQuestions(input: Record<string, unknown>): AskQuestion[] {
  if (!Array.isArray(input.questions)) return [];
  return input.questions.filter(isRecord).flatMap((q) => {
    const question = typeof q.question === 'string' ? q.question : '';
    if (!question) return [];
    const options = Array.isArray(q.options)
      ? q.options.filter(isRecord).map((o) => ({ label: String(o.label ?? ''), description: String(o.description ?? '') }))
      : [];
    return [{ question, header: String(q.header ?? ''), options, multiSelect: q.multiSelect === true }];
  });
}

/** 질문 텍스트를 키로 한 답. 답이 없는 질문이 하나라도 있으면 null. */
export function buildAnswers(questions: AskQuestion[], picked: Map<number, Set<string>>, other: Map<number, string>): Record<string, string> | null {
  const answers: Record<string, string> = {};
  for (const [i, q] of questions.entries()) {
    const chosen = q.options.map((o) => o.label).filter((label) => picked.get(i)?.has(label));
    const extra = other.get(i)?.trim();
    const values = extra ? [...chosen, extra] : chosen;
    if (values.length === 0) return null;
    answers[q.question] = values.join(', ');
  }
  return answers;
}

export function extractPlan(input: Record<string, unknown>): string {
  if (typeof input.plan === 'string' && input.plan.trim()) return input.plan;
  if (typeof input.planFilePath === 'string') return `계획 파일: ${input.planFilePath}`;
  return '(계획 본문 없음)';
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/session/approvalInputs.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 승인 카드 교체**

`src/ui/ApprovalCard.ts` (전체 교체):
```ts
import type { ItemOf } from '../chat/ChatState';
import type { ApprovalDecision } from '../session/ApprovalBroker';
import { buildAnswers, extractPlan, parseQuestions } from '../session/approvalInputs';
import type { ApprovalRequest } from '../types';
import { toolSummary } from './toolFormat';

export interface ApprovalCardContext {
  vaultPath: string;
  onDecision(id: string, decision: ApprovalDecision): void;
  renderMarkdown(el: HTMLElement, markdown: string): void;
}

const CARD_TITLE: Record<string, string> = { AskUserQuestion: '질문', ExitPlanMode: '계획 승인' };

export function button(parent: HTMLElement, text: string, onClick: () => void, cta = false): HTMLButtonElement {
  const btn = parent.createEl('button', { text, cls: cta ? 'mod-cta' : '' });
  btn.addEventListener('click', onClick);
  return btn;
}

export function renderApprovalCard(el: HTMLElement, item: ItemOf<'approval'>, ctx: ApprovalCardContext): void {
  const { request } = item;
  el.empty();
  const card = el.createDiv({ cls: 'cp-approval' });
  if (item.settled) {
    card.addClass('is-settled');
    card.setText(`${CARD_TITLE[request.toolName] ?? request.toolName} — ${item.settled}`);
    return;
  }
  card.createDiv({ cls: 'cp-approval-title', text: CARD_TITLE[request.toolName] ?? '승인 필요' });
  if (request.toolName === 'AskUserQuestion') renderAskCard(card, request, ctx);
  else if (request.toolName === 'ExitPlanMode') renderPlanCard(card, request, ctx);
  else renderToolApproval(card, request, ctx);
}

function renderToolApproval(card: HTMLElement, request: ApprovalRequest, ctx: ApprovalCardContext): void {
  const summary = toolSummary(request.toolName, request.input, ctx.vaultPath);
  card.createDiv({ cls: 'cp-approval-desc', text: request.title ?? (summary ? `${request.toolName}: ${summary}` : request.toolName) });
  if (request.reason) card.createDiv({ cls: 'cp-approval-reason', text: request.reason });
  const row = card.createDiv({ cls: 'cp-approval-actions' });
  button(row, '허용', () => ctx.onDecision(request.id, { type: 'allow' }), true);
  if (request.canAlwaysAllow) button(row, '항상 허용', () => ctx.onDecision(request.id, { type: 'allow-always' }));
  button(row, '거부…', () => showReasonInput(card, '거부 사유 (Claude에 전달, 선택)', '거부 보내기', (message) => ctx.onDecision(request.id, { type: 'deny', message })));
}

function renderAskCard(card: HTMLElement, request: ApprovalRequest, ctx: ApprovalCardContext): void {
  const questions = parseQuestions(request.input);
  const picked = new Map<number, Set<string>>();
  const other = new Map<number, string>();
  const list = card.createDiv({ cls: 'cp-ask-list' });
  const row = card.createDiv({ cls: 'cp-approval-actions' });
  const submit = button(row, '답변 보내기', () => {
    const answers = buildAnswers(questions, picked, other);
    if (answers) ctx.onDecision(request.id, { type: 'answer', answers });
  }, true);
  button(row, '거부…', () => showReasonInput(card, '거부 사유 (선택)', '거부 보내기', (message) => ctx.onDecision(request.id, { type: 'deny', message })));
  const refresh = () => {
    submit.disabled = buildAnswers(questions, picked, other) === null;
  };

  questions.forEach((q, i) => {
    const box = list.createDiv({ cls: 'cp-ask' });
    if (q.header) box.createSpan({ cls: 'cp-ask-header', text: q.header });
    box.createDiv({ cls: 'cp-ask-question', text: q.question });
    const options = box.createDiv({ cls: 'cp-ask-options' });
    for (const option of q.options) {
      const btn = options.createEl('button', { cls: 'cp-ask-option' });
      btn.createDiv({ text: option.label });
      if (option.description) btn.createDiv({ cls: 'cp-ask-desc', text: option.description });
      btn.addEventListener('click', () => {
        const set = picked.get(i) ?? new Set<string>();
        if (q.multiSelect) {
          if (set.has(option.label)) set.delete(option.label);
          else set.add(option.label);
        } else {
          set.clear();
          set.add(option.label);
          options.querySelectorAll('.cp-ask-option').forEach((sibling) => sibling.removeClass('is-selected'));
        }
        picked.set(i, set);
        btn.toggleClass('is-selected', set.has(option.label));
        refresh();
      });
    }
    const otherInput = box.createEl('input', { type: 'text', cls: 'cp-ask-other', attr: { placeholder: '기타 (직접 입력)' } });
    otherInput.addEventListener('input', () => {
      other.set(i, otherInput.value);
      refresh();
    });
  });
  refresh();
}

function renderPlanCard(card: HTMLElement, request: ApprovalRequest, ctx: ApprovalCardContext): void {
  const planEl = card.createDiv({ cls: 'cp-plan markdown-rendered' });
  ctx.renderMarkdown(planEl, extractPlan(request.input));
  const row = card.createDiv({ cls: 'cp-approval-actions' });
  button(row, '승인하고 진행', () => ctx.onDecision(request.id, { type: 'plan-approve' }), true);
  button(row, '계속 계획…', () => showReasonInput(card, '계획에 대한 의견', '의견 보내기', (feedback) => ctx.onDecision(request.id, { type: 'plan-revise', feedback })));
}

function showReasonInput(card: HTMLElement, placeholder: string, submitText: string, submit: (text: string) => void): void {
  if (card.querySelector('.cp-deny-row')) return;
  const row = card.createDiv({ cls: 'cp-deny-row' });
  const input = row.createEl('input', { type: 'text', attr: { placeholder } });
  const send = () => submit(input.value.trim());
  button(row, submitText, send);
  input.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && !evt.isComposing) {
      evt.preventDefault();
      send();
    }
  });
  input.focus();
}
```

- [ ] **Step 6: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-ask { margin: 6px 0; }
.cp-ask-header { font-size: var(--font-ui-smaller); color: var(--text-accent); border: 1px solid var(--text-accent); border-radius: var(--radius-s); padding: 0 4px; }
.cp-ask-question { margin: 4px 0; }
.cp-ask-options { display: flex; flex-direction: column; gap: 4px; }
.cp-ask-option { text-align: left; height: auto; padding: 4px 8px; white-space: normal; }
.cp-ask-option.is-selected { border: 1px solid var(--interactive-accent); background: var(--background-modifier-hover); }
.cp-ask-desc { font-size: var(--font-ui-smaller); color: var(--text-muted); }
.cp-ask-other { width: 100%; margin-top: 4px; }
.cp-plan { max-height: 360px; overflow-y: auto; border-left: 2px solid var(--interactive-accent); padding-left: 8px; margin: 4px 0; }
```

- [ ] **Step 7: 빌드 검증 후 Commit**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

```bash
git add src/session/approvalInputs.ts tests/session/approvalInputs.test.ts src/ui/ApprovalCard.ts styles.css
git commit -m "feat: add AskUserQuestion and plan approval cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 11: 상단 막대 — 모델·추론 강도·권한 모드·컨텍스트 사용률

**Files:**
- Create: `src/ui/Toolbar.ts`
- Modify: `src/ui/ChatView.ts`, `styles.css` (끝에 추가)
- Test: `tests/ui/Toolbar.test.ts`

**Interfaces:**
- Consumes: `ClaudeSession.setModel/setEffort/setPermissionMode/supportedModels/permissionMode` (Task 6), `PanelEvent` `init`·`mode-changed`·`context-usage`
- Produces:
```ts
export const MODE_ORDER: PermissionMode[];            // ['default', 'acceptEdits', 'plan', 'auto']
export const EFFORT_LEVELS: EffortLevel[];            // ['low', 'medium', 'high', 'xhigh', 'max']
export function nextMode(current: PermissionMode | null): PermissionMode;
export function effortOptions(models: ModelInfo[], model: string | null): EffortLevel[];
export function modeOptions(current: string | null): { value: string; label: string }[];
export interface ToolbarHandlers { onModel(value: string | undefined): void; onEffort(value: EffortLevel | undefined): void; onMode(mode: PermissionMode): void }
export class Toolbar { constructor(parent: HTMLElement, h: ToolbarHandlers); reset(): void; setModels(models: ModelInfo[]): void; setResolvedModel(model: string): void; setMode(mode: string | null): void; setContext(pct: number | null): void }
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/Toolbar.test.ts`:
```ts
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { EFFORT_LEVELS, effortOptions, modeOptions, nextMode } from '../../src/ui/Toolbar';

const models: ModelInfo[] = [
  { value: 'opus', displayName: 'Opus', description: '', resolvedModel: 'claude-opus-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: '', supportsEffort: false },
  { value: 'sonnet', displayName: 'Sonnet', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
];

describe('nextMode', () => {
  it('기본 → 편집 자동 → 계획 → auto → 기본 순으로 돈다', () => {
    expect(nextMode('default')).toBe('acceptEdits');
    expect(nextMode('acceptEdits')).toBe('plan');
    expect(nextMode('plan')).toBe('auto');
    expect(nextMode('auto')).toBe('default');
  });
  it('모르는 모드·null은 기본부터', () => {
    expect(nextMode(null)).toBe('default');
    expect(nextMode('bypassPermissions')).toBe('default');
  });
});

describe('effortOptions', () => {
  it('모델이 지원하는 단계만, 모르면 전체', () => {
    expect(effortOptions(models, 'sonnet')).toEqual(['low', 'medium', 'high']);
    expect(effortOptions(models, 'claude-opus-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortOptions(models, 'haiku')).toEqual([]);
    expect(effortOptions([], null)).toEqual(EFFORT_LEVELS);
  });
});

describe('modeOptions', () => {
  it('현재 모드를 모르면 "설정값" 항목을 앞에 둔다', () => {
    expect(modeOptions(null)[0]).toEqual({ value: '', label: '권한: 설정값' });
    expect(modeOptions('auto').map((o) => o.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });
  it('순환 목록에 없는 현재 모드도 표시한다', () => {
    expect(modeOptions('dontAsk').map((o) => o.value)).toContain('dontAsk');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/Toolbar.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/ui/Toolbar"`

- [ ] **Step 3: Toolbar 구현**

`src/ui/Toolbar.ts`:
```ts
import type { EffortLevel, ModelInfo, PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export const MODE_ORDER: PermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto'];
export const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const MODE_LABEL: Record<string, string> = { default: '기본', acceptEdits: '편집 자동', plan: '계획', auto: 'auto', dontAsk: 'dontAsk', bypassPermissions: '전체 허용' };
const FALLBACK_MODELS = [
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

export function nextMode(current: PermissionMode | null): PermissionMode {
  const i = current ? MODE_ORDER.indexOf(current) : -1;
  return MODE_ORDER[(i + 1) % MODE_ORDER.length];
}

export function effortOptions(models: ModelInfo[], model: string | null): EffortLevel[] {
  const info = model ? models.find((m) => m.value === model || m.resolvedModel === model) : undefined;
  if (info?.supportsEffort === false) return [];
  return info?.supportedEffortLevels?.length ? info.supportedEffortLevels : EFFORT_LEVELS;
}

export function modeOptions(current: string | null): { value: string; label: string }[] {
  const values: string[] = [...MODE_ORDER];
  if (current && !values.includes(current)) values.push(current);
  const list = values.map((value) => ({ value, label: MODE_LABEL[value] ?? value }));
  return current ? list : [{ value: '', label: '권한: 설정값' }, ...list];
}

export interface ToolbarHandlers {
  onModel(value: string | undefined): void;
  onEffort(value: EffortLevel | undefined): void;
  onMode(mode: PermissionMode): void;
}

export class Toolbar {
  private readonly modelSel: HTMLSelectElement;
  private readonly effortSel: HTMLSelectElement;
  private readonly modeSel: HTMLSelectElement;
  private readonly contextEl: HTMLElement;
  private models: ModelInfo[] = [];
  private resolvedModel: string | null = null;

  constructor(parent: HTMLElement, h: ToolbarHandlers) {
    const row = parent.createDiv({ cls: 'cp-toolbar' });
    this.modelSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '모델' } });
    this.effortSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '추론 강도' } });
    this.modeSel = row.createEl('select', { cls: 'dropdown cp-select', attr: { 'aria-label': '권한 모드 (Shift+Tab)' } });
    this.contextEl = row.createSpan({ cls: 'cp-context', attr: { 'aria-label': '컨텍스트 사용률' } });
    this.modelSel.addEventListener('change', () => {
      h.onModel(this.modelSel.value || undefined);
      this.renderEfforts(this.effortSel.value);
    });
    this.effortSel.addEventListener('change', () => h.onEffort((this.effortSel.value || undefined) as EffortLevel | undefined));
    this.modeSel.addEventListener('change', () => {
      if (this.modeSel.value) h.onMode(this.modeSel.value as PermissionMode);
    });
    this.reset();
  }

  /** 새 대화: 패널에서 바꾼 값 없이 설정값을 따르는 상태로 되돌린다. */
  reset(): void {
    this.models = [];
    this.resolvedModel = null;
    this.renderModels('');
    this.renderEfforts('');
    this.setMode(null);
    this.setContext(null);
  }

  setModels(models: ModelInfo[]): void {
    this.models = models;
    this.renderModels(this.modelSel.value);
    this.renderEfforts(this.effortSel.value);
  }

  /** init이 알려 준 실제 모델 id */
  setResolvedModel(model: string): void {
    this.resolvedModel = model;
    this.modelSel.title = `현재 모델: ${model}`;
    this.renderEfforts(this.effortSel.value);
  }

  setMode(mode: string | null): void {
    this.modeSel.empty();
    for (const o of modeOptions(mode)) this.modeSel.createEl('option', { value: o.value, text: o.label });
    this.modeSel.value = mode ?? '';
  }

  setContext(percentage: number | null): void {
    this.contextEl.setText(percentage === null ? '' : `◔ ${Math.round(percentage)}%`);
    this.contextEl.toggleClass('is-high', percentage !== null && percentage >= 80);
  }

  private renderModels(selected: string): void {
    const sel = this.modelSel;
    sel.empty();
    sel.createEl('option', { value: '', text: '기본 모델' });
    const list = this.models.length > 0 ? this.models.map((m) => ({ value: m.value, label: m.displayName })) : FALLBACK_MODELS;
    for (const m of list) {
      if (m.value && m.value !== 'default') sel.createEl('option', { value: m.value, text: m.label });
    }
    if (selected && !list.some((m) => m.value === selected)) sel.createEl('option', { value: selected, text: selected });
    sel.value = selected;
  }

  private renderEfforts(selected: string): void {
    const levels = effortOptions(this.models, this.modelSel.value || this.resolvedModel);
    const sel = this.effortSel;
    sel.empty();
    sel.createEl('option', { value: '', text: '추론 기본' });
    for (const level of levels) sel.createEl('option', { value: level, text: `추론 ${level}` });
    sel.value = levels.includes(selected as EffortLevel) ? selected : '';
    sel.toggle(levels.length > 0);
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/Toolbar.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: ChatView에 연결**

`src/ui/ChatView.ts` 수정:

import 추가:
```ts
import { Toolbar, nextMode } from './Toolbar';
```

필드 추가 (`private titleEl!: HTMLElement;` 아래):
```ts
  private toolbar!: Toolbar;
```

`onOpen()`에서 `this.iconButton(actions, 'plus', '새 대화', () => this.newChat());` 바로 아래에 추가:
```ts
    this.toolbar = new Toolbar(this.headerEl, {
      onModel: (value) => void this.session?.setModel(value),
      onEffort: (value) => void this.session?.setEffort(value),
      onMode: (mode) => void this.session?.setPermissionMode(mode),
    });
```

`onOpen()`의 Composer 생성부를 다음으로 교체 (`onCycleMode` 추가):
```ts
    this.composer = new Composer(root.createDiv({ cls: 'cp-composer' }), {
      sendKey: () => this.plugin.settings.sendKey,
      onSubmit: (text) => this.submit(text),
      onStop: () => void this.session?.interrupt(),
      onCycleMode: () => this.cycleMode(),
    });
```

`useSession()` 끝에 추가:
```ts
    this.toolbar.reset();
```

`onEvent()`를 교체하고 두 메서드를 추가:
```ts
  private onEvent(e: PanelEvent): void {
    this.list.update(this.state.apply(e));
    this.composer.setBusy(this.state.busy);
    this.updateToolbar(e);
  }

  private updateToolbar(e: PanelEvent): void {
    if (e.kind === 'init') {
      this.toolbar.setResolvedModel(e.model);
      this.toolbar.setMode(e.permissionMode);
      const session = this.session;
      void session?.supportedModels().then((models) => {
        if (this.session === session) this.toolbar.setModels(models);
      }).catch(() => undefined);
    } else if (e.kind === 'mode-changed') {
      this.toolbar.setMode(e.permissionMode);
    } else if (e.kind === 'context-usage') {
      this.toolbar.setContext(e.percentage);
    }
  }

  private cycleMode(): void {
    const session = this.session;
    if (session) void session.setPermissionMode(nextMode(session.permissionMode));
  }
```

- [ ] **Step 6: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-toolbar { display: flex; align-items: center; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
.cp-select { font-size: var(--font-ui-smaller); height: auto; padding: 2px 20px 2px 6px; max-width: 9em; }
.cp-context { margin-left: auto; font-size: var(--font-ui-smaller); color: var(--text-muted); }
.cp-context.is-high { color: var(--text-warning); }
```

- [ ] **Step 7: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 8: [사용자 확인] 승인·모드 수동 점검**

- [ ] 상단 막대에 모델·추론·권한 선택과 첫 턴 뒤 `◔ n%` 표시
- [ ] 권한을 **기본**으로 바꾸고 "scratch.md 파일을 만들어 줘" → 승인 카드 [허용]/[항상 허용]/[거부…], 거부 사유가 Claude 답변에 반영
- [ ] 입력창에서 Shift+Tab → 권한 모드가 기본 → 편집 자동 → 계획 → auto 순으로 바뀜
- [ ] **계획** 모드에서 작업 요청 → 계획 승인 카드(마크다운 본문) → [계속 계획…]에 의견 → 수정된 계획 → [승인하고 진행] → 모드가 계획 이전 값으로 돌아가고 실행됨
- [ ] "선택지를 주고 나에게 물어본 뒤 진행해 줘(AskUserQuestion 사용)" → 질문 카드에서 선택·기타 입력·다중 선택 → 답이 Claude에 전달
- [ ] 모델을 Haiku로 바꾸면 추론 선택이 사라짐, 새 대화 → 선택값이 초기화

- [ ] **Step 9: Commit**

```bash
git add src/ui/Toolbar.ts tests/ui/Toolbar.test.ts src/ui/ChatView.ts styles.css
git commit -m "feat: add model, effort and permission mode toolbar with context usage

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 4단계 — 컨텍스트·자동완성

### Task 12: ContextBuilder (프롬프트 조립·칩 해제 상태)

**Files:**
- Create: `src/context/ContextBuilder.ts`
- Test: `tests/context/ContextBuilder.test.ts`

**Interfaces:**
- Produces:
```ts
export interface NoteRef { path: string }
export interface SelectionRef { path: string; fromLine: number; toLine: number; text: string }   // 줄 번호는 1부터
export interface ContextSnapshot { note: NoteRef | null; selection: SelectionRef | null }
export function fenceFor(text: string): string;
export function buildPrompt(userText: string, ctx: ContextSnapshot): { prompt: string; contextLabel: string | null };
export class ContextSelection { update(next: ContextSnapshot): void; dismiss(kind: 'note' | 'selection'): void; effective(): ContextSnapshot; consumeSelection(): void }
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/context/ContextBuilder.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ContextSelection, buildPrompt, fenceFor, type ContextSnapshot } from '../../src/context/ContextBuilder';

const note = { path: '회의/2026-04-20 B1 서버실 구상.md' };
const selection = { path: '회의/2026-04-20 B1 서버실 구상.md', fromLine: 10, toLine: 15, text: '- 랙 2개\n- UPS' };

describe('buildPrompt', () => {
  it('컨텍스트가 없으면 원문 그대로', () => {
    expect(buildPrompt('안녕', { note: null, selection: null })).toEqual({ prompt: '안녕', contextLabel: null });
  });
  it('노트는 경로만 첨부한다', () => {
    expect(buildPrompt('요약해 줘', { note, selection: null })).toEqual({
      prompt: '<context>\n현재 노트: 회의/2026-04-20 B1 서버실 구상.md\n</context>\n\n요약해 줘',
      contextLabel: '📄 2026-04-20 B1 서버실 구상',
    });
  });
  it('선택 영역은 경로·줄 범위·텍스트를 코드 펜스로 첨부한다', () => {
    const r = buildPrompt('다듬어 줘', { note, selection });
    expect(r.prompt).toBe(
      '<context>\n현재 노트: 회의/2026-04-20 B1 서버실 구상.md\n선택 영역: 회의/2026-04-20 B1 서버실 구상.md L10-15\n```\n- 랙 2개\n- UPS\n```\n</context>\n\n다듬어 줘',
    );
    expect(r.contextLabel).toBe('📄 2026-04-20 B1 서버실 구상 · ✂ L10–15');
  });
  it('/명령에는 컨텍스트를 붙이지 않는다', () => {
    expect(buildPrompt('/ingest raw/a.pdf', { note, selection })).toEqual({ prompt: '/ingest raw/a.pdf', contextLabel: null });
  });
});

describe('fenceFor', () => {
  it('본문의 가장 긴 백틱 연속보다 길게', () => {
    expect(fenceFor('plain')).toBe('```');
    expect(fenceFor('a ```js b')).toBe('````');
  });
});

describe('ContextSelection', () => {
  const snap: ContextSnapshot = { note, selection };
  it('해제한 칩은 제외하고, 대상이 바뀌면 다시 붙는다', () => {
    const cs = new ContextSelection();
    cs.update(snap);
    cs.dismiss('note');
    expect(cs.effective()).toEqual({ note: null, selection });
    cs.update({ note: { path: 'other.md' }, selection: null });
    expect(cs.effective().note).toEqual({ path: 'other.md' });
  });
  it('보낸 선택 영역은 같은 선택이 유지되는 동안 다시 붙이지 않는다', () => {
    const cs = new ContextSelection();
    cs.update(snap);
    cs.consumeSelection();
    cs.update(snap);
    expect(cs.effective().selection).toBeNull();
    cs.update({ note, selection: { ...selection, toLine: 16, text: '- 랙 2개\n- UPS\n- 공조' } });
    expect(cs.effective().selection).not.toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/context/ContextBuilder.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/context/ContextBuilder"`

- [ ] **Step 3: 구현**

`src/context/ContextBuilder.ts`:
```ts
export interface NoteRef {
  path: string;
}

export interface SelectionRef {
  path: string;
  /** 1부터 시작 */
  fromLine: number;
  toLine: number;
  text: string;
}

export interface ContextSnapshot {
  note: NoteRef | null;
  selection: SelectionRef | null;
}

function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/** 본문 안의 코드 펜스와 겹치지 않는 펜스 */
export function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * 사용자 입력에 컨텍스트를 붙인다. 노트는 경로만 (필요하면 Claude가 Read로 읽는다).
 * `/명령`은 CLI가 맨 앞만 명령으로 해석하므로 컨텍스트를 붙이지 않는다.
 */
export function buildPrompt(userText: string, ctx: ContextSnapshot): { prompt: string; contextLabel: string | null } {
  if (userText.startsWith('/')) return { prompt: userText, contextLabel: null };
  const lines: string[] = [];
  const labels: string[] = [];
  if (ctx.note) {
    lines.push(`현재 노트: ${ctx.note.path}`);
    labels.push(`📄 ${noteName(ctx.note.path)}`);
  }
  if (ctx.selection) {
    const s = ctx.selection;
    const fence = fenceFor(s.text);
    lines.push(`선택 영역: ${s.path} L${s.fromLine}-${s.toLine}`, fence, s.text, fence);
    labels.push(ctx.note?.path === s.path ? `✂ L${s.fromLine}–${s.toLine}` : `✂ ${noteName(s.path)} L${s.fromLine}–${s.toLine}`);
  }
  if (lines.length === 0) return { prompt: userText, contextLabel: null };
  return { prompt: `<context>\n${lines.join('\n')}\n</context>\n\n${userText}`, contextLabel: labels.join(' · ') };
}

const noteKey = (n: NoteRef) => n.path;
const selectionKey = (s: SelectionRef) => `${s.path}:${s.fromLine}:${s.toLine}:${s.text}`;

/** 칩의 × 상태. 대상(노트·선택)이 바뀌면 해제가 풀린다. */
export class ContextSelection {
  private snapshot: ContextSnapshot = { note: null, selection: null };
  private dismissedNote: string | null = null;
  private dismissedSelection: string | null = null;

  update(next: ContextSnapshot): void {
    this.snapshot = next;
  }

  dismiss(kind: 'note' | 'selection'): void {
    if (kind === 'note' && this.snapshot.note) this.dismissedNote = noteKey(this.snapshot.note);
    if (kind === 'selection' && this.snapshot.selection) this.dismissedSelection = selectionKey(this.snapshot.selection);
  }

  effective(): ContextSnapshot {
    const { note, selection } = this.snapshot;
    return {
      note: note && noteKey(note) !== this.dismissedNote ? note : null,
      selection: selection && selectionKey(selection) !== this.dismissedSelection ? selection : null,
    };
  }

  /** 전송 후: 같은 선택 영역을 다음 메시지에 다시 붙이지 않는다. */
  consumeSelection(): void {
    this.dismiss('selection');
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/context/ContextBuilder.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/context/ContextBuilder.ts tests/context/ContextBuilder.test.ts
git commit -m "feat: build prompts with note and selection context

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 13: 활성 노트 추적 + 컨텍스트 칩

**Files:**
- Create: `src/context/ActiveNoteTracker.ts`
- Modify: `src/ui/ChatView.ts`, `styles.css` (끝에 추가)

**Interfaces:**
- Consumes: `ContextSnapshot`, `ContextSelection`, `buildPrompt` (Task 12), `Composer.chipsEl`, `ComposerHandlers.onFocus` (Task 9), `settings.attachActiveNote`
- Produces: `class ActiveNoteTracker { constructor(app: App, onChange: () => void); attach(register: (ref: EventRef) => void): void; snapshot(includeNote: boolean): ContextSnapshot }`

- [ ] **Step 1: 추적기 작성**

`src/context/ActiveNoteTracker.ts`:
```ts
import { MarkdownView, type App, type EventRef } from 'obsidian';
import type { ContextSnapshot } from './ContextBuilder';

/**
 * 사이드바 패널에 포커스가 가면 활성 뷰가 패널이 되므로,
 * 마지막으로 활성이었던 마크다운 편집기를 기억해 두고 그 노트·선택 영역을 읽는다.
 */
export class ActiveNoteTracker {
  private last: MarkdownView | null = null;

  constructor(private readonly app: App, private readonly onChange: () => void) {}

  attach(register: (ref: EventRef) => void): void {
    this.last = this.app.workspace.getActiveViewOfType(MarkdownView);
    register(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.last = leaf.view;
          this.onChange();
        }
      }),
    );
    register(this.app.workspace.on('file-open', () => this.onChange()));
  }

  snapshot(includeNote: boolean): ContextSnapshot {
    const view = this.last;
    const alive = view !== null && this.app.workspace.getLeavesOfType('markdown').some((leaf) => leaf.view === view);
    if (!alive || !view.file) return { note: null, selection: null };
    const path = view.file.path;
    const editor = view.editor;
    let selection: ContextSnapshot['selection'] = null;
    if (editor.somethingSelected()) {
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      selection = { path, fromLine: from.line + 1, toLine: to.line + 1, text: editor.getSelection() };
    }
    return { note: includeNote ? { path } : null, selection };
  }
}
```

- [ ] **Step 2: ChatView에 연결**

`src/ui/ChatView.ts` 수정:

import 추가:
```ts
import { ContextSelection, buildPrompt } from '../context/ContextBuilder';
import { ActiveNoteTracker } from '../context/ActiveNoteTracker';
```

필드 추가:
```ts
  private tracker!: ActiveNoteTracker;
  private readonly contextSel = new ContextSelection();
```

`onOpen()`의 Composer 생성부에 `onFocus` 추가:
```ts
    this.composer = new Composer(root.createDiv({ cls: 'cp-composer' }), {
      sendKey: () => this.plugin.settings.sendKey,
      onSubmit: (text) => this.submit(text),
      onStop: () => void this.session?.interrupt(),
      onCycleMode: () => this.cycleMode(),
      onFocus: () => this.refreshContext(),
    });
```

`onOpen()`의 `this.newChat();` 바로 앞에 추가:
```ts
    this.tracker = new ActiveNoteTracker(this.app, () => this.refreshContext());
    this.tracker.attach((ref) => this.registerEvent(ref));
    this.refreshContext();
```

`submit()`을 교체하고 두 메서드를 추가:
```ts
  private submit(text: string): void {
    const session = this.session;
    if (!session) return;
    this.refreshContext();
    const { prompt, contextLabel } = buildPrompt(text, this.contextSel.effective());
    session.send({ prompt, display: text, contextLabel });
    if (!text.startsWith('/')) this.contextSel.consumeSelection();
    this.renderChips();
  }

  private refreshContext(): void {
    this.contextSel.update(this.tracker.snapshot(this.plugin.settings.attachActiveNote));
    this.renderChips();
  }

  private renderChips(): void {
    const el = this.composer.chipsEl;
    el.empty();
    const { note, selection } = this.contextSel.effective();
    if (note) this.chip(el, `📄 ${note.path.split('/').pop()?.replace(/\.md$/, '') ?? note.path}`, note.path, () => this.contextSel.dismiss('note'));
    if (selection) this.chip(el, `✂ 선택 L${selection.fromLine}–${selection.toLine}`, selection.text.slice(0, 200), () => this.contextSel.dismiss('selection'));
  }

  private chip(parent: HTMLElement, label: string, tooltip: string, onDismiss: () => void): void {
    const chip = parent.createDiv({ cls: 'cp-chip', attr: { title: tooltip } });
    chip.createSpan({ text: label });
    const x = chip.createSpan({ cls: 'cp-chip-x', text: '×', attr: { 'aria-label': '이번 전송에서 빼기' } });
    x.addEventListener('click', () => {
      onDismiss();
      this.renderChips();
    });
  }
```

- [ ] **Step 3: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-chips { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 4px; }
.cp-chips:empty { display: none; }
.cp-chip { display: inline-flex; gap: 4px; align-items: center; font-size: var(--font-ui-smaller); background: var(--background-secondary); border-radius: var(--radius-s); padding: 1px 6px; max-width: 100%; }
.cp-chip > span:first-child { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.cp-chip-x { cursor: pointer; color: var(--text-muted); }
.cp-chip-x:hover { color: var(--text-normal); }
```

- [ ] **Step 4: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 5: [사용자 확인] 컨텍스트 수동 점검**

- [ ] 노트를 열고 패널 입력창 클릭 → `📄 노트이름` 칩 표시, 다른 노트로 전환하면 칩이 바뀜
- [ ] 노트에서 몇 줄 선택 후 입력창 클릭 → `✂ 선택 Lx–y` 칩, "이 부분 요약해 줘" 전송 → 사용자 메시지 위에 `📄 … · ✂ L…` 표시, 답변이 선택 영역 기준
- [ ] 같은 선택을 유지한 채 다음 메시지 → 선택 칩이 다시 붙지 않음
- [ ] 칩 × → 이번 전송에서 빠짐 / 설정에서 "현재 노트 자동 첨부" 끄면 노트 칩이 사라짐
- [ ] `/`로 시작하는 메시지는 컨텍스트 없이 전송됨

- [ ] **Step 6: Commit**

```bash
git add src/context/ActiveNoteTracker.ts src/ui/ChatView.ts styles.css
git commit -m "feat: attach active note and selection as context chips

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 14: `/` 명령·스킬 자동완성

**Files:**
- Create: `src/ui/commandMatch.ts`, `src/ui/SlashPopup.ts`
- Modify: `src/ui/ChatView.ts`, `styles.css` (끝에 추가)
- Test: `tests/ui/commandMatch.test.ts`

**Interfaces:**
- Consumes: `ClaudeSession.ensureStarted/supportedCommands` (Task 6), `ComposerHandlers.onInput/onKeyDownCapture`, `Composer.setValue/el` (Task 9)
- Produces:
```ts
export interface CommandItem { name: string; description: string; argumentHint: string }
export function toCommandItems(commands: { name: string; description: string; argumentHint: string }[]): CommandItem[];
export function slashToken(value: string, cursor: number): string | null;
export function matchCommands(query: string, commands: CommandItem[], limit?: number): CommandItem[];
export function applyCommand(value: string, cursor: number, name: string): { value: string; cursor: number };
export class SlashPopup { constructor(parent: HTMLElement, onPick: (item: CommandItem) => void); readonly isOpen: boolean; show(items: CommandItem[]): void; hide(): void; handleKey(evt: KeyboardEvent): boolean }
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/ui/commandMatch.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { applyCommand, matchCommands, slashToken, toCommandItems, type CommandItem } from '../../src/ui/commandMatch';

const cmd = (name: string): CommandItem => ({ name, description: '', argumentHint: '' });

describe('slashToken', () => {
  it('입력 맨 앞의 /토큰 안에 커서가 있을 때만 토큰을 준다', () => {
    expect(slashToken('/ing', 4)).toBe('ing');
    expect(slashToken('/', 1)).toBe('');
    expect(slashToken('/ingest raw', 11)).toBeNull();
    expect(slashToken('hi /ing', 7)).toBeNull();
    expect(slashToken('/ing', 2)).toBe('i');
  });
});

describe('matchCommands', () => {
  const commands = ['ingest', 'init', 'query', 'superpowers:brainstorming', 'lint'].map(cmd);
  it('접두어 일치를 먼저, 부분 일치를 나중에 이름순으로', () => {
    expect(matchCommands('in', commands).map((c) => c.name)).toEqual(['ingest', 'init', 'lint', 'superpowers:brainstorming']);
  });
  it('빈 질의는 전체를 이름순으로, 개수 제한', () => {
    expect(matchCommands('', commands, 2).map((c) => c.name)).toEqual(['ingest', 'init']);
  });
  it('대소문자 무시', () => {
    expect(matchCommands('QUE', commands).map((c) => c.name)).toEqual(['query']);
  });
});

describe('applyCommand', () => {
  it('토큰을 /이름 + 공백으로 바꾸고 뒤 텍스트를 보존한다', () => {
    expect(applyCommand('/ing', 4, 'ingest')).toEqual({ value: '/ingest ', cursor: 8 });
    expect(applyCommand('/ing raw/a.pdf', 4, 'ingest')).toEqual({ value: '/ingest raw/a.pdf', cursor: 8 });
  });
});

describe('toCommandItems', () => {
  it('앞의 /를 떼고 중복을 없앤다', () => {
    expect(toCommandItems([{ name: '/ingest', description: 'd', argumentHint: '' }, { name: 'ingest', description: 'd2', argumentHint: '' }]))
      .toEqual([{ name: 'ingest', description: 'd', argumentHint: '' }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/ui/commandMatch.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/ui/commandMatch"`

- [ ] **Step 3: 구현**

`src/ui/commandMatch.ts`:
```ts
export interface CommandItem {
  name: string;
  description: string;
  argumentHint: string;
}

export function toCommandItems(commands: { name: string; description: string; argumentHint: string }[]): CommandItem[] {
  const seen = new Set<string>();
  const items: CommandItem[] = [];
  for (const c of commands) {
    const name = c.name.replace(/^\//, '');
    if (!name || seen.has(name)) continue;
    seen.add(name);
    items.push({ name, description: c.description, argumentHint: c.argumentHint });
  }
  return items;
}

/** 입력 맨 앞의 `/토큰` 안에 커서가 있으면 토큰(슬래시 제외)을, 아니면 null. */
export function slashToken(value: string, cursor: number): string | null {
  const m = /^\/(\S*)$/.exec(value.slice(0, cursor));
  return m ? m[1] : null;
}

export function matchCommands(query: string, commands: CommandItem[], limit = 20): CommandItem[] {
  const q = query.toLowerCase();
  const prefix: CommandItem[] = [];
  const contains: CommandItem[] = [];
  for (const c of commands) {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) prefix.push(c);
    else if (name.includes(q)) contains.push(c);
  }
  const byName = (a: CommandItem, b: CommandItem) => a.name.localeCompare(b.name);
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit);
}

export function applyCommand(value: string, cursor: number, name: string): { value: string; cursor: number } {
  const rest = value.slice(cursor).replace(/^\S*/, '').replace(/^\s+/, '');
  const head = `/${name} `;
  return { value: head + rest, cursor: head.length };
}
```

`src/ui/SlashPopup.ts`:
```ts
import type { CommandItem } from './commandMatch';

export class SlashPopup {
  private readonly el: HTMLElement;
  private items: CommandItem[] = [];
  private index = 0;

  constructor(parent: HTMLElement, private readonly onPick: (item: CommandItem) => void) {
    this.el = parent.createDiv({ cls: 'cp-slash-popup' });
    this.el.hide();
  }

  get isOpen(): boolean {
    return this.el.isShown();
  }

  show(items: CommandItem[]): void {
    this.items = items;
    this.index = 0;
    if (items.length === 0) {
      this.hide();
      return;
    }
    this.render();
    this.el.show();
  }

  hide(): void {
    this.el.hide();
  }

  /** 팝업이 처리한 키면 true */
  handleKey(evt: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (evt.key === 'ArrowDown' || evt.key === 'ArrowUp') {
      const step = evt.key === 'ArrowDown' ? 1 : -1;
      this.index = (this.index + step + this.items.length) % this.items.length;
      this.render();
    } else if (evt.key === 'Enter' || evt.key === 'Tab') {
      this.onPick(this.items[this.index]);
      this.hide();
    } else if (evt.key === 'Escape') {
      this.hide();
    } else {
      return false;
    }
    evt.preventDefault();
    return true;
  }

  private render(): void {
    this.el.empty();
    this.items.forEach((item, i) => {
      const row = this.el.createDiv({ cls: 'cp-slash-item' });
      row.toggleClass('is-selected', i === this.index);
      row.createSpan({ cls: 'cp-slash-name', text: `/${item.name}` });
      if (item.argumentHint) row.createSpan({ cls: 'cp-slash-hint', text: item.argumentHint });
      if (item.description) row.createDiv({ cls: 'cp-slash-desc', text: item.description });
      row.addEventListener('mousedown', (evt) => {
        evt.preventDefault(); // 입력창 포커스 유지
        this.onPick(item);
        this.hide();
      });
    });
    this.el.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/ui/commandMatch.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: ChatView에 연결**

`src/ui/ChatView.ts` 수정:

import 추가:
```ts
import { applyCommand, matchCommands, slashToken, toCommandItems, type CommandItem } from './commandMatch';
import { SlashPopup } from './SlashPopup';
```

필드 추가:
```ts
  private slash!: SlashPopup;
  private commands: CommandItem[] | null = null;
```

`onOpen()`의 Composer 생성부를 교체하고 바로 아래에 팝업 생성 추가:
```ts
    this.composer = new Composer(root.createDiv({ cls: 'cp-composer' }), {
      sendKey: () => this.plugin.settings.sendKey,
      onSubmit: (text) => this.submit(text),
      onStop: () => void this.session?.interrupt(),
      onCycleMode: () => this.cycleMode(),
      onFocus: () => this.refreshContext(),
      onInput: (textarea) => void this.updateSlash(textarea),
      onKeyDownCapture: (evt) => this.slash.handleKey(evt),
    });
    this.slash = new SlashPopup(this.composer.el, (item) => this.pickCommand(item));
```

`useSession()` 끝에 추가:
```ts
    this.commands = null;
    this.slash.hide();
```

메서드 추가:
```ts
  private async updateSlash(textarea: HTMLTextAreaElement): Promise<void> {
    const token = slashToken(textarea.value, textarea.selectionStart);
    if (token === null) {
      this.slash.hide();
      return;
    }
    const session = this.session;
    if (!session) return;
    if (this.commands === null) {
      try {
        session.ensureStarted(); // 명령 목록은 CLI 초기화 결과에서만 얻을 수 있다
        this.commands = toCommandItems(await session.supportedCommands());
      } catch {
        return;
      }
      if (this.session !== session) return;
    }
    // 목록을 받는 동안 입력이 바뀌었을 수 있으므로 현재 값으로 다시 계산한다
    const current = slashToken(textarea.value, textarea.selectionStart);
    if (current === null) this.slash.hide();
    else this.slash.show(matchCommands(current, this.commands));
  }

  private pickCommand(item: CommandItem): void {
    const t = this.composer.textarea;
    const next = applyCommand(t.value, t.selectionStart, item.name);
    this.composer.setValue(next.value, next.cursor);
    this.composer.focus();
  }
```

- [ ] **Step 6: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-slash-popup { position: absolute; left: 10px; right: 10px; bottom: 100%; max-height: 260px; overflow-y: auto; background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: var(--radius-m); box-shadow: var(--shadow-s); z-index: 10; }
.cp-slash-item { padding: 4px 8px; cursor: pointer; }
.cp-slash-item.is-selected, .cp-slash-item:hover { background: var(--background-modifier-hover); }
.cp-slash-name { font-family: var(--font-monospace); }
.cp-slash-hint { margin-left: 6px; color: var(--text-faint); font-size: var(--font-ui-smaller); }
.cp-slash-desc { color: var(--text-muted); font-size: var(--font-ui-smaller); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
```

- [ ] **Step 7: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 8: [사용자 확인] 자동완성 수동 점검**

- [ ] 새 대화에서 `/` 입력 → 잠시 뒤 명령 목록(내장 명령 + vault 스킬 `ingest`·`lint`·`query` 등) 표시
- [ ] `/ing` → `ingest`가 맨 위, ↑↓ 이동, Enter/Tab 선택 → 입력창이 `/ingest `로 바뀜, Esc로 닫힘
- [ ] 한글 입력 중에는 팝업 키 처리가 끼어들지 않음
- [ ] `/ingest` 전송 → 스킬이 실행됨

- [ ] **Step 9: Commit**

```bash
git add src/ui/commandMatch.ts src/ui/SlashPopup.ts tests/ui/commandMatch.test.ts src/ui/ChatView.ts styles.css
git commit -m "feat: autocomplete slash commands and skills

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 5단계 — 스레드

### Task 15: ThreadService

**Files:**
- Create: `src/threads/ThreadService.ts`
- Test: `tests/threads/ThreadService.test.ts`

**Interfaces:**
- Consumes: `Normalizer` (Task 3), `PanelEvent`
- Produces:
```ts
export interface SessionApi {
  listSessions(o?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  getSessionMessages(id: string, o?: GetSessionMessagesOptions): Promise<SessionMessage[]>;
  getSessionInfo(id: string, o?: GetSessionInfoOptions): Promise<SDKSessionInfo | undefined>;
  forkSession(id: string, o?: ForkSessionOptions): Promise<ForkSessionResult>;
  renameSession(id: string, title: string, o?: SessionMutationOptions): Promise<void>;
}
export interface ThreadInfo { id: string; title: string; lastModified: number }
export type TitleGenerator = (firstMessage: string) => Promise<string>;
export class ThreadService {
  constructor(api: SessionApi, dir: () => string, generate: TitleGenerator);
  list(): Promise<ThreadInfo[]>;
  history(id: string): Promise<PanelEvent[]>;
  fork(id: string): Promise<string>;
  rename(id: string, title: string): Promise<void>;
  autoTitle(id: string, firstMessage: string): Promise<string>;
}
export function toThread(s: SDKSessionInfo): ThreadInfo;
export function cleanTitle(raw: string): string;
export function fallbackTitle(firstMessage: string): string;
export function titlePrompt(firstMessage: string): string;
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/threads/ThreadService.test.ts`:
```ts
import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ThreadService, cleanTitle, fallbackTitle, titlePrompt, toThread, type SessionApi } from '../../src/threads/ThreadService';

const sessions: SDKSessionInfo[] = [
  { sessionId: 'aaaaaaaa-1', summary: 'A 요약', lastModified: 1 },
  { sessionId: 'bbbbbbbb-2', summary: 'B', customTitle: '서버실 정리', lastModified: 3 },
  { sessionId: 'cccccccc-3', summary: '', firstPrompt: '첫 질문', lastModified: 2 },
];
const messages: SessionMessage[] = [
  { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'user', content: '<context>\n현재 노트: a.md\n</context>\n\n요약해 줘' } },
  { type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '요약입니다' }] } },
];

function makeApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    listSessions: vi.fn(async () => sessions),
    getSessionMessages: vi.fn(async () => messages),
    getSessionInfo: vi.fn(async (id: string) => ({ sessionId: id, summary: '', lastModified: 1 }) as SDKSessionInfo),
    forkSession: vi.fn(async () => ({ sessionId: 'forked-1' })),
    renameSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ThreadService', () => {
  it('vault 경로의 세션을 최근 순으로, 제목은 사용자 제목 > 요약 > 첫 프롬프트', async () => {
    const api = makeApi();
    const threads = await new ThreadService(api, () => '/vault', async () => '').list();
    expect(api.listSessions).toHaveBeenCalledWith({ dir: '/vault', includeWorktrees: false });
    expect(threads).toEqual([
      { id: 'bbbbbbbb-2', title: '서버실 정리', lastModified: 3 },
      { id: 'cccccccc-3', title: '첫 질문', lastModified: 2 },
      { id: 'aaaaaaaa-1', title: 'A 요약', lastModified: 1 },
    ]);
  });

  it('과거 대화를 history 모드로 정규화한다', async () => {
    const api = makeApi();
    const events = await new ThreadService(api, () => '/vault', async () => '').history('s');
    expect(api.getSessionMessages).toHaveBeenCalledWith('s', { dir: '/vault' });
    expect(events).toEqual([
      { kind: 'user-text', text: '요약해 줘' },
      { kind: 'block-final', key: 'm1#0', blockType: 'text', text: '요약입니다' },
    ]);
  });

  it('fork·rename은 vault 경로를 넘긴다', async () => {
    const api = makeApi();
    const svc = new ThreadService(api, () => '/vault', async () => '');
    expect(await svc.fork('s')).toBe('forked-1');
    expect(api.forkSession).toHaveBeenCalledWith('s', { dir: '/vault' });
    await svc.rename('s', '새 이름');
    expect(api.renameSession).toHaveBeenCalledWith('s', '새 이름', { dir: '/vault' });
  });

  it('autoTitle은 생성한 제목을 정리해 저장한다', async () => {
    const api = makeApi();
    const generate = vi.fn(async () => '"B1 서버실 구상 정리."\n설명');
    const title = await new ThreadService(api, () => '/vault', generate).autoTitle('s', '서버실 구상 노트를 정리해 줘');
    expect(generate).toHaveBeenCalledWith('서버실 구상 노트를 정리해 줘');
    expect(title).toBe('B1 서버실 구상 정리');
    expect(api.renameSession).toHaveBeenCalledWith('s', 'B1 서버실 구상 정리', { dir: '/vault' });
  });

  it('이미 사용자 제목이 있으면 생성하지 않는다', async () => {
    const api = makeApi({ getSessionInfo: vi.fn(async () => ({ sessionId: 's', summary: '', customTitle: '내 제목', lastModified: 1 })) });
    const generate = vi.fn(async () => 'x');
    expect(await new ThreadService(api, () => '/vault', generate).autoTitle('s', 'q')).toBe('내 제목');
    expect(generate).not.toHaveBeenCalled();
    expect(api.renameSession).not.toHaveBeenCalled();
  });

  it('생성이 실패하거나 비면 첫 메시지 앞부분을 제목으로 쓴다', async () => {
    const api = makeApi();
    const long = '이 문장은 서른 글자를 넘기기 위해서 일부러 길게 쓴 첫 번째 메시지입니다';
    const t1 = await new ThreadService(api, () => '/vault', async () => { throw new Error('limit'); }).autoTitle('s', long);
    expect(t1).toBe(`${long.slice(0, 30)}…`);
    const t2 = await new ThreadService(api, () => '/vault', async () => '  ').autoTitle('s', '짧은 질문');
    expect(t2).toBe('짧은 질문');
  });
});

describe('제목 보조 함수', () => {
  it('cleanTitle은 첫 줄만, 따옴표·#·끝 마침표를 떼고 60자로 자른다', () => {
    expect(cleanTitle('# "제목입니다."\n둘째 줄')).toBe('제목입니다');
    expect(cleanTitle('x'.repeat(100))).toHaveLength(60);
  });
  it('fallbackTitle·toThread·titlePrompt', () => {
    expect(fallbackTitle('   ')).toBe('새 대화');
    expect(toThread({ sessionId: 'dddddddd-4', summary: '', lastModified: 9 })).toEqual({ id: 'dddddddd-4', title: 'dddddddd', lastModified: 9 });
    expect(titlePrompt('hello')).toContain('<message>\nhello\n</message>');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/threads/ThreadService.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/threads/ThreadService"`

- [ ] **Step 3: 구현**

`src/threads/ThreadService.ts`:
```ts
import type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SDKSessionInfo,
  SessionMessage,
  SessionMutationOptions,
} from '@anthropic-ai/claude-agent-sdk';
import { Normalizer } from '../session/normalize';
import type { PanelEvent } from '../types';

/** SDK 세션 함수들 (테스트에서 주입) */
export interface SessionApi {
  listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  getSessionMessages(id: string, options?: GetSessionMessagesOptions): Promise<SessionMessage[]>;
  getSessionInfo(id: string, options?: GetSessionInfoOptions): Promise<SDKSessionInfo | undefined>;
  forkSession(id: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;
  renameSession(id: string, title: string, options?: SessionMutationOptions): Promise<void>;
}

export interface ThreadInfo {
  id: string;
  title: string;
  lastModified: number;
}

export type TitleGenerator = (firstMessage: string) => Promise<string>;

export function toThread(s: SDKSessionInfo): ThreadInfo {
  return { id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8), lastModified: s.lastModified };
}

export function cleanTitle(raw: string): string {
  const first = raw.trim().split('\n')[0] ?? '';
  return first.replace(/^[\s#"'“”‘’`]+/, '').replace(/[\s"'“”‘’`.]+$/, '').slice(0, 60);
}

export function fallbackTitle(firstMessage: string): string {
  const s = firstMessage.replace(/\s+/g, ' ').trim();
  if (!s) return '새 대화';
  return s.length > 30 ? `${s.slice(0, 30)}…` : s;
}

export function titlePrompt(firstMessage: string): string {
  return [
    'Write a short title (at most 6 words) for a conversation that starts with the message below.',
    "Use the same language as the message. Reply with the title only.",
    '',
    '<message>',
    firstMessage.slice(0, 1000),
    '</message>',
  ].join('\n');
}

/** 스레드 목록·과거 대화·fork·이름 변경·제목 생성. 터미널에서 시작한 같은 vault 경로의 세션도 포함된다. */
export class ThreadService {
  constructor(
    private readonly api: SessionApi,
    private readonly dir: () => string,
    private readonly generate: TitleGenerator,
  ) {}

  async list(): Promise<ThreadInfo[]> {
    const sessions = await this.api.listSessions({ dir: this.dir(), includeWorktrees: false });
    return sessions.map(toThread).sort((a, b) => b.lastModified - a.lastModified);
  }

  async history(id: string): Promise<PanelEvent[]> {
    const messages = await this.api.getSessionMessages(id, { dir: this.dir() });
    const normalizer = new Normalizer({ history: true });
    return messages.flatMap((m) => normalizer.push(m));
  }

  async fork(id: string): Promise<string> {
    return (await this.api.forkSession(id, { dir: this.dir() })).sessionId;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.api.renameSession(id, title, { dir: this.dir() });
  }

  /** 첫 턴이 끝난 새 세션에 제목을 붙이고 그 제목을 돌려준다. 사용자가 이미 이름을 붙였으면 그대로 둔다. */
  async autoTitle(id: string, firstMessage: string): Promise<string> {
    const info = await this.api.getSessionInfo(id, { dir: this.dir() });
    if (info?.customTitle) return info.customTitle;
    let title = '';
    try {
      title = cleanTitle(await this.generate(firstMessage));
    } catch {
      title = '';
    }
    if (!title) title = fallbackTitle(firstMessage);
    await this.api.renameSession(id, title, { dir: this.dir() });
    return title;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/threads/ThreadService.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/threads/ThreadService.ts tests/threads/ThreadService.test.ts
git commit -m "feat: add thread service for listing, history, fork, rename and titles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 16: 스레드 선택 모달·이어하기·fork·이름 변경·제목 자동 생성

**Files:**
- Create: `src/ui/ThreadPicker.ts`, `src/ui/TextPromptModal.ts`
- Modify: `src/main.ts`, `src/ui/ChatView.ts`, `styles.css` (끝에 추가)

**Interfaces:**
- Consumes: `ThreadService`, `ThreadInfo`, `titlePrompt` (Task 15), `formatRelativeTime` (Task 8), `oneShot` (Task 1), `ClaudeSession.resumeFrom` (Task 6), `errorMessage` (Task 6)
- Produces:
```ts
// main.ts
threads: ThreadService;
// ui/ThreadPicker.ts
export interface ThreadPickerHandlers { onOpen(t: ThreadInfo): void; onFork(t: ThreadInfo): void; onRename(t: ThreadInfo): void }
export class ThreadPicker extends FuzzySuggestModal<ThreadInfo> { constructor(app: App, threads: ThreadInfo[], h: ThreadPickerHandlers) }
// ui/TextPromptModal.ts
export class TextPromptModal extends Modal { constructor(app: App, heading: string, initial: string, onSubmit: (value: string) => void | Promise<void>) }
// ui/ChatView.ts
openThreadPicker(): Promise<void>; loadThread(id: string, title: string): Promise<void>
```

- [ ] **Step 1: 모달 작성**

`src/ui/TextPromptModal.ts`:
```ts
import { Modal, type App } from 'obsidian';

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly onSubmit: (value: string) => void | Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'cp-prompt-input' });
    input.value = this.initial;
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      void this.onSubmit(value);
    };
    row.createEl('button', { cls: 'mod-cta', text: '저장' }).addEventListener('click', submit);
    row.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.isComposing) {
        evt.preventDefault();
        submit();
      }
    });
    input.select();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
```

`src/ui/ThreadPicker.ts`:
```ts
import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import type { ThreadInfo } from '../threads/ThreadService';
import { formatRelativeTime } from './format';

export interface ThreadPickerHandlers {
  onOpen(thread: ThreadInfo): void;
  onFork(thread: ThreadInfo): void;
  onRename(thread: ThreadInfo): void;
}

export class ThreadPicker extends FuzzySuggestModal<ThreadInfo> {
  constructor(app: App, private readonly threads: ThreadInfo[], private readonly h: ThreadPickerHandlers) {
    super(app);
    this.setPlaceholder('스레드 검색');
    this.setInstructions([
      { command: '↵', purpose: '열기' },
      { command: 'Ctrl+↵', purpose: 'fork해서 열기' },
      { command: 'F2', purpose: '이름 변경' },
    ]);
    this.scope.register(['Mod'], 'Enter', (evt) => this.runOnSelected(evt, (t) => this.h.onFork(t)));
    this.scope.register([], 'F2', (evt) => this.runOnSelected(evt, (t) => this.h.onRename(t)));
  }

  getItems(): ThreadInfo[] {
    return this.threads;
  }

  getItemText(thread: ThreadInfo): string {
    return thread.title;
  }

  override renderSuggestion(match: FuzzyMatch<ThreadInfo>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    el.createDiv({ cls: 'cp-thread-time', text: formatRelativeTime(match.item.lastModified, Date.now()) });
  }

  onChooseItem(thread: ThreadInfo): void {
    this.h.onOpen(thread);
  }

  private runOnSelected(evt: KeyboardEvent, action: (thread: ThreadInfo) => void): boolean {
    const thread = this.selected();
    if (!thread) return true;
    evt.preventDefault();
    this.close();
    action(thread);
    return false;
  }

  /** Obsidian이 선택 항목을 공개 API로 주지 않아 내부 chooser를 읽는다. */
  private selected(): ThreadInfo | null {
    const chooser = (this as unknown as { chooser?: { selectedItem: number; values: FuzzyMatch<ThreadInfo>[] | null } }).chooser;
    return chooser?.values?.[chooser.selectedItem]?.item ?? null;
  }
}
```

- [ ] **Step 2: 플러그인에 ThreadService 추가**

`src/main.ts` 수정:

SDK import를 교체:
```ts
import { forkSession, getSessionInfo, getSessionMessages, listSessions, query, renameSession } from '@anthropic-ai/claude-agent-sdk';
```

import 추가:
```ts
import { ThreadService, titlePrompt } from './threads/ThreadService';
```

필드 추가 (`readonly views = new Set<ChatView>();` 아래):
```ts
  threads!: ThreadService;
```

`onload()`의 `await this.loadSettings();` 바로 아래에 추가:
```ts
    this.threads = new ThreadService(
      { listSessions, getSessionMessages, getSessionInfo, forkSession, renameSession },
      () => this.vaultPath(),
      async (firstMessage) => (await oneShot(query, this.sessionConfig(), titlePrompt(firstMessage), { model: 'haiku' })).text,
    );
```

- [ ] **Step 3: ChatView에 스레드 흐름 연결**

`src/ui/ChatView.ts` 수정:

import 수정·추가:
```ts
import { ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import { ClaudeSession, errorMessage } from '../session/ClaudeSession';
import type { ThreadInfo } from '../threads/ThreadService';
import { TextPromptModal } from './TextPromptModal';
import { ThreadPicker } from './ThreadPicker';
```

필드 추가:
```ts
  private isNewThread = true;
  private titled = false;
  private firstPrompt: string | null = null;
  private resuming = false;
```

`onOpen()`의 `this.iconButton(actions, 'plus', '새 대화', () => this.newChat());` 앞에 추가:
```ts
    this.titleEl.addEventListener('click', () => void this.openThreadPicker());
    this.iconButton(actions, 'history', '스레드 열기', () => void this.openThreadPicker());
```

`newChat()` 교체:
```ts
  newChat(): void {
    this.useSession(this.createSession());
    this.setTitle('새 대화');
    this.isNewThread = true;
    this.titled = false;
    this.firstPrompt = null;
    this.resuming = false;
    this.composer.focus();
  }
```

`submit()`의 `session.send(...)` 줄 앞에 추가:
```ts
    if (this.firstPrompt === null) this.firstPrompt = text;
```

`onEvent()` 교체:
```ts
  private onEvent(e: PanelEvent): void {
    if (e.kind === 'init') this.resuming = false;
    if (e.kind === 'stream-error' && this.resuming) {
      this.resuming = false;
      new Notice(`이어하기에 실패해 새 대화로 전환합니다: ${e.message}`);
      this.newChat();
      return;
    }
    this.list.update(this.state.apply(e));
    this.composer.setBusy(this.state.busy);
    this.updateToolbar(e);
    if (e.kind === 'turn-end') this.maybeAutoTitle();
  }
```

메서드 추가:
```ts
  async openThreadPicker(): Promise<void> {
    let threads: ThreadInfo[];
    try {
      threads = await this.plugin.threads.list();
    } catch (err) {
      new Notice(`스레드 목록을 읽지 못했습니다: ${errorMessage(err)}`);
      return;
    }
    new ThreadPicker(this.app, threads, {
      onOpen: (t) => void this.loadThread(t.id, t.title),
      onFork: (t) => void this.forkThread(t),
      onRename: (t) => this.renameThread(t),
    }).open();
  }

  async loadThread(id: string, title: string): Promise<void> {
    const session = this.createSession();
    session.resumeFrom(id);
    this.useSession(session);
    this.setTitle(title);
    this.isNewThread = false;
    this.firstPrompt = null;
    this.resuming = true;
    try {
      const events = await this.plugin.threads.history(id);
      if (this.session !== session) return;
      this.list.update(events.flatMap((e) => this.state.apply(e)));
    } catch (err) {
      new Notice(`대화 기록을 읽지 못했습니다: ${errorMessage(err)}`);
    }
  }

  private async forkThread(thread: ThreadInfo): Promise<void> {
    try {
      const id = await this.plugin.threads.fork(thread.id);
      await this.loadThread(id, `${thread.title} (fork)`);
    } catch (err) {
      new Notice(`fork 실패: ${errorMessage(err)}`);
    }
  }

  private renameThread(thread: ThreadInfo): void {
    new TextPromptModal(this.app, '스레드 이름 변경', thread.title, async (value) => {
      try {
        await this.plugin.threads.rename(thread.id, value);
        if (this.session?.sessionId === thread.id) {
          this.setTitle(value);
          this.titled = true;
        }
      } catch (err) {
        new Notice(`이름 변경 실패: ${errorMessage(err)}`);
      }
    }).open();
  }

  /** 새 대화의 첫 턴이 끝나면 한 번만 제목을 만든다. 실패해도 대화에는 영향 없음. */
  private maybeAutoTitle(): void {
    const session = this.session;
    const id = session?.sessionId;
    if (!session || !id || !this.isNewThread || this.titled || this.firstPrompt === null) return;
    this.titled = true;
    void this.plugin.threads
      .autoTitle(id, this.firstPrompt)
      .then((title) => {
        if (this.session === session) this.setTitle(title);
      })
      .catch(() => undefined);
  }
```

- [ ] **Step 4: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-thread-time { font-size: var(--font-ui-smaller); color: var(--text-faint); }
.cp-prompt-input { width: 100%; }
```

- [ ] **Step 5: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 6: [사용자 확인] 스레드 수동 점검**

- [ ] 새 대화에서 첫 메시지 전송 → 턴이 끝나면 상단 제목이 자동 생성 제목으로 바뀜
- [ ] 제목(또는 시계 아이콘) 클릭 → 스레드 목록(퍼지 검색, "n분 전"), 터미널에서 이 vault로 시작한 세션도 보임
- [ ] 과거 스레드 Enter → 과거 대화(사용자 메시지·답변·도구 카드) 표시 → 이어서 질문하면 앞 대화를 기억함
- [ ] Ctrl+Enter → `(fork)` 제목으로 열리고, 이어서 대화해도 원본 스레드는 그대로
- [ ] F2 → 이름 변경 모달 → 목록과 상단 제목에 반영, 터미널 `claude --resume` 목록에도 반영

- [ ] **Step 7: Commit**

```bash
git add src/ui/ThreadPicker.ts src/ui/TextPromptModal.ts src/main.ts src/ui/ChatView.ts styles.css
git commit -m "feat: add thread picker with resume, fork, rename and auto titles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 6단계 — 선택 영역 고쳐쓰기

### Task 17: 고쳐쓰기 로직 (프롬프트·단어 diff·적용 검사)

**Files:**
- Create: `src/rewrite/RewriteSelection.ts`
- Test: `tests/rewrite/RewriteSelection.test.ts`

**Interfaces:**
- Produces:
```ts
export interface DiffSegment { type: 'same' | 'add' | 'del'; text: string }
export interface Pos { line: number; ch: number }
export interface EditorLike { getRange(from: Pos, to: Pos): string; replaceRange(text: string, from: Pos, to: Pos): void }
export type Runner = (prompt: string, systemPrompt: string) => Promise<string>;
export const REWRITE_SYSTEM_PROMPT: string;
export function wordDiff(before: string, after: string): DiffSegment[];
export function buildRewritePrompt(req: { text: string; instruction: string; path: string }): string;
export function finalizeRewrite(original: string, output: string): string;
export class RewriteController {
  constructor(editor: EditorLike, from: Pos, to: Pos, original: string, path: string, run: Runner);
  result: string | null;
  generate(instruction: string): Promise<DiffSegment[]>;
  apply(): boolean;
}
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/rewrite/RewriteSelection.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { REWRITE_SYSTEM_PROMPT, RewriteController, buildRewritePrompt, finalizeRewrite, wordDiff, type EditorLike, type Pos } from '../../src/rewrite/RewriteSelection';

const from: Pos = { line: 3, ch: 0 };
const to: Pos = { line: 4, ch: 5 };

class FakeEditor implements EditorLike {
  constructor(public text: string) {}
  getRange(): string {
    return this.text;
  }
  replaceRange(text: string): void {
    this.text = text;
  }
}

describe('wordDiff', () => {
  it('같은 부분+삭제는 원문, 같은 부분+추가는 결과를 이룬다', () => {
    const segs = wordDiff('회의는 월요일 오전에 한다', '회의는 화요일 오전에 한다');
    expect(segs.filter((s) => s.type !== 'add').map((s) => s.text).join('')).toBe('회의는 월요일 오전에 한다');
    expect(segs.filter((s) => s.type !== 'del').map((s) => s.text).join('')).toBe('회의는 화요일 오전에 한다');
    // jsdiff는 한글을 글자 단위로 나눈다 ('월' → '화')
    expect(segs).toContainEqual({ type: 'del', text: '월' });
    expect(segs).toContainEqual({ type: 'add', text: '화' });
  });
});

describe('buildRewritePrompt / finalizeRewrite', () => {
  it('노트 경로·지시·원문을 담는다', () => {
    expect(buildRewritePrompt({ text: '원문', instruction: '간결하게', path: 'a.md' })).toBe('Note: a.md\nInstruction: 간결하게\n\n<passage>\n원문\n</passage>');
  });
  it('전체를 감싼 코드 펜스를 벗기고 원문의 앞뒤 공백을 보존한다', () => {
    expect(finalizeRewrite('  hello\n', '```markdown\nbye\n```')).toBe('  bye\n');
    expect(finalizeRewrite('hello', '\nbye\n')).toBe('bye');
    expect(finalizeRewrite('   ', 'x')).toBe('x');
  });
});

describe('RewriteController', () => {
  it('generate는 시스템 프롬프트와 함께 실행하고 diff를 돌려준다', async () => {
    const run = vi.fn(async () => '새 문장');
    const c = new RewriteController(new FakeEditor('옛 문장'), from, to, '옛 문장', 'a.md', run);
    const segs = await c.generate('바꿔');
    expect(run).toHaveBeenCalledWith(buildRewritePrompt({ text: '옛 문장', instruction: '바꿔', path: 'a.md' }), REWRITE_SYSTEM_PROMPT);
    expect(c.result).toBe('새 문장');
    expect(segs.length).toBeGreaterThan(0);
  });

  it('원문이 그대로면 적용한다', async () => {
    const editor = new FakeEditor('옛 문장');
    const c = new RewriteController(editor, from, to, '옛 문장', 'a.md', async () => '새 문장');
    await c.generate('바꿔');
    expect(c.apply()).toBe(true);
    expect(editor.text).toBe('새 문장');
  });

  it('원문이 바뀌었으면 적용을 거부한다', async () => {
    const editor = new FakeEditor('옛 문장');
    const c = new RewriteController(editor, from, to, '옛 문장', 'a.md', async () => '새 문장');
    await c.generate('바꿔');
    editor.text = '누군가 고친 문장';
    expect(c.apply()).toBe(false);
    expect(editor.text).toBe('누군가 고친 문장');
  });

  it('생성 전에는 적용할 수 없다', () => {
    const c = new RewriteController(new FakeEditor('a'), from, to, 'a', 'a.md', async () => 'b');
    expect(c.apply()).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/rewrite/RewriteSelection.test.ts`
Expected: FAIL — `Failed to resolve import "../../src/rewrite/RewriteSelection"`

- [ ] **Step 3: 구현**

`src/rewrite/RewriteSelection.ts`:
```ts
import { diffWordsWithSpace } from 'diff';

export interface DiffSegment {
  type: 'same' | 'add' | 'del';
  text: string;
}

export interface Pos {
  line: number;
  ch: number;
}

/** Obsidian Editor 중 고쳐쓰기에 필요한 부분 */
export interface EditorLike {
  getRange(from: Pos, to: Pos): string;
  replaceRange(text: string, from: Pos, to: Pos): void;
}

export type Runner = (prompt: string, systemPrompt: string) => Promise<string>;

export const REWRITE_SYSTEM_PROMPT =
  'You rewrite a passage from a Markdown note according to an instruction. ' +
  'Output only the rewritten passage: no explanations, no preamble, no code fences. ' +
  'Keep the original language and Markdown formatting unless the instruction says otherwise.';

export function wordDiff(before: string, after: string): DiffSegment[] {
  return diffWordsWithSpace(before, after).map((part) => ({ type: part.added ? 'add' : part.removed ? 'del' : 'same', text: part.value }));
}

export function buildRewritePrompt(req: { text: string; instruction: string; path: string }): string {
  return [`Note: ${req.path}`, `Instruction: ${req.instruction}`, '', '<passage>', req.text, '</passage>'].join('\n');
}

/** 모델이 결과를 코드 펜스로 감싼 경우 벗기고, 원문의 앞뒤 공백(줄바꿈 포함)을 되살린다. */
export function finalizeRewrite(original: string, output: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(output.trim());
  const body = fenced ? fenced[1] : output.trim();
  if (!original.trim()) return body;
  const lead = /^\s*/.exec(original)?.[0] ?? '';
  const trail = /\s*$/.exec(original)?.[0] ?? '';
  return lead + body + trail;
}

export class RewriteController {
  result: string | null = null;

  constructor(
    private readonly editor: EditorLike,
    private readonly from: Pos,
    private readonly to: Pos,
    readonly original: string,
    private readonly path: string,
    private readonly run: Runner,
  ) {}

  async generate(instruction: string): Promise<DiffSegment[]> {
    const output = await this.run(buildRewritePrompt({ text: this.original, instruction, path: this.path }), REWRITE_SYSTEM_PROMPT);
    this.result = finalizeRewrite(this.original, output);
    return wordDiff(this.original, this.result);
  }

  /** 적용 직전 선택 범위의 텍스트가 원문 그대로인지 확인한다. 바뀌었으면 적용하지 않고 false. */
  apply(): boolean {
    if (this.result === null) return false;
    if (this.editor.getRange(this.from, this.to) !== this.original) return false;
    this.editor.replaceRange(this.result, this.from, this.to);
    return true;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/rewrite/RewriteSelection.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/rewrite/RewriteSelection.ts tests/rewrite/RewriteSelection.test.ts
git commit -m "feat: add selection rewrite controller with word diff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 18: 고쳐쓰기 모달·명령

**Files:**
- Create: `src/ui/RewriteModal.ts`
- Modify: `src/main.ts`, `styles.css` (끝에 추가)

**Interfaces:**
- Consumes: `RewriteController` (Task 17), `oneShot` (Task 1), `errorMessage` (Task 6), `ClaudePanelPlugin.sessionConfig/settings` (Task 9)
- Produces: `class RewriteModal extends Modal { constructor(app: App, controller: RewriteController) }`, 명령 `rewrite-selection` ("Rewrite selection")

- [ ] **Step 1: 모달 작성**

`src/ui/RewriteModal.ts`:
```ts
import { Modal, type App } from 'obsidian';
import type { RewriteController } from '../rewrite/RewriteSelection';
import { errorMessage } from '../session/ClaudeSession';

export class RewriteModal extends Modal {
  constructor(app: App, private readonly controller: RewriteController) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('선택 영역 고쳐쓰기');
    this.modalEl.addClass('cp-rewrite-modal');
    const input = this.contentEl.createEl('textarea', {
      cls: 'cp-rewrite-instruction',
      attr: { rows: '3', placeholder: '어떻게 고칠까요? (예: 더 간결하게, 존댓말로)' },
    });
    const status = this.contentEl.createDiv({ cls: 'cp-rewrite-status' });
    const diffEl = this.contentEl.createDiv({ cls: 'cp-rewrite-diff' });
    diffEl.setText(this.controller.original);
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const generateBtn = buttons.createEl('button', { cls: 'mod-cta', text: '생성' });
    const applyBtn = buttons.createEl('button', { text: '적용' });
    applyBtn.disabled = true;
    buttons.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());

    const generate = async () => {
      const instruction = input.value.trim();
      if (!instruction) return;
      generateBtn.disabled = true;
      applyBtn.disabled = true;
      status.setText('생성 중…');
      try {
        const segments = await this.controller.generate(instruction);
        diffEl.empty();
        for (const s of segments) diffEl.createSpan({ cls: `cp-diff-${s.type}`, text: s.text });
        status.setText('');
        applyBtn.disabled = false;
        generateBtn.setText('다시 생성');
      } catch (err) {
        status.setText(`실패: ${errorMessage(err)}`);
      } finally {
        generateBtn.disabled = false;
      }
    };

    generateBtn.addEventListener('click', () => void generate());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        void generate();
      }
    });
    applyBtn.addEventListener('click', () => {
      if (this.controller.apply()) {
        this.close();
        return;
      }
      status.setText('원문이 변경됨, 다시 생성하세요.');
      applyBtn.disabled = true;
    });
    input.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
```

- [ ] **Step 2: 명령 등록**

`src/main.ts` 수정:

`obsidian` import를 교체:
```ts
import { FileSystemAdapter, Notice, Plugin, type Editor, type WorkspaceLeaf } from 'obsidian';
```

import 추가:
```ts
import { RewriteController } from './rewrite/RewriteSelection';
import { RewriteModal } from './ui/RewriteModal';
```

`onload()`의 `addSettingTab` 줄 앞에 추가:
```ts
    this.addCommand({
      id: 'rewrite-selection',
      name: 'Rewrite selection',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) this.openRewrite(editor, ctx.file?.path ?? '');
        return true;
      },
    });
```

메서드 추가:
```ts
  private openRewrite(editor: Editor, path: string): void {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const controller = new RewriteController(editor, from, to, editor.getSelection(), path, async (prompt, systemPrompt) => {
      const r = await oneShot(query, this.sessionConfig(), prompt, { model: this.settings.defaultModel || undefined, systemPrompt });
      return r.text;
    });
    new RewriteModal(this.app, controller).open();
  }
```

- [ ] **Step 3: 스타일 추가**

`styles.css` 끝에 추가:
```css
.cp-rewrite-instruction { width: 100%; resize: vertical; }
.cp-rewrite-status { min-height: 1.4em; font-size: var(--font-ui-small); color: var(--text-muted); margin: 4px 0; }
.cp-rewrite-diff { white-space: pre-wrap; max-height: 50vh; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: var(--radius-s); padding: 8px; }
.cp-rewrite-diff .cp-diff-del { text-decoration: line-through; color: var(--text-error); }
.cp-rewrite-diff .cp-diff-add { color: var(--text-success); }
```

- [ ] **Step 4: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 5: [사용자 확인] 고쳐쓰기 수동 점검**

- [ ] 노트에서 문단 선택 → 명령 팔레트 **Claude Panel: Rewrite selection** (선택이 없으면 명령이 목록에 안 보임)
- [ ] 지시 입력 후 Enter → 단어 단위 diff(삭제 취소선·추가 강조) → [적용] → 선택 영역이 바뀜, 앞뒤 줄바꿈 유지
- [ ] [다시 생성] → 새 결과로 diff 갱신
- [ ] diff가 보이는 동안 에디터에서 원문을 조금 고친 뒤 [적용] → "원문이 변경됨, 다시 생성하세요." 표시, 문서는 그대로

- [ ] **Step 6: Commit**

```bash
git add src/ui/RewriteModal.ts src/main.ts styles.css
git commit -m "feat: add rewrite selection modal and command

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 7단계 — 마무리

### Task 19: 진단 정보·더보기 메뉴

**Files:**
- Create: `src/diagnostics.ts`
- Modify: `src/main.ts`, `src/ui/ChatView.ts`
- Test: `tests/diagnostics.test.ts`

**Interfaces:**
- Consumes: `PanelEvent` (Task 3), `ClaudeSessionDeps.onStderr` (Task 6), `ClaudePanelPlugin.claudePath/openPanel/openSettings` (Task 9), `ChatView.openThreadPicker` (Task 16)
- Produces:
```ts
export class Diagnostics { cliVersion: string | null; recordError(message: string, now?: Date): void; recordStderr(chunk: string): void; report(claudePath: string): string }
// main.ts
readonly diagnostics: Diagnostics; copyDiagnostics(): Promise<void>   // 명령 copy-diagnostics
```

- [ ] **Step 1: 실패 테스트 작성**

`tests/diagnostics.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { Diagnostics } from '../src/diagnostics';

describe('Diagnostics', () => {
  it('최근 오류 10건만 보관한다', () => {
    const d = new Diagnostics();
    for (let i = 1; i <= 12; i++) d.recordError(`e${i}`, new Date(Date.UTC(2026, 8, 19, 0, 0, i)));
    const report = d.report('/bin/claude');
    expect(report).toContain('최근 오류 10건:');
    expect(report).not.toContain(' e2\n');
    expect(report).toContain('- 2026-09-19T00:00:12.000Z e12');
  });

  it('stderr는 줄 단위로 최근 20줄만 보관한다', () => {
    const d = new Diagnostics();
    d.recordStderr(Array.from({ length: 25 }, (_, i) => `line${i}`).join('\n'));
    const report = d.report('/bin/claude');
    expect(report).toContain('최근 stderr 20줄:');
    expect(report).not.toContain('line4\n');
    expect(report).toContain('line24');
  });

  it('버전·경로를 담는다', () => {
    const d = new Diagnostics();
    expect(d.report('/bin/claude')).toContain('Claude Code (세션 시작 전)');
    d.cliVersion = '2.1.278';
    const report = d.report('/home/u/.local/bin/claude');
    expect(report).toContain('Claude Panel test');
    expect(report).toContain('Agent SDK test');
    expect(report).toContain('Claude Code 2.1.278');
    expect(report).toContain('claude 경로: /home/u/.local/bin/claude');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run tests/diagnostics.test.ts`
Expected: FAIL — `Failed to resolve import "../src/diagnostics"`

- [ ] **Step 3: 구현**

`src/diagnostics.ts`:
```ts
const MAX_ERRORS = 10;
const MAX_STDERR_LINES = 20;

/** Copy diagnostics 명령용: 버전·경로·최근 오류·stderr를 모은다. */
export class Diagnostics {
  cliVersion: string | null = null;
  private readonly errors: { at: string; message: string }[] = [];
  private readonly stderrLines: string[] = [];

  recordError(message: string, now: Date = new Date()): void {
    this.errors.push({ at: now.toISOString(), message });
    while (this.errors.length > MAX_ERRORS) this.errors.shift();
  }

  recordStderr(chunk: string): void {
    for (const line of chunk.split('\n')) if (line.trim()) this.stderrLines.push(line);
    while (this.stderrLines.length > MAX_STDERR_LINES) this.stderrLines.shift();
  }

  report(claudePath: string): string {
    return [
      `Claude Panel ${__PLUGIN_VERSION__}`,
      `Agent SDK ${__SDK_VERSION__}`,
      `Claude Code ${this.cliVersion ?? '(세션 시작 전)'}`,
      `claude 경로: ${claudePath}`,
      `플랫폼: ${process.platform} ${process.arch}, Electron ${process.versions.electron ?? '-'}, Node ${process.versions.node}`,
      '',
      `최근 오류 ${this.errors.length}건:`,
      ...this.errors.map((e) => `- ${e.at} ${e.message}`),
      '',
      `최근 stderr ${this.stderrLines.length}줄:`,
      ...this.stderrLines,
    ].join('\n');
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run tests/diagnostics.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 플러그인에 연결**

`src/main.ts` 수정:

import 추가:
```ts
import { Diagnostics } from './diagnostics';
```

필드 추가 (`threads!: ThreadService;` 아래):
```ts
  readonly diagnostics = new Diagnostics();
```

`onload()`의 `test-connection` 명령 아래에 추가:
```ts
    this.addCommand({ id: 'copy-diagnostics', name: 'Copy diagnostics', callback: () => void this.copyDiagnostics() });
```

메서드 추가:
```ts
  async copyDiagnostics(): Promise<void> {
    await navigator.clipboard.writeText(this.diagnostics.report(this.claudePath()));
    new Notice('진단 정보를 클립보드에 복사했습니다.');
  }
```

`testConnection()`의 `catch` 블록 첫 줄에 추가:
```ts
      this.diagnostics.recordError(`test-connection: ${err instanceof Error ? err.message : String(err)}`);
```

- [ ] **Step 6: ChatView에 연결**

`src/ui/ChatView.ts` 수정:

`obsidian` import 교체:
```ts
import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
```

`onOpen()`의 `this.iconButton(actions, 'plus', '새 대화', () => this.newChat());` 아래에 추가:
```ts
    this.iconButton(actions, 'more-horizontal', '더보기', (evt) => this.openMenu(evt));
```

`createSession()` 교체:
```ts
  private createSession(): ClaudeSession {
    return new ClaudeSession({
      query,
      getConfig: () => this.plugin.sessionConfig(),
      onStderr: (data) => this.plugin.diagnostics.recordStderr(data),
    });
  }
```

`onEvent()`의 첫 줄로 추가:
```ts
    this.recordDiagnostics(e);
```

메서드 추가:
```ts
  private recordDiagnostics(e: PanelEvent): void {
    const d = this.plugin.diagnostics;
    if (e.kind === 'init') d.cliVersion = e.cliVersion;
    else if (e.kind === 'stream-error') d.recordError(e.code ? `${e.code}: ${e.message}` : e.message);
    else if (e.kind === 'assistant-error') d.recordError(`assistant: ${e.error}`);
    else if (e.kind === 'turn-end' && !e.ok) d.recordError(`${e.subtype}: ${e.errors.join(' / ')}`);
  }

  private openMenu(evt: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('새 패널 열기').setIcon('plus-square').onClick(() => void this.plugin.openPanel(true)));
    menu.addItem((i) => i.setTitle('스레드 열기…').setIcon('history').onClick(() => void this.openThreadPicker()));
    menu.addItem((i) => i.setTitle('진단 정보 복사').setIcon('clipboard-copy').onClick(() => void this.plugin.copyDiagnostics()));
    menu.addItem((i) => i.setTitle('설정').setIcon('settings').onClick(() => this.plugin.openSettings()));
    menu.showAtMouseEvent(evt);
  }
```

- [ ] **Step 7: 빌드 검증 후 Commit**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

```bash
git add src/diagnostics.ts tests/diagnostics.test.ts src/main.ts src/ui/ChatView.ts
git commit -m "feat: add diagnostics report and panel menu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 20: 명령 정리·여러 패널

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ChatView.newChat/openThreadPicker` (Task 9, 16), `openPanel` (Task 9)
- Produces: 명령 `open-new-panel` (Open new panel), `new-chat` (New chat), `open-thread` (Open thread…). 스펙 4장의 명령 6개(Open panel, Open new panel, New chat, Open thread…, Rewrite selection, Copy diagnostics)가 모두 갖춰진다.

- [ ] **Step 1: 명령 추가**

`src/main.ts`의 `onload()`에서 `open-panel` 명령 아래에 추가:
```ts
    this.addCommand({ id: 'open-new-panel', name: 'Open new panel', callback: () => void this.openPanel(true) });
    this.addCommand({ id: 'new-chat', name: 'New chat', callback: () => void this.withChatView((view) => view.newChat()) });
    this.addCommand({ id: 'open-thread', name: 'Open thread…', callback: () => void this.withChatView((view) => view.openThreadPicker()) });
```

메서드 추가:
```ts
  /** 활성 패널(없으면 첫 패널)에 작업을 보낸다. 패널이 하나도 없으면 먼저 연다. */
  private async withChatView(action: (view: ChatView) => void | Promise<void>): Promise<void> {
    let view: ChatView | null = this.app.workspace.getActiveViewOfType(ChatView) ?? [...this.views][0] ?? null;
    if (!view) {
      await this.openPanel(false);
      view = [...this.views][0] ?? null;
    }
    if (view) await action(view);
  }
```

- [ ] **Step 2: 빌드 검증**

Run: `npm test && npm run build`
Expected: 전부 PASS, `smoke-load: OK`

- [ ] **Step 3: [사용자 확인] 여러 패널·정리 수동 점검**

- [ ] **Open new panel** 두 번 → 패널 3개, 각 패널에서 서로 다른 대화를 동시에 진행해도 섞이지 않음
- [ ] **New chat**·**Open thread…** 명령이 포커스된 패널에 적용됨, 패널이 없을 때 실행하면 패널이 열림
- [ ] 한 패널에서 긴 답변 생성 중 설정 › 커뮤니티 플러그인에서 Claude Panel 끄기 → `ps -ef | grep '[c]laude'`에 패널이 띄운 프로세스가 남지 않음 (터미널에서 실행 중인 claude는 제외하고 확인)
- [ ] 다시 켜기 → 패널 복원, 정상 동작
- [ ] ⋯ 메뉴 › 진단 정보 복사 → 붙여 넣으면 버전·경로·최근 오류가 보임

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat: add new panel, new chat and open thread commands

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 21: 최종 점검·문서

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-09-18-claude-panel-design.md` (상태 줄만)

- [ ] **Step 1: README 작성**

`README.md`:
````markdown
# Claude Panel

Obsidian 사이드바에서 로컬 Claude Code를 쓰는 개인용 플러그인. vault의 `CLAUDE.md`·스킬·hook·권한 설정이 터미널과 똑같이 적용된다.

## 설치 (개발 빌드)

```bash
npm install
npm run build
scripts/link-vault.sh ~/Vault/Boxx      # main.js·manifest.json·styles.css만 심볼릭 링크
```

Obsidian에서 Claude Panel을 켜고 **Claude Panel: Test connection**으로 확인한다.
Obsidian이 `claude`를 못 찾으면 설정 › Claude 실행 파일 경로에서 [자동 찾기]를 누른다.

## 명령

| 명령 | 설명 |
|---|---|
| Open panel / Open new panel | 패널 열기 / 새 패널(독립 세션) 열기 |
| New chat | 포커스된 패널에서 새 대화 |
| Open thread… | 스레드 목록 (Enter 열기, Ctrl+Enter fork, F2 이름 변경) |
| Rewrite selection | 선택 영역 고쳐쓰기 (단어 diff 확인 후 적용) |
| Copy diagnostics | 버전·경로·최근 오류를 클립보드로 |
| Test connection | haiku로 1회 호출해 연결 확인 |

입력창: Enter 전송(설정 가능), Shift+Enter 줄바꿈, Shift+Tab 권한 모드 순환, Esc 중단, `/` 명령·스킬 자동완성.

## 개발

- `npm test` — 단위 테스트 (실제 CLI 불필요)
- `npm run test:live` — 실제 CLI 통합 테스트 (임시 폴더, haiku, hook 끔)
- `npm run build` — 타입 검사 + 번들 + 번들 로드 검사
- `scripts/record-fixture.sh` — normalize 회귀 테스트용 실제 스트림 재녹화 (SDK·CLI 업데이트 후)
- SDK는 `@anthropic-ai/claude-agent-sdk@0.3.278`로 고정. 올릴 때는 fixture를 다시 녹화하고 `npm test && npm run test:live`를 통과시킨다.
````

- [ ] **Step 2: 전체 자동 검증**

Run: `npm test && npm run build && npm run test:live`
Expected: 단위 테스트 전부 PASS, `check-bundle: OK`, `smoke-load: OK`, live 5 tests PASS

- [ ] **Step 3: [사용자 확인] 릴리스 전 수동 점검 (스펙 7장)**

- [ ] 패널 열기 → 전송 → 스트리밍 → 위키링크 클릭
- [ ] 승인 카드(허용·항상 허용·거부), AskUserQuestion, Plan 승인 흐름
- [ ] `/` 자동완성에 vault 스킬 표시
- [ ] 터미널 세션 이어하기, fork
- [ ] 선택 영역 고쳐쓰기(적용·다시 생성·원문 변경 시 거부)
- [ ] 생성 중 플러그인 재로드 후 잔여 프로세스 없음(`ps`)
- [ ] 라이트·다크 테마, 좁은 사이드바 폭
- [ ] `CLAUDE.md` 규칙 적용 (Boxx에서 "테스트용 노트를 기타업무/에 만들어 줘" → frontmatter에 `createdBy: Claude Code`, 확인 후 노트 삭제)
- [ ] `scripts/link-vault.sh ~/Vault/Personal`로 Personal vault에도 설치 → 그 vault의 규칙·스킬로 동작 (범용 패널)

- [ ] **Step 4: 스펙 상태 갱신**

`docs/superpowers/specs/2026-09-18-claude-panel-design.md`의 상태 줄을 교체:
```
- 상태: 1차 버전 구현 완료 (구현 계획: docs/superpowers/plans/2026-09-19-claude-panel.md)
```

- [ ] **Step 5: Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-18-claude-panel-design.md
git commit -m "docs: add README and mark first version complete

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 스펙 대응표

| 스펙 항목 | Task |
|---|---|
| 사이드바 채팅·스트리밍·thinking·도구 카드·턴 사용량 | 3, 4, 8, 9 |
| 승인 UI (일반·AskUserQuestion·ExitPlanMode) | 5, 9, 10 |
| 모델·추론 강도·권한 모드 전환, Shift+Tab, 컨텍스트 사용률 | 6, 11 |
| 중단(Esc)·새 대화·여러 패널 | 6, 9, 20 |
| 현재 노트·선택 영역 컨텍스트 | 12, 13 |
| `/` 명령·스킬 자동완성 | 14 |
| 스레드 목록·이어하기·fork·이름 변경·제목 자동 생성 | 15, 16 |
| 선택 영역 고쳐쓰기 | 17, 18 |
| 설정 5개 | 9 |
| 오류 처리 표 (ENOENT·로그인·재시도·한도·프로세스 종료·error_*·이어하기 실패·중단 경합·모르는 메시지·렌더 실패·제목 실패·원문 변경·unload) | 3, 4, 6, 9, 16, 17, 20 |
| Copy diagnostics | 19 |
| 빌드(CJS 단일 번들·ESM 잔존 검사)·설치(심볼릭 링크) | 1, 2 |
| 단위 테스트·실제 CLI 통합 테스트·수동 점검 | 전 Task, 7, 21 |
