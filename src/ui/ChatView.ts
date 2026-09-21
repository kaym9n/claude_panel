import { query } from '@anthropic-ai/claude-agent-sdk';
import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import { ChatState, type NoticeAction } from '../chat/ChatState';
import { ContextSelection, buildPrompt } from '../context/ContextBuilder';
import { ActiveNoteTracker } from '../context/ActiveNoteTracker';
import type ClaudePanelPlugin from '../main';
import { ClaudeSession } from '../session/ClaudeSession';
import type { PanelEvent } from '../types';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { Toolbar, nextMode } from './Toolbar';

export const VIEW_TYPE_CLAUDE_PANEL = 'claude-panel-view';

export class ChatView extends ItemView {
  private session: ClaudeSession | null = null;
  private offSession: (() => void) | null = null;
  private readonly state = new ChatState();
  private list!: MessageList;
  private composer!: Composer;
  private headerEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private toolbar!: Toolbar;
  private tracker!: ActiveNoteTracker;
  private readonly contextSel = new ContextSelection();

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
    this.toolbar = new Toolbar(this.headerEl, {
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
    });

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
    this.toolbar.reset();
  }

  private setTitle(title: string): void {
    this.titleEl.setText(title);
  }

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
