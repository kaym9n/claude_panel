import { diffWordsWithSpace } from 'diff';

export interface DiffSegment {
  type: 'same' | 'add' | 'del';
  text: string;
}

export interface Pos {
  line: number;
  ch: number;
}

/** Obsidian Editor 중 고쳐쓰기에 필요한 부분 */
export interface EditorLike {
  getRange(from: Pos, to: Pos): string;
  replaceRange(text: string, from: Pos, to: Pos): void;
}

export type Runner = (prompt: string, systemPrompt: string) => Promise<string>;

export const REWRITE_SYSTEM_PROMPT =
  'You rewrite a passage from a Markdown note according to an instruction. ' +
  'Output only the rewritten passage: no explanations, no preamble, no code fences. ' +
  'Keep the original language and Markdown formatting unless the instruction says otherwise.';

export function wordDiff(before: string, after: string): DiffSegment[] {
  return diffWordsWithSpace(before, after).map((part) => ({ type: part.added ? 'add' : part.removed ? 'del' : 'same', text: part.value }));
}

export function buildRewritePrompt(req: { text: string; instruction: string; path: string }): string {
  return [`Note: ${req.path}`, `Instruction: ${req.instruction}`, '', '<passage>', req.text, '</passage>'].join('\n');
}

/** 모델이 결과를 코드 펜스로 감싼 경우 벗기고, 원문의 앞뒤 공백(줄바꿈 포함)을 되살린다. */
export function finalizeRewrite(original: string, output: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(output.trim());
  const body = fenced ? fenced[1] : output.trim();
  if (!original.trim()) return body;
  const lead = /^\s*/.exec(original)?.[0] ?? '';
  const trail = /\s*$/.exec(original)?.[0] ?? '';
  return lead + body + trail;
}

export class RewriteController {
  result: string | null = null;

  constructor(
    private readonly editor: EditorLike,
    private readonly from: Pos,
    private readonly to: Pos,
    readonly original: string,
    private readonly path: string,
    private readonly run: Runner,
  ) {}

  async generate(instruction: string): Promise<DiffSegment[]> {
    const output = await this.run(buildRewritePrompt({ text: this.original, instruction, path: this.path }), REWRITE_SYSTEM_PROMPT);
    this.result = finalizeRewrite(this.original, output);
    return wordDiff(this.original, this.result);
  }

  /** 적용 직전 선택 범위의 텍스트가 원문 그대로인지 확인한다. 바뀌었으면 적용하지 않고 false. */
  apply(): boolean {
    if (this.result === null) return false;
    if (this.editor.getRange(this.from, this.to) !== this.original) return false;
    this.editor.replaceRange(this.result, this.from, this.to);
    return true;
  }
}
