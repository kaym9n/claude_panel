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
