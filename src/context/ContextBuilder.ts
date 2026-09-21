export interface NoteRef {
  path: string;
}

export interface SelectionRef {
  path: string;
  /** 1부터 시작 */
  fromLine: number;
  toLine: number;
  text: string;
}

export interface ContextSnapshot {
  note: NoteRef | null;
  selection: SelectionRef | null;
}

function noteName(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

/** 본문 안의 코드 펜스와 겹치지 않는 펜스 */
export function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * 사용자 입력에 컨텍스트를 붙인다. 노트는 경로만 (필요하면 Claude가 Read로 읽는다).
 * `/명령`은 CLI가 맨 앞만 명령으로 해석하므로 컨텍스트를 붙이지 않는다.
 */
export function buildPrompt(userText: string, ctx: ContextSnapshot): { prompt: string; contextLabel: string | null } {
  if (userText.startsWith('/')) return { prompt: userText, contextLabel: null };
  const lines: string[] = [];
  const labels: string[] = [];
  if (ctx.note) {
    lines.push(`현재 노트: ${ctx.note.path}`);
    labels.push(`📄 ${noteName(ctx.note.path)}`);
  }
  if (ctx.selection) {
    const s = ctx.selection;
    const fence = fenceFor(s.text);
    lines.push(`선택 영역: ${s.path} L${s.fromLine}-${s.toLine}`, fence, s.text, fence);
    labels.push(ctx.note?.path === s.path ? `✂ L${s.fromLine}–${s.toLine}` : `✂ ${noteName(s.path)} L${s.fromLine}–${s.toLine}`);
  }
  if (lines.length === 0) return { prompt: userText, contextLabel: null };
  return { prompt: `<context>\n${lines.join('\n')}\n</context>\n\n${userText}`, contextLabel: labels.join(' · ') };
}

const noteKey = (n: NoteRef) => n.path;
const selectionKey = (s: SelectionRef) => `${s.path}:${s.fromLine}:${s.toLine}:${s.text}`;

/** 칩의 × 상태. 대상(노트·선택)이 바뀌면 해제가 풀린다. */
export class ContextSelection {
  private snapshot: ContextSnapshot = { note: null, selection: null };
  private dismissedNote: string | null = null;
  private dismissedSelection: string | null = null;

  update(next: ContextSnapshot): void {
    this.snapshot = next;
  }

  dismiss(kind: 'note' | 'selection'): void {
    if (kind === 'note' && this.snapshot.note) this.dismissedNote = noteKey(this.snapshot.note);
    if (kind === 'selection' && this.snapshot.selection) this.dismissedSelection = selectionKey(this.snapshot.selection);
  }

  effective(): ContextSnapshot {
    const { note, selection } = this.snapshot;
    return {
      note: note && noteKey(note) !== this.dismissedNote ? note : null,
      selection: selection && selectionKey(selection) !== this.dismissedSelection ? selection : null,
    };
  }

  /** 전송 후: 같은 선택 영역을 다음 메시지에 다시 붙이지 않는다. */
  consumeSelection(): void {
    this.dismiss('selection');
  }
}
