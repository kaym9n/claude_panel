import { setIcon } from 'obsidian';
import { buttonIcon, inlineIcon } from './icons';

export interface ComposerHandlers {
  sendKey(): 'enter' | 'mod-enter';
  onSubmit(text: string): void;
  onStop(): void;
  /** Shift+Tab: 권한 모드 순환 (Task 11) */
  onCycleMode?(): void;
  /** 입력이 바뀔 때 (Task 14 자동완성) */
  onInput?(textarea: HTMLTextAreaElement): void;
  /** 자동완성 팝업이 키를 가로챌 기회. true면 처리 완료 */
  onKeyDownCapture?(evt: KeyboardEvent): boolean;
  /** 입력창 포커스 (Task 13 컨텍스트 칩 갱신) */
  onFocus?(): void;
}

export class Composer {
  readonly chipsEl: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  readonly controlsEl: HTMLElement;
  readonly statusEl: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly hint: HTMLButtonElement;
  private readonly statusIcon: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly restoreButton: HTMLButtonElement;
  private failedInput: string | null = null;
  private busy = false;

  constructor(readonly el: HTMLElement, private readonly h: ComposerHandlers) {
    this.chipsEl = el.createDiv({ cls: 'cp-chips' });
    this.statusEl = el.createDiv({ cls: 'cp-activity-status', attr: { role: 'status', 'aria-live': 'polite' } });
    this.statusIcon = inlineIcon(this.statusEl, 'circle-dot');
    this.statusText = this.statusEl.createSpan();
    this.textarea = el.createEl('textarea', { cls: 'cp-input', attr: { rows: '2', placeholder: '메시지 입력 (/ 명령)', 'aria-label': 'Claude에게 보낼 메시지' } });
    const bar = el.createDiv({ cls: 'cp-composer-bar' });
    this.controlsEl = bar.createDiv({ cls: 'cp-composer-controls' });
    this.hint = bar.createEl('button', { cls: 'cp-input-hint' });
    this.hint.addEventListener('click', () => {
      const expanded = this.hint.getAttribute('aria-expanded') !== 'true';
      this.hint.setAttribute('aria-expanded', String(expanded));
      this.el.toggleClass('cp-show-shortcuts', expanded);
    });
    bar.createSpan({ cls: 'cp-shortcut-help', text: 'Enter 전송 · Shift+Enter 줄바꿈 · Shift+Tab 권한 변경 · Esc 중단' });
    this.restoreButton = bar.createEl('button', { cls: 'cp-restore-input', text: '실패한 입력 추가' });
    buttonIcon(this.restoreButton, 'rotate-ccw', '실패한 입력 추가 (작성 중인 초안 유지)');
    this.restoreButton.hidden = true;
    this.restoreButton.addEventListener('click', () => {
      if (!this.failedInput) return;
      const value = this.textarea.value ? `${this.textarea.value}\n\n${this.failedInput}` : this.failedInput;
      this.setValue(value, value.length);
      this.failedInput = null; this.restoreButton.hidden = true; this.focus();
    });
    this.button = bar.createEl('button', { cls: 'mod-cta', text: '전송' });
    buttonIcon(this.button, 'arrow-up', '메시지 전송');
    this.button.addClass('cp-send');
    this.button.addEventListener('click', () => (this.busy ? this.h.onStop() : this.submit()));
    this.textarea.addEventListener('keydown', (evt) => this.onKeyDown(evt));
    this.textarea.addEventListener('input', () => {
      this.autosize();
      this.updateHint();
      this.h.onInput?.(this.textarea);
    });
    this.textarea.addEventListener('focus', () => this.h.onFocus?.());
    this.updateHint();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    buttonIcon(this.button, busy ? 'square' : 'arrow-up', busy ? '응답 중단 (Esc)' : '메시지 전송');
    this.el.toggleClass('is-busy', busy);
    this.button.toggleClass('mod-cta', !busy);
    this.button.toggleClass('mod-warning', busy);
    this.updateHint();
  }

  setStatus(text: string): void {
    if (this.statusText.textContent === text) return;
    this.statusText.setText(text === '새 대화' ? '준비' : text);
    this.statusEl.title = this.statusText.textContent ?? text;
    this.statusEl.toggleClass('is-attention', /오류|실패|승인/.test(text));
    const icon = /오류|실패/.test(text) ? 'circle-alert' : /승인/.test(text) ? 'shield-question' : /완료|복원됨/.test(text) ? 'check' : /중단/.test(text) ? 'square' : /생각/.test(text) ? 'sparkles' : /도구/.test(text) ? 'wrench' : /연결|재시도|불러오는/.test(text) ? 'loader-circle' : 'circle-dot';
    setIcon(this.statusIcon, icon);
  }

  offerRestore(text: string): void {
    if (!this.textarea.value) this.setValue(text, text.length);
    else if (this.textarea.value !== text) { this.failedInput = text; this.restoreButton.hidden = false; }
  }

  focus(): void {
    this.textarea.focus();
  }

  setValue(value: string, cursor: number): void {
    this.textarea.value = value;
    this.textarea.setSelectionRange(cursor, cursor);
    this.autosize();
    this.updateHint();
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (!text || this.busy) return;
    this.failedInput = null; this.restoreButton.hidden = true;
    this.setValue('', 0);
    this.h.onSubmit(text);
  }

  private onKeyDown(evt: KeyboardEvent): void {
    if (evt.isComposing || evt.keyCode === 229) return; // 한글 조합 중 Enter는 글자 확정용
    if (this.h.onKeyDownCapture?.(evt)) return;
    if (evt.key === 'Escape' && this.busy) {
      evt.preventDefault();
      this.h.onStop();
      return;
    }
    if (evt.key === 'Tab' && evt.shiftKey && this.h.onCycleMode) {
      evt.preventDefault();
      this.h.onCycleMode();
      return;
    }
    if (evt.key !== 'Enter' || evt.shiftKey) return;
    const mod = evt.ctrlKey || evt.metaKey;
    if (mod || this.h.sendKey() === 'enter') {
      evt.preventDefault();
      this.submit();
    }
  }

  private autosize(): void {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 180)}px`;
  }

  private updateHint(): void {
    const command = this.textarea.value.trimStart().startsWith('/');
    this.chipsEl.toggle(!command);
    const hint = command ? '/ 명령 · 첨부 없이 전송' : this.busy ? 'Esc 중단 · 새 입력은 보관됩니다' : `${this.h.sendKey() === 'enter' ? 'Enter' : 'Ctrl/⌘+Enter'} 전송 · Shift+Enter 줄바꿈`;
    buttonIcon(this.hint, command ? 'slash' : 'keyboard', hint);
    this.el.querySelector('.cp-shortcut-help')?.setText(`${hint} · Shift+Tab 권한 변경`);
    this.button.disabled = !this.busy && !this.textarea.value.trim();
  }
}
