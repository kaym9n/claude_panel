import { Modal, type App } from 'obsidian';
import type { ContextSnapshot } from '../context/ContextBuilder';

export class ContextPreviewModal extends Modal {
  constructor(app: App, private readonly context: ContextSnapshot) { super(app); }

  override onOpen(): void {
    this.titleEl.setText('이번 메시지의 첨부 정보');
    const { note, selection } = this.context;
    if (note) {
      this.contentEl.createEl('h4', { text: '현재 노트' });
      this.contentEl.createEl('p', { text: note.path });
      this.contentEl.createEl('p', { text: '노트 경로를 전달하며, 필요하면 Claude가 문서를 읽습니다.' });
    }
    if (selection) {
      this.contentEl.createEl('h4', { text: `선택 영역 · L${selection.fromLine}–${selection.toLine}` });
      this.contentEl.createEl('p', { text: selection.path });
      this.contentEl.createEl('pre', { cls: 'cp-context-preview', text: selection.text });
    }
    if (!note && !selection) this.contentEl.createEl('p', { text: '첨부 정보가 없습니다.' });
    this.contentEl.createEl('p', { text: '/ 명령에는 노트와 선택 영역을 첨부하지 않습니다.' });
  }

  override onClose(): void { this.contentEl.empty(); }
}
