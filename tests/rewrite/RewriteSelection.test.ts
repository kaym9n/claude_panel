import { describe, expect, it, vi } from 'vitest';
import { REWRITE_SYSTEM_PROMPT, RewriteController, buildRewritePrompt, finalizeRewrite, wordDiff, type EditorLike, type Pos } from '../../src/rewrite/RewriteSelection';

const from: Pos = { line: 3, ch: 0 };
const to: Pos = { line: 4, ch: 5 };

class FakeEditor implements EditorLike {
  constructor(public text: string) {}
  getRange(): string {
    return this.text;
  }
  replaceRange(text: string): void {
    this.text = text;
  }
}

describe('wordDiff', () => {
  it('같은 부분+삭제는 원문, 같은 부분+추가는 결과를 이룬다', () => {
    const segs = wordDiff('회의는 월요일 오전에 한다', '회의는 화요일 오전에 한다');
    expect(segs.filter((s) => s.type !== 'add').map((s) => s.text).join('')).toBe('회의는 월요일 오전에 한다');
    expect(segs.filter((s) => s.type !== 'del').map((s) => s.text).join('')).toBe('회의는 화요일 오전에 한다');
    // jsdiff는 한글을 글자 단위로 나눈다 ('월' → '화')
    expect(segs).toContainEqual({ type: 'del', text: '월' });
    expect(segs).toContainEqual({ type: 'add', text: '화' });
  });
});

describe('buildRewritePrompt / finalizeRewrite', () => {
  it('노트 경로·지시·원문을 담는다', () => {
    expect(buildRewritePrompt({ text: '원문', instruction: '간결하게', path: 'a.md' })).toBe('Note: a.md\nInstruction: 간결하게\n\n<passage>\n원문\n</passage>');
  });
  it('전체를 감싼 코드 펜스를 벗기고 원문의 앞뒤 공백을 보존한다', () => {
    expect(finalizeRewrite('  hello\n', '```markdown\nbye\n```')).toBe('  bye\n');
    expect(finalizeRewrite('hello', '\nbye\n')).toBe('bye');
    expect(finalizeRewrite('   ', 'x')).toBe('x');
  });
});

describe('RewriteController', () => {
  it('generate는 시스템 프롬프트와 함께 실행하고 diff를 돌려준다', async () => {
    const run = vi.fn(async () => '새 문장');
    const c = new RewriteController(new FakeEditor('옛 문장'), from, to, '옛 문장', 'a.md', run);
    const segs = await c.generate('바꿔');
    expect(run).toHaveBeenCalledWith(buildRewritePrompt({ text: '옛 문장', instruction: '바꿔', path: 'a.md' }), REWRITE_SYSTEM_PROMPT);
    expect(c.result).toBe('새 문장');
    expect(segs.length).toBeGreaterThan(0);
  });

  it('원문이 그대로면 적용한다', async () => {
    const editor = new FakeEditor('옛 문장');
    const c = new RewriteController(editor, from, to, '옛 문장', 'a.md', async () => '새 문장');
    await c.generate('바꿔');
    expect(c.apply()).toBe(true);
    expect(editor.text).toBe('새 문장');
  });

  it('원문이 바뀌었으면 적용을 거부한다', async () => {
    const editor = new FakeEditor('옛 문장');
    const c = new RewriteController(editor, from, to, '옛 문장', 'a.md', async () => '새 문장');
    await c.generate('바꿔');
    editor.text = '누군가 고친 문장';
    expect(c.apply()).toBe(false);
    expect(editor.text).toBe('누군가 고친 문장');
  });

  it('생성 전에는 적용할 수 없다', () => {
    const c = new RewriteController(new FakeEditor('a'), from, to, 'a', 'a.md', async () => 'b');
    expect(c.apply()).toBe(false);
  });
});
