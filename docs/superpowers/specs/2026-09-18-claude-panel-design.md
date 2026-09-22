# Claude Panel 설계

- 작성일: 2026-09-18
- 상태: 1차 버전 구현 완료 (구현 계획: docs/superpowers/plans/2026-09-19-claude-panel.md)
- 참고: Codex Panel(murashit/codex-panel v5.8.7), Claudian(YishenTu/claudian v2.3.0) 분석 결과

## 1. 목적

Obsidian 사이드바에서 로컬 Claude Code를 사용하는 개인용 플러그인. Codex Panel이 `codex app-server`를 감싸는 방식과 같이, Claude Code를 **그대로** 감싸 Obsidian 안에서 대화·승인·스레드 관리·선택 영역 고쳐쓰기를 제공한다.

### 설계 결정

| 항목 | 결정 | 이유 |
|---|---|---|
| 연동 방식 | Claude Agent SDK(`@anthropic-ai/claude-agent-sdk`) + 로컬 `claude` 실행 파일 | 승인·모델 전환·세션 API를 SDK가 제공. CLI 직접 제어나 터미널 임베드보다 코드가 적고 Obsidian 연동이 가능 |
| 시스템 프롬프트 | `claude_code` preset 유지 (교체하지 않음) | vault의 `CLAUDE.md`·스킬·memory가 터미널과 동일하게 작동해야 함. Claudian이 기본 프롬프트를 교체하는 점이 직접 만드는 주된 이유 |
| 설정 소스 | `settingSources: ['user', 'project', 'local']` | hook·allow/deny 규칙·기본 권한 모드를 터미널과 동일하게 적용 |
| 권한 모드 기본값 | 전달하지 않음 → `settings.json`의 `permissions.defaultMode` 따름 (현재 `auto`) | 터미널과 동일한 동작. 대화별로 패널에서 변경 가능 |
| 사용 범위 | 범용 패널 (Boxx·Personal 등 어느 vault에나 설치) | vault별 규칙은 각 vault의 `CLAUDE.md`·스킬이 담당. 패널 코드에 vault 특화 로직을 넣지 않음 |
| UI 기술 | 프레임워크 없이 Obsidian DOM API(`createEl`) + `MarkdownRenderer` | 노트와 동일한 렌더링, 작은 번들 |
| 배포 | 개인용 (커뮤니티 스토어 제출 없음) | |
| 개발 위치 | `~/tools/claude-panel` (별도 git 저장소) | 빌드 결과물만 vault 플러그인 폴더에 심볼릭 링크. `node_modules`가 vault·동기화 대상에 섞이지 않음 |

## 2. 범위

### 1차 버전에 포함

- **핵심**: 사이드바 채팅, 글자 단위 스트리밍, thinking 표시, 도구 호출 카드(diff·출력 펼치기), 승인 UI(AskUserQuestion·Plan 종료 포함), 모델·추론 강도·권한 모드(Plan 포함) 전환, 중단, 새 대화, 현재 노트·선택 영역 컨텍스트 첨부, `/` 명령·스킬 자동완성, 컨텍스트 사용률·턴 사용량 표시, 여러 패널(패널별 독립 세션)
- **스레드 관리**: 목록(터미널 세션 포함)·이어하기·fork·이름 변경·제목 자동 생성
- **선택 영역 고쳐쓰기**: 지시 입력 → 도구 없는 1회성 호출 → 단어 단위 diff → 적용·다시 생성·취소

### 1차 버전에서 제외 (2차 이후 후보)

- 진행 중 추가 지시(steer)
- 대화를 노트로 저장(아카이브 내보내기)
- `/web` 전용 명령 (Claude의 WebFetch 도구로 대체 가능)
- 이미지·파일 첨부, 드래그 앤 드롭
- rewind(파일 체크포인트 되돌리기)
- 여러 탭 / 분할 화면
- 다중 공급자(Codex 등) 지원 — 하지 않기로 결정

## 3. 구조

