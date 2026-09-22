import { Modal, type App } from 'obsidian';

export class TextPromptModal extends Modal {
  constructor(
    app: App,
    private readonly heading: string,
    private readonly initial: string,
    private readonly onSubmit: (value: string) => void | Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.heading);
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'cp-prompt-input' });
    input.value = this.initial;
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const submit = () => {
      const value = input.value.trim();
      if (!value) return;
      this.close();
      void this.onSubmit(value);
    };
    row.createEl('button', { cls: 'mod-cta', text: '저장' }).addEventListener('click', submit);
    row.createEl('button', { text: '취소' }).addEventListener('click', () => this.close());
    input.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' && !evt.isComposing) {
        evt.preventDefault();
        submit();
      }
    });
    input.select();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
