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
