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