```
~/tools/claude-panel/
├─ src/
│  ├─ main.ts                플러그인 진입점: 뷰·명령·설정 탭 등록
│  ├─ settings.ts            설정 정의·설정 탭
│  ├─ session/
│  │  ├─ ClaudeSession.ts    SDK query() 래퍼 (패널 1개 = 세션 1개)
│  │  ├─ normalize.ts        SDK 메시지 → 패널 이벤트 변환 (순수 함수)
│  │  └─ ApprovalBroker.ts   canUseTool 요청 ↔ UI 승인 카드 연결
│  ├─ threads/
│  │  └─ ThreadService.ts    세션 목록·이어하기·fork·이름 변경·제목 생성
│  ├─ context/
│  │  └─ ContextBuilder.ts   현재 노트·선택 영역 → 프롬프트 첨부
│  ├─ rewrite/
│  │  └─ RewriteSelection.ts 선택 영역 고쳐쓰기 (1회성 호출 + diff 모달)
│  └─ ui/
│     ├─ ChatView.ts         사이드바 뷰 (상단 막대 + 대화 목록 + 입력창)
│     ├─ MessageList.ts      메시지·thinking·도구 카드 렌더링
│     ├─ Composer.ts         입력창, 전송·중단, `/` 자동완성
│     ├─ ApprovalCard.ts     승인·거부 카드 (AskUserQuestion, Plan 승인 포함)
│     └─ ThreadPicker.ts     스레드 선택 모달
└─ tests/
```

### 구성 요소 경계

- **ClaudeSession**: SDK의 `query`를 호출하는 유일한 객체. UI는 이 객체의 메서드(`send`, `interrupt`, `setModel`, `setPermissionMode`, `resume`, `fork`, `close`)와 이벤트(text/thinking delta, tool 시작·결과, 턴 완료, 오류)만 사용한다. `query` 함수는 생성자로 주입받는다(테스트용).
- **normalize.ts**: SDK 메시지를 패널 이벤트로 바꾸는 순수 함수. SDK 메시지 형식 변경의 영향을 이 파일로 한정한다. 실시간 스트림과 `getSessionMessages`로 불러온 과거 대화 모두 같은 경로로 처리한다.
- **ApprovalBroker**: `canUseTool` 호출마다 Promise를 만들고, UI 결정으로 이를 완료한다. Claude Code가 자체 규칙·권한 모드로 이미 허용한 도구는 여기까지 오지 않는다.
- **ThreadService**: SDK의 `listSessions`, `getSessionMessages`, `forkSession`, `renameSession`을 감싼다. SDK 함수는 주입받는다.
- **RewriteSelection**: 채팅 세션과 분리된 1회성 호출(`tools: []`, `persistSession: false`). 모델은 설정의 기본 모델, 비어 있으면 CLI 기본값.

### 설정 항목

| 설정 | 기본값 | 설명 |
|---|---|---|
| Claude 실행 파일 경로 | `claude` | Obsidian이 PATH를 못 찾으면 절대경로 지정 |
| 기본 모델 | (비움) | 비우면 CLI 설정을 따름 |
| 현재 노트 자동 첨부 | on | 전송 시 활성 노트 경로를 컨텍스트로 첨부 |
| 전송 단축키 | Enter | Enter 또는 Ctrl/Cmd+Enter. Shift+Enter는 줄바꿈 |
| 사용자 hook 사용 | on | off면 `disableAllHooks` 설정을 덧붙임 |

### 빌드·설치

- esbuild로 SDK를 포함한 CommonJS 단일 `main.js` 생성 (Obsidian 플러그인은 CommonJS로 로드됨)
- `<vault>/.obsidian/plugins/claude-panel/`에 `main.js`·`manifest.json`·`styles.css`를 심볼릭 링크
- `manifest.json`: `id: claude-panel`, `isDesktopOnly: true`

## 4. 화면 구성

### 사이드바 패널

