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
