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
  private readonly button: HTMLButtonElement;
  private busy = false;

  constructor(readonly el: HTMLElement, private readonly h: ComposerHandlers) {
    this.chipsEl = el.createDiv({ cls: 'cp-chips' });
    this.textarea = el.createEl('textarea', { cls: 'cp-input', attr: { rows: '3', placeholder: '메시지 입력 (/ 명령)' } });
    const bar = el.createDiv({ cls: 'cp-composer-bar' });
    this.button = bar.createEl('button', { cls: 'mod-cta', text: '전송' });
    this.button.addEventListener('click', () => (this.busy ? this.h.onStop() : this.submit()));
    this.textarea.addEventListener('keydown', (evt) => this.onKeyDown(evt));
    this.textarea.addEventListener('input', () => {
      this.autosize();
      this.h.onInput?.(this.textarea);
    });
    this.textarea.addEventListener('focus', () => this.h.onFocus?.());
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.button.setText(busy ? '■ 중단' : '전송');
    this.button.toggleClass('mod-cta', !busy);
    this.button.toggleClass('mod-warning', busy);
  }

  focus(): void {
    this.textarea.focus();
  }

  setValue(value: string, cursor: number): void {
    this.textarea.value = value;
    this.textarea.setSelectionRange(cursor, cursor);
    this.autosize();
  }

  private submit(): void {
    const text = this.textarea.value.trim();
    if (!text || this.busy) return;
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
    this.textarea.style.height = `${Math.min(this.textarea.scrollHeight, 240)}px`;
  }
}
