import { MarkdownView, type App, type EventRef } from 'obsidian';
import type { ContextSnapshot } from './ContextBuilder';

/**
 * 사이드바 패널에 포커스가 가면 활성 뷰가 패널이 되므로,
 * 마지막으로 활성이었던 마크다운 편집기를 기억해 두고 그 노트·선택 영역을 읽는다.
 */
export class ActiveNoteTracker {
  private last: MarkdownView | null = null;

  constructor(private readonly app: App, private readonly onChange: () => void) {}

  attach(register: (ref: EventRef) => void): void {
    this.last = this.app.workspace.getActiveViewOfType(MarkdownView);
    register(
      this.app.workspace.on('active-leaf-change', (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.last = leaf.view;
          this.onChange();
        }
      }),
    );
    register(this.app.workspace.on('file-open', () => this.onChange()));
  }

  snapshot(includeNote: boolean): ContextSnapshot {
    const view = this.last;
    const alive = view !== null && this.app.workspace.getLeavesOfType('markdown').some((leaf) => leaf.view === view);
    if (!alive || !view.file) return { note: null, selection: null };
    const path = view.file.path;
    const editor = view.editor;
    let selection: ContextSnapshot['selection'] = null;
    if (editor.somethingSelected()) {
      const from = editor.getCursor('from');
      const to = editor.getCursor('to');
      selection = { path, fromLine: from.line + 1, toLine: to.line + 1, text: editor.getSelection() };
    }
    return { note: includeNote ? { path } : null, selection };
  }
}