```
┌─────────────────────────────────────┐
│ 서버실 구상 정리 ▾           [+] [⋯]│ ← 스레드 제목(클릭: 스레드 선택)
│ Opus ▾ · 추론 high ▾ · auto ▾  ◔34% │ ← 모델·추론 강도·권한 모드·컨텍스트 사용률
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 📄 2026-04-20 B1 서버실 구상  │  │ ← 첨부 컨텍스트 칩
│  │ 이 노트 요약해서 index에 추가 │  │ ← 사용자 메시지
│  └───────────────────────────────┘  │
│  ▸ 생각함 (8초)                     │ ← thinking (접힘)
│  ▸ Read  회의/2026-04-20 B1 …md  ✓  │ ← 도구 호출 (한 줄, 펼치면 상세)
│  ▾ Edit  index.md                ✓  │
│    │ + - [[B1 서버실]] — 서버실 …  │ ← 펼치면 diff
│  요약을 추가했습니다. [[index]]의    │ ← 답변 (마크다운 렌더링, 위키링크 클릭 가능)
│                          12.3k tok  │ ← 턴 사용량
│  ┌─ 승인 필요 ───────────────────┐  │
│  │ Bash: git -C … log --oneline  │  │ ← 승인 카드 (대화 흐름 안)
│  │ [허용] [항상 허용] [거부…]    │  │
│  └───────────────────────────────┘  │
├─────────────────────────────────────┤
│ 📄 현재 노트 ×   ✂ 선택 L10–15 ×   │ ← 보낼 컨텍스트 (개별 해제)
│ ┌─────────────────────────────────┐ │
│ │ /ing                            │ │ ← 입력창, `/` 자동완성 (CLI 명령·스킬)
│ └─────────────────────────────────┘ │
│                          [■ 중단]  │ ← 생성 중엔 전송 → 중단
└─────────────────────────────────────┘
```

### 승인 카드 종류

- **일반 도구**: [허용] [항상 허용] [거부…]. 거부 시 입력한 사유를 Claude에 전달.
- **AskUserQuestion**: 선택지 버튼, 다중 선택, "기타" 직접 입력.
- **ExitPlanMode**: 계획 본문을 마크다운으로 표시. [승인하고 진행]은 이전 권한 모드로 복귀 후 실행, [계속 계획]은 의견을 입력해 계획 수정.

### 스레드 선택 모달

퍼지 검색 목록(제목·마지막 수정 시각). Enter: 열기, Ctrl+Enter: fork해서 열기, F2: 이름 변경. 터미널에서 시작한 세션도 같은 vault 경로의 세션이므로 함께 표시된다.

### 선택 영역 고쳐쓰기

에디터에서 텍스트 선택 → 명령 "Rewrite selection" → 모달에서 지시 입력 → 단어 단위 diff 표시 → [적용] [다시 생성] [취소].

### 명령·단축키

- 명령: Open panel, Open new panel, New chat, Open thread…, Rewrite selection, Copy diagnostics
- 입력창: Shift+Tab 권한 모드 순환, Esc 생성 중단

## 5. 데이터 흐름

### 세션 시작 (지연 생성)

패널을 열 때는 프로세스를 띄우지 않고, 첫 전송 시 `query()`를 시작한다.

```ts
query({
  prompt: inputQueue,                 // AsyncIterable<SDKUserMessage>
  options: {
    cwd: vaultPath,
    pathToClaudeCodeExecutable: settings.claudePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    canUseTool: broker.handle,
    env: { ...process.env, PATH: augmentedPath },  // nvm·~/.local/bin 포함
    // permissionMode: 패널에서 바꾼 경우에만 전달
    // model: 패널에서 바꾸거나 기본 모델 설정이 있을 때만 전달
    // resume: 이어하기일 때만
    // settings: { disableAllHooks: true }  // hook 사용 off일 때만
  },
});
```

### 전송

`Composer → ContextBuilder → inputQueue.push(SDKUserMessage)`

- 현재 노트: **경로만** 첨부 (`<context>현재 노트: 회의/…md</context>`). 필요하면 Claude가 Read로 읽음.
- 선택 영역: 경로·줄 범위·텍스트를 함께 첨부.

### 스트리밍

`for await (msg of query) → normalize(msg) → 패널 이벤트 → ChatView 상태 → 렌더링`

