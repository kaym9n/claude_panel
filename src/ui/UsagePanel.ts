import { buttonIcon, inlineIcon } from './icons';
import { resetText } from '../usage/accountUsage';
import type { UsageService } from '../usage/UsageService';

export class UsagePanel {
  private readonly summary: HTMLElement;
  private readonly summaryText: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly refreshButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly off: () => void;
  private readonly timer: number;
  private readonly closePopup: (event: Event) => void;

  constructor(private readonly root: HTMLElement, private readonly service: UsageService) {
    const top = root.createDiv({ cls: 'cp-usage-top' });
    const details = top.createEl('details', { cls: 'cp-usage-details' });
    this.summary = details.createEl('summary');
    inlineIcon(this.summary, 'gauge');
    this.summaryText = this.summary.createSpan({ cls: 'cp-usage-summary-text' });
    const popup = details.createDiv({ cls: 'cp-usage-popup' });
    const header = popup.createDiv({ cls: 'cp-usage-popup-header' });
    header.createSpan({ text: '계정 사용 한도' });
    this.detail = popup.createDiv({ cls: 'cp-usage-body' });
    this.refreshButton = header.createEl('button', { text: '새로고침', attr: { 'aria-label': '계정 한도 새로고침' } });
    buttonIcon(this.refreshButton, 'refresh-cw', '계정 한도 새로고침');
    this.refreshButton.addEventListener('click', () => void service.refresh(true));
    details.addEventListener('toggle', () => { if (details.open) void service.refresh(); });
    this.status = popup.createDiv({ cls: 'cp-usage-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.alert = popup.createDiv({ cls: 'cp-usage-alert', attr: { role: 'status' } });
    this.closePopup = event => {
      if (!details.open) return;
      if (event instanceof KeyboardEvent && event.key === 'Escape') { details.open = false; this.summary.focus(); event.preventDefault(); event.stopPropagation(); }
      else if (event.type === 'pointerdown' && !root.contains(event.target as Node)) details.open = false;
    };
    root.ownerDocument.addEventListener('pointerdown', this.closePopup);
    root.ownerDocument.addEventListener('keydown', this.closePopup, true);
    this.off = service.subscribe(() => this.render());
    this.timer = window.setInterval(() => {
      if (root.ownerDocument.hidden || !root.getClientRects().length) return;
      this.render();
      void service.refresh();
    }, 15_000);
    void service.refresh();
  }

  destroy(): void { this.off(); window.clearInterval(this.timer); this.root.ownerDocument.removeEventListener('pointerdown', this.closePopup); this.root.ownerDocument.removeEventListener('keydown', this.closePopup, true); }

  private render(): void {
    const s = this.service.state;
    const stale = this.service.isStale();
    const rows = s.data?.rows ?? [];
    const head = rows.find(r => r.active) ?? rows[0];
    const value = head?.percent === null ? '사용률 미제공' : `${head?.percent}% 사용`;
    let summary = head ? `계정 한도 · ${head.label} ${value}` : '계정 한도 · 아직 조회하지 않음';
    if (s.status === 'loading') summary = head ? `${summary} · 조회 중` : '계정 한도 · 조회 중…';
    else if (s.status === 'unsupported') summary = '계정 한도 · 조회 미지원';
    else if (s.status === 'error') summary = head ? `${summary} · 이전 확인값` : '계정 한도 · 조회 실패';
    else if (s.status === 'ready' && !head) summary = '계정 한도 · 제공된 한도 없음';
    else if (head && stale) summary += ' · 재확인 필요';
    const compact = head?.percent !== null && head?.percent !== undefined ? `${head.percent}%` : '—';
    this.summaryText.setText(s.status === 'error' ? '!' : s.status === 'loading' && !head ? '…' : compact);
    this.root.toggleClass('is-stale', stale || s.status === 'error');
    this.summary.setAttribute('aria-label', summary);
    this.summary.title = `${summary}${head ? ` · ${resetText(head.resetsAt)}` : ''} · 클릭해 상세 보기`;
    this.refreshButton.toggleClass('is-loading', s.status === 'loading');
    this.refreshButton.disabled = s.status === 'loading';
    const critical = rows.some(r => r.severity === 'critical' || r.percent === 100) || s.alert?.status === 'rejected';
    const warning = rows.some(r => r.severity === 'warning') || s.alert?.status === 'allowed_warning';
    this.summary.setAttribute('aria-label', `${summary}${critical ? ' · 사용 한도 도달' : warning ? ' · 한도 경고' : ''}`);
    this.summary.title = this.summary.getAttribute('aria-label')! + ' · 클릭해 상세 보기';
    this.root.toggleClass('is-critical', critical);
    this.root.toggleClass('is-warning', !critical && warning);

    this.detail.empty();
    this.detail.createDiv({ cls: 'cp-usage-hint', text: '계정 사용 한도입니다. 컨텍스트와 별개이며, 시간은 기기 현지 시간입니다.' });
    for (const row of rows) {
      const el = this.detail.createDiv({ cls: 'cp-usage-row' });
      el.createDiv({ text: `${row.label} · ${row.percent === null ? '사용률 미제공' : `${row.percent}% 사용`}` });
      if (row.percent !== null) el.createEl('progress', { attr: { max: '100', value: String(row.percent), 'aria-label': `${row.label} 사용률` } });
      el.createDiv({ cls: 'cp-usage-hint', text: resetText(row.resetsAt) });
    }
    if (s.data?.extraUsage !== null && s.data?.extraUsage !== undefined) {
      this.detail.createDiv({ cls: 'cp-usage-hint', text: `추가 사용 ${s.data.extraUsage ? '활성' : '비활성'}` });
    }
    if (s.status === 'unsupported') this.detail.createDiv({ text: s.error ?? '이 연결에서는 구독 한도를 제공하지 않습니다(API 계정·인증 범위 등을 확인하세요).' });
    if (s.status === 'error') this.detail.createDiv({ text: `조회 실패: ${s.error}${s.checkedAt !== null ? ' 마지막 확인값을 표시합니다.' : ''}` });
    const a = this.detail.createEl('a', { text: 'Claude 공식 사용량 열기', href: 'https://claude.ai/settings/usage' });
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');

    const lines: string[] = [];
    if (head) lines.push(resetText(head.resetsAt));
    if (s.alert && s.alert.status !== 'allowed') {
      lines.push(`${s.alert.label} ${s.alert.status === 'rejected' ? '사용 제한 알림' : '한도 경고'} · ${resetText(s.alert.resetsAt)}${s.alertAt !== null ? ` (수신 ${new Date(s.alertAt).toLocaleTimeString()})` : ''}`);
    }
    if (s.checkedAt !== null) lines.push(`마지막 확인 ${new Date(s.checkedAt).toLocaleTimeString()}${stale || s.status === 'error' ? ' · 이전 확인값' : ''}`);
    if (s.status === 'error') lines.push('조회 실패 · 새로고침으로 재시도');
    this.status.setText(lines.join('\n'));
    this.alert.setText(s.alert?.status === 'rejected' || critical ? `${stale || s.status === 'error' ? '이전 확인값 · ' : ''}사용 한도 도달${head ? ` · ${resetText(head.resetsAt)}` : ''}` : s.status === 'error' ? '조회 실패 · 이전 확인값입니다' : warning ? '사용 한도에 가까워졌습니다' : '');
    this.alert.hidden = !this.alert.textContent;
  }
}
