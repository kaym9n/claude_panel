import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import type { ThreadInfo } from '../threads/ThreadService';
import { formatRelativeTime } from './format';

export interface ThreadPickerHandlers {
  onOpen(thread: ThreadInfo): void;
  onFork(thread: ThreadInfo): void;
  onRename(thread: ThreadInfo): void;
}

export class ThreadPicker extends FuzzySuggestModal<ThreadInfo> {
  constructor(app: App, private readonly threads: ThreadInfo[], private readonly h: ThreadPickerHandlers, private readonly currentId: string | null = null) {
    super(app);
    this.setPlaceholder('최근 대화 검색');
    this.setInstructions([
      { command: '↵', purpose: '열기' },
      { command: 'Ctrl+↵', purpose: 'fork해서 열기' },
      { command: 'F2', purpose: '이름 변경' },
    ]);
    this.scope.register(['Mod'], 'Enter', (evt) => this.runOnSelected(evt, (t) => this.h.onFork(t)));
    this.scope.register([], 'F2', (evt) => this.runOnSelected(evt, (t) => this.h.onRename(t)));
  }

  getItems(): ThreadInfo[] {
    return this.threads;
  }

  getItemText(thread: ThreadInfo): string {
    return thread.title;
  }

  override renderSuggestion(match: FuzzyMatch<ThreadInfo>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    el.createDiv({ cls: 'cp-thread-time', text: `${match.item.id === this.currentId ? '현재 대화 · ' : ''}${formatRelativeTime(match.item.lastModified, Date.now())}` });
  }

  onChooseItem(thread: ThreadInfo): void {
    this.h.onOpen(thread);
  }

  private runOnSelected(evt: KeyboardEvent, action: (thread: ThreadInfo) => void): boolean {
    const thread = this.selected();
    if (!thread) return true;
    evt.preventDefault();
    this.close();
    action(thread);
    return false;
  }

  /** Obsidian이 선택 항목을 공개 API로 주지 않아 내부 chooser를 읽는다. */
  private selected(): ThreadInfo | null {
    const chooser = (this as unknown as { chooser?: { selectedItem: number; values: FuzzyMatch<ThreadInfo>[] | null } }).chooser;
    return chooser?.values?.[chooser.selectedItem]?.item ?? null;
  }
}
