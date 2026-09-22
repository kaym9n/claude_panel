import { Modal, type App } from 'obsidian';
import type { RewriteController } from '../rewrite/RewriteSelection';
import { errorMessage } from '../session/ClaudeSession';

export class RewriteModal extends Modal {
  constructor(app: App, private readonly controller: RewriteController) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText('선택 영역 고쳐쓰기');
    this.modalEl.addClass('cp-rewrite-modal');
    const input = this.contentEl.createEl('textarea', {
      cls: 'cp-rewrite-instruction',
      attr: { rows: '3', placeholder: '어떻게 고칠까요? (예: 더 간결하게, 존댓말로)' },
    });
    const status = this.contentEl.createDiv({ cls: 'cp-rewrite-status' });
    const diffEl = this.contentEl.createDiv({ cls: 'cp-rewrite-diff' });
    diffEl.setText(this.controller.original);
    const buttons = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const generateBtn = buttons.createEl('button', { cls: 'mod-cta', text: '생성' });
    const applyBtn = buttons.createEl('button', { text: '적용' });
    applyBtn.disabled = true;
    buttons.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());

    const generate = async () => {
      const instruction = input.value.trim();
      if (!instruction) return;
      generateBtn.disabled = true;
      applyBtn.disabled = true;
      status.setText('생성 중…');
      try {
        const segments = await this.controller.generate(instruction);
        diffEl.empty();
        for (const s of segments) diffEl.createSpan({ cls: `cp-diff-${s.type}`, text: s.text });
        status.setText('');
        applyBtn.disabled = false;
        generateBtn.setText('다시 생성');
      } catch (err) {
        status.setText(`실패: ${errorMessage(err)}`);
      } finally {
        generateBtn.disabled = false;
      }
    };

    generateBtn.addEventListener('click', () => void generate());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.shiftKey && !evt.isComposing) {
        evt.preventDefault();
        void generate();
      }
    });
    applyBtn.addEventListener('click', () => {
      if (this.controller.apply()) {
        this.close();
        return;
      }
      status.setText('원문이 변경됨, 다시 생성하세요.');
      applyBtn.disabled = true;
    });
    input.focus();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
