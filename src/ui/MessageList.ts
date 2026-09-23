import { Component, Keymap, MarkdownRenderer, type App } from 'obsidian';
import type { ChatItem, ChatState, ItemOf, NoticeAction } from '../chat/ChatState';
import type { ApprovalDecision } from '../session/ApprovalBroker';
import { renderApprovalCard } from './ApprovalCard';
import { formatSeconds, formatUsage } from './format';
import { toolDetails, toolSummary } from './toolFormat';
import { buttonIcon, inlineIcon } from './icons';
import { activitySummary } from './activitySummary';

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
const STATUS_ICON: Record<ItemOf<'tool'>['status'], string> = { running: 'loader-circle', done: 'check', error: 'circle-x', cancelled: 'circle-minus' };
const ACTION_LABEL: Record<NoticeAction, string> = { reconnect: '다시 연결', 'find-claude': '경로 자동 찾기', 'open-settings': '설정 열기' };

export class MessageList {
  private readonly els = new Map<string, HTMLElement>();
  private readonly renderers = new Map<string, Component>();
  private readonly pending = new Set<string>();
  private timer: number | null = null;
  private activeGroup: { root: HTMLElement; summary: HTMLElement; ids: Set<string> } | null = null;
  private readonly groups: NonNullable<MessageList['activeGroup']>[] = [];
  private readonly jump: HTMLButtonElement;

  constructor(private readonly root: HTMLElement, private readonly ctx: MessageListContext) {
    root.addEventListener('click', (evt) => this.onLinkClick(evt));
    this.jump = root.parentElement!.createEl('button', { cls: 'cp-jump-latest', text: '↓ 최신 응답', attr: { 'aria-label': '최신 응답으로 이동' } });
    buttonIcon(this.jump, 'arrow-down', '최신 응답으로 이동');
    this.jump.hidden = true;
    this.jump.addEventListener('click', () => this.scrollToBottom());
    root.addEventListener('scroll', () => { this.jump.hidden = this.isPinnedToBottom(); });
  }

  clear(): void {
    for (const component of this.renderers.values()) this.ctx.owner.removeChild(component);
    this.renderers.clear();
    this.els.clear();
    this.pending.clear();
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.root.empty();
    this.groups.length = 0;
    this.activeGroup = null;
    this.jump.hidden = true;
  }

  update(ids: string[]): void {
    const pinned = this.isPinnedToBottom();
    for (const id of new Set(ids)) {
      const item = this.ctx.state.get(id);
      if (!item) continue;
      let el = this.els.get(id);
      if (!el) {
        if (item.type === 'user') this.activeGroup = null;
        let parent = this.root;
        if (item.type === 'tool' || (item.type === 'block' && item.blockType === 'thinking')) {
          if (!this.activeGroup) {
            const details = this.root.createEl('details', { cls: 'cp-activity-group' });
            this.activeGroup = { root: details.createDiv({ cls: 'cp-activity-body' }), summary: details.createEl('summary'), ids: new Set() };
            details.prepend(this.activeGroup.summary);
            this.groups.push(this.activeGroup);
          }
          this.activeGroup.ids.add(id);
          parent = this.activeGroup.root;
        }
        el = parent.createDiv({ cls: `cp-item cp-${item.type}` });
        this.els.set(id, el);
        if (item.type === 'footer') this.activeGroup = null;
      }
      if (item.type === 'block' && item.blockType === 'text' && item.streaming) {
        this.schedule(id); // 스트리밍 중 마크다운 재렌더는 100ms당 1회
      } else {
        this.pending.delete(id);
        this.render(item, el);
      }
    }
    for (const group of this.groups) {
      group.summary.empty();
      inlineIcon(group.summary, 'workflow');
      group.summary.createSpan({ text: activitySummary([...group.ids].map(id => this.ctx.state.get(id)!).filter(Boolean)) });
    }
    if (pinned) this.scrollToBottom();
    else this.jump.hidden = false;
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
        if (this.renderers.get(key) === component) {
          const pinned = this.isPinnedToBottom();
          el.replaceChildren(target);
          if (pinned) this.scrollToBottom();
        }
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
          let body = el.querySelector<HTMLElement>('.cp-response-body');
          if (!body) {
            body = el.createDiv({ cls: 'cp-response-body markdown-rendered' });
            const actions = el.createDiv({ cls: 'cp-response-actions' });
            const copy = actions.createEl('button', { text: '복사', attr: { 'aria-label': '응답 복사' } });
            buttonIcon(copy, 'copy', '응답 복사');
            copy.addEventListener('click', () => {
              const current = this.ctx.state.get(item.id);
              if (current?.type !== 'block') return;
              void navigator.clipboard.writeText(current.text).then(() => buttonIcon(copy, 'check', '복사됨')).catch(() => buttonIcon(copy, 'circle-alert', '복사 실패 · 다시 시도'));
            });
          }
          const copy = el.querySelector<HTMLButtonElement>('.cp-response-actions button');
          if (copy) copy.disabled = item.streaming || !item.text;
          this.renderMarkdown(body, item.text, item.id);
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
    const status = summary.createSpan({ cls: `cp-tool-status cp-status-${item.status}`, attr: { 'aria-label': { running: '실행 중', done: '완료', error: '오류', cancelled: '중단됨' }[item.status] } });
    inlineIcon(status, STATUS_ICON[item.status]);
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
    this.jump.hidden = true;
  }
}
