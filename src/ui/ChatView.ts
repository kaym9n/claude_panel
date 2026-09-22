import { query } from '@anthropic-ai/claude-agent-sdk';
import { ItemView, Menu, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import { ChatState, type NoticeAction } from '../chat/ChatState';
import { ContextSelection, buildPrompt } from '../context/ContextBuilder';
import { ActiveNoteTracker } from '../context/ActiveNoteTracker';
import type ClaudePanelPlugin from '../main';
import { ClaudeSession, errorMessage } from '../session/ClaudeSession';
import type { PanelEvent } from '../types';
import type { ThreadInfo } from '../threads/ThreadService';
import { applyCommand, matchCommands, slashToken, toCommandItems, type CommandItem } from './commandMatch';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { SlashPopup } from './SlashPopup';
import { TextPromptModal } from './TextPromptModal';
import { ThreadPicker } from './ThreadPicker';
import { Toolbar, nextMode } from './Toolbar';

export const VIEW_TYPE_CLAUDE_PANEL = 'claude-panel-view';

export class ChatView extends ItemView {
  private session: ClaudeSession | null = null;
  private offSession: (() => void) | null = null;
  private readonly state = new ChatState();
  private list!: MessageList;
  private composer!: Composer;
  private panelHeaderEl!: HTMLElement;
  private threadTitleEl!: HTMLElement;
  private toolbar!: Toolbar;
  private tracker!: ActiveNoteTracker;
  private readonly contextSel = new ContextSelection();
  private slash!: SlashPopup;
  private commands: CommandItem[] | null = null;
  private isNewThread = true;
  private titled = false;
  private firstPrompt: string | null = null;
  private resuming = false;

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

    this.panelHeaderEl = root.createDiv({ cls: 'cp-header' });
    const titleRow = this.panelHeaderEl.createDiv({ cls: 'cp-title-row' });
    this.threadTitleEl = titleRow.createDiv({ cls: 'cp-title', text: '새 대화' });
    const actions = titleRow.createDiv({ cls: 'cp-header-actions' });
    this.threadTitleEl.addEventListener('click', () => void this.openThreadPicker());
    this.iconButton(actions, 'history', '스레드 열기', () => void this.openThreadPicker());
    this.iconButton(actions, 'plus', '새 대화', () => this.newChat());
    this.iconButton(actions, 'more-horizontal', '더보기', (evt) => this.openMenu(evt));
    this.toolbar = new Toolbar(this.panelHeaderEl, {
      onModel: (value) => void this.session?.setModel(value),
      onEffort: (value) => void this.session?.setEffort(value),
      onMode: (mode) => void this.session?.setPermissionMode(mode),
    });

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
      onCycleMode: () => this.cycleMode(),
      onFocus: () => this.refreshContext(),
      onInput: (textarea) => void this.updateSlash(textarea),
      onKeyDownCapture: (evt) => this.slash.handleKey(evt),
    });
    this.slash = new SlashPopup(this.composer.el, (item) => this.pickCommand(item));

    this.tracker = new ActiveNoteTracker(this.app, () => this.refreshContext());
    this.tracker.attach((ref) => this.registerEvent(ref));
    this.refreshContext();

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
    this.isNewThread = true;
    this.titled = false;
    this.firstPrompt = null;
    this.resuming = false;
    this.composer.focus();
  }

  private createSession(): ClaudeSession {
    return new ClaudeSession({
      query,
      getConfig: () => this.plugin.sessionConfig(),
      onStderr: (data) => this.plugin.diagnostics.recordStderr(data),
    });
  }

  private useSession(session: ClaudeSession): void {
    this.offSession?.();
    this.session?.close();
    this.session = session;
    this.offSession = session.on((e) => this.onEvent(e));
    this.state.clear();
    this.list.clear();
    this.composer.setBusy(false);
    this.toolbar.reset();
    this.commands = null;
    this.slash.hide();
  }

  private setTitle(title: string): void {
    this.threadTitleEl.setText(title);
  }

  private submit(text: string): void {
    const session = this.session;
    if (!session) return;
    this.refreshContext();
    const { prompt, contextLabel } = buildPrompt(text, this.contextSel.effective());
    if (this.firstPrompt === null) this.firstPrompt = text;
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

  private onEvent(e: PanelEvent): void {
    this.recordDiagnostics(e);
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

  private async runNoticeAction(action: NoticeAction): Promise<void> {
    if (action === 'reconnect') this.session?.reconnect();
    else if (action === 'find-claude') await this.plugin.autoFindClaude();
    else this.plugin.openSettings();
  }

  private async updateSlash(textarea: HTMLTextAreaElement): Promise<void> {
    const token = slashToken(textarea.value, textarea.selectionStart);
    if (token === null) {
      this.slash.hide();
      return;
    }
    const session = this.session;
    if (!session) return;
    if (this.commands === null) {
      let fetched: CommandItem[];
      try {
        session.ensureStarted(); // 명령 목록은 CLI 초기화 결과에서만 얻을 수 있다
        fetched = toCommandItems(await session.supportedCommands());
      } catch {
        return;
      }
      if (this.session !== session) return;
      this.commands = fetched;
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

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLElement {
    const btn = parent.createEl('button', { cls: 'cp-icon-btn clickable-icon', attr: { 'aria-label': label } });
    setIcon(btn, icon);
    btn.addEventListener('click', onClick);
    return btn;
  }
}