| SDK 메시지 | 패널 동작 |
|---|---|
| `system/init` | 세션 ID·모델·권한 모드·명령 목록을 상단 막대·자동완성에 반영 |
| `stream_event` (text/thinking delta) | 현재 블록에 이어 붙임. 마크다운 재렌더는 최대 100ms당 1회로 제한 |
| `assistant`의 `tool_use` | 도구 카드 생성 (실행 중) |
| `user`의 `tool_result` | `tool_use_id`로 카드를 찾아 결과·diff 채움, ✓/✗ |
| `system/api_retry` | 턴 하단에 "재시도 중 (n/m)…" |
| `result` | 턴 사용량 표시, 대기 상태 전환, `getContextUsage()`로 사용률 갱신 |

### 승인

```
canUseTool(toolName, input, { signal, suggestions })
  → ApprovalBroker가 Promise 생성 → 승인 카드 표시
  ← 허용      → { behavior: 'allow', updatedInput: input }
  ← 항상 허용 → { behavior: 'allow', updatedInput: input, updatedPermissions: suggestions }
  ← 거부…     → { behavior: 'deny', message: 사유 }
```

- AskUserQuestion: 선택한 답을 `updatedInput`에 담아 허용.
- ExitPlanMode: 허용 후 `setPermissionMode(이전 모드)`.
- `signal` abort·턴 중단 시 카드 자동 닫힘.

### 기타 흐름

- **중단**: `interrupt()`, 대기 중 승인 전부 거부.
- **모델·모드 변경**: 세션 활성 시 `setModel()`·`setPermissionMode()` 즉시 호출, 비활성 시 보관 후 시작 때 적용.
- **이어하기**: `resume: id`로 새 세션, 과거 대화는 `getSessionMessages(id)` → normalize → 같은 렌더러.
- **fork**: `forkSession(id)` → 새 ID로 이어하기.
- **제목 생성**: 첫 턴 완료 후 `model: 'haiku'`·`tools: []`·`persistSession: false` 1회 호출 → `renameSession()`. 사용자가 이름을 바꾼 세션은 건너뜀.
- **정리**: 패널 닫기·플러그인 unload 시 입력 큐 종료 + abort → `claude` 프로세스 종료.

## 6. 오류 처리

원칙: 대화 흐름 안의 **오류 카드**로 표시(모달 없음). 백그라운드 작업 실패는 조용히 처리하거나 Notice만. 이미 렌더링된 내용은 지우지 않는다.

| 상황 | 감지 | 동작 |
|---|---|---|
| `claude` 실행 파일 없음 | spawn `ENOENT` | 오류 카드 + [경로 자동 찾기](`bash -lc 'command -v claude'` 결과를 설정에 저장) + [설정 열기] |
| 로그인 안 됨·인증 만료 | 인증 상태 메시지·인증 오류 | "터미널에서 `claude` 실행 후 로그인" 안내 |
| API 일시 오류 | `api_retry` | 재시도 상태만 표시 |
| 사용량 한도 초과 | 오류 `result` | 오류 카드 (리셋 시각이 있으면 표시) |
| 턴 도중 프로세스 종료 | 스트림 예외 | 턴을 "중단됨"으로 표시 + [다시 연결] → `resume: 마지막 세션 ID` |
| `error_*` result | `result.subtype` | 종류별 오류 카드 |
| 이어하기 실패 | resume 시작 오류 | Notice + 새 대화로 전환 |
| 중단·승인 경합 | `interrupt()` 시점 | 대기 승인 전부 거부, 중단 이후 도착한 `tool_result` 무시 |
| 모르는 SDK 메시지 | normalize 기본 분기 | 렌더링하지 않고 디버그 로그만 |
| 마크다운 렌더 실패 | 렌더러 예외 | 일반 텍스트로 표시 |
| 제목 생성 실패 | 1회성 호출 실패 | 첫 프롬프트 앞부분을 제목으로 |
| 고쳐쓰기 적용 시 원문 변경 | 적용 직전 선택 범위 텍스트 비교 | 적용 거부, "원문이 변경됨, 다시 생성" |
| unload 중 실행 | `onunload` | 전 세션 abort + 큐 종료, 잔여 프로세스 없음 |

