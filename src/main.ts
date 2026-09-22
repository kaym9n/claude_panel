import { forkSession, getSessionInfo, getSessionMessages, listSessions, query, renameSession } from '@anthropic-ai/claude-agent-sdk';
import { FileSystemAdapter, Notice, Plugin, type Editor, type WorkspaceLeaf } from 'obsidian';
import { RewriteController } from './rewrite/RewriteSelection';
import type { SessionConfig } from './session/buildOptions';
import { oneShot } from './session/oneShot';
import { ClaudePanelSettingTab, DEFAULT_SETTINGS, type ClaudePanelSettings } from './settings';
import { ThreadService, titlePrompt } from './threads/ThreadService';
import { ChatView, VIEW_TYPE_CLAUDE_PANEL } from './ui/ChatView';
import { RewriteModal } from './ui/RewriteModal';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from './util/claudePath';

export default class ClaudePanelPlugin extends Plugin {
  settings: ClaudePanelSettings = { ...DEFAULT_SETTINGS };
  readonly views = new Set<ChatView>();
  threads!: ThreadService;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.threads = new ThreadService(
      { listSessions, getSessionMessages, getSessionInfo, forkSession, renameSession },
      () => this.vaultPath(),
      async (firstMessage) => (await oneShot(query, this.sessionConfig(), titlePrompt(firstMessage), { model: 'haiku' })).text,
    );
    this.registerView(VIEW_TYPE_CLAUDE_PANEL, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon('bot', 'Open Claude panel', () => void this.openPanel(false));
    this.addCommand({ id: 'open-panel', name: 'Open panel', callback: () => void this.openPanel(false) });
    this.addCommand({ id: 'test-connection', name: 'Test connection', callback: () => void this.testConnection() });
    this.addCommand({
      id: 'rewrite-selection',
      name: 'Rewrite selection',
      editorCheckCallback: (checking, editor, ctx) => {
        if (!editor.somethingSelected()) return false;
        if (!checking) this.openRewrite(editor, ctx.file?.path ?? '');
        return true;
      },
    });
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

  private openRewrite(editor: Editor, path: string): void {
    const from = editor.getCursor('from');
    const to = editor.getCursor('to');
    const controller = new RewriteController(editor, from, to, editor.getSelection(), path, async (prompt, systemPrompt) => {
      const r = await oneShot(query, this.sessionConfig(), prompt, { model: this.settings.defaultModel || undefined, systemPrompt });
      return r.text;
    });
    new RewriteModal(this.app, controller).open();
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