**Copy diagnostics** 명령: 플러그인 버전, `claude` 경로·버전(`system/init`의 `claude_code_version`), SDK 버전, 최근 오류 10건을 클립보드에 복사.

## 7. 테스트

- 도구: vitest. `obsidian` 모듈은 최소 가짜 모듈로 대체.
- `ClaudeSession`·`ThreadService`는 SDK 함수를 주입받아 실제 CLI 없이 테스트한다.

### 단위 테스트 (TDD, 매 커밋)

| 대상 | 검증 |
|---|---|
| `normalize.ts` | delta 이어 붙이기, `tool_use`↔`tool_result` 매칭, usage 추출, 오류 subtype, 모르는 타입 무시. 입력: 실제 CLI 녹화 JSONL + 직접 만든 예외 케이스 |
| `ApprovalBroker` | 허용·항상 허용·거부 사유, signal abort, 중단 시 전부 거부, AskUserQuestion 답 전달, ExitPlanMode 모드 복귀 |
| `ContextBuilder` | 노트는 경로만, 선택 영역은 줄 범위+텍스트, 칩 해제 시 제외 |
| `ClaudeSession` | 지연 시작, 시작 전 변경한 모델·모드 적용, interrupt, close 정리, 스트림 예외 후 재연결 시 `resume` 전달 |
| `ThreadService` | 목록 정렬, fork 후 새 ID, 제목 생성 실패 시 대체 제목 |
| 고쳐쓰기 | 단어 단위 diff, 원문 변경 시 적용 거부 |

### 실제 CLI 통합 테스트 (`npm run test:live`, 수동 실행)

- cwd는 **임시 폴더**(vault 아님), 가장 가벼운 모델, hook 끔.
- 시나리오: 텍스트 응답 / `default` 모드 파일 쓰기 시 `canUseTool` 호출 / 이어하기 / 중단 / 종료 후 `pgrep`으로 잔여 프로세스 없음 확인.
- 단위 테스트용 녹화 JSONL도 여기서 생성.

### Obsidian 수동 점검 (릴리스 전)

- [ ] 패널 열기 → 전송 → 스트리밍 → 위키링크 클릭
- [ ] 승인 카드(허용·항상 허용·거부), AskUserQuestion, Plan 승인 흐름
- [ ] `/` 자동완성에 vault 스킬 표시
- [ ] 터미널 세션 이어하기, fork
- [ ] 선택 영역 고쳐쓰기(적용·다시 생성·원문 변경 시 거부)
- [ ] 생성 중 플러그인 재로드 후 잔여 프로세스 없음(`ps`)
- [ ] 라이트·다크 테마, 좁은 사이드바 폭
- [ ] `CLAUDE.md` 규칙 적용(예: 새 노트에 `createdBy: Claude Code`)

### 빌드 검증 (매 커밋)

`tsc --noEmit`, esbuild 번들 생성, 번들에 ESM `import` 구문 잔존 여부 확인.

## 8. 위험과 대응

| 위험 | 대응 |
|---|---|
| SDK·CLI 업데이트로 메시지 형식 변경 | normalize.ts로 영향 한정, 모르는 타입 무시, 녹화 JSONL 회귀 테스트, SDK 버전 고정 |
| Obsidian(Electron)에서 SDK ESM 번들 문제 | 구현 첫 단계에서 최소 번들로 로드·`query` 1회 호출을 먼저 검증 |
| 사용자 hook이 패널에서도 실행됨(알림 등) | "사용자 hook 사용" 설정으로 끌 수 있음 |
| `auto` 모드에서 승인 없이 파일 수정 | 터미널과 동일한 의도된 동작. 패널 상단에 현재 권한 모드를 항상 표시 |
| 스트리밍 중 마크다운 재렌더 비용 | 100ms 스로틀, 완료된 블록은 다시 그리지 않음 |
