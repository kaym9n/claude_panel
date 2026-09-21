import { describe, expect, it } from 'vitest';
import { ContextSelection, buildPrompt, fenceFor, type ContextSnapshot } from '../../src/context/ContextBuilder';

const note = { path: '회의/2026-04-20 B1 서버실 구상.md' };
const selection = { path: '회의/2026-04-20 B1 서버실 구상.md', fromLine: 10, toLine: 15, text: '- 랙 2개\n- UPS' };

describe('buildPrompt', () => {
  it('컨텍스트가 없으면 원문 그대로', () => {
    expect(buildPrompt('안녕', { note: null, selection: null })).toEqual({ prompt: '안녕', contextLabel: null });
  });
  it('노트는 경로만 첨부한다', () => {
    expect(buildPrompt('요약해 줘', { note, selection: null })).toEqual({
      prompt: '<context>\n현재 노트: 회의/2026-04-20 B1 서버실 구상.md\n</context>\n\n요약해 줘',
      contextLabel: '📄 2026-04-20 B1 서버실 구상',
    });
  });
  it('선택 영역은 경로·줄 범위·텍스트를 코드 펜스로 첨부한다', () => {
    const r = buildPrompt('다듬어 줘', { note, selection });
    expect(r.prompt).toBe(
      '<context>\n현재 노트: 회의/2026-04-20 B1 서버실 구상.md\n선택 영역: 회의/2026-04-20 B1 서버실 구상.md L10-15\n```\n- 랙 2개\n- UPS\n```\n</context>\n\n다듬어 줘',
    );
    expect(r.contextLabel).toBe('📄 2026-04-20 B1 서버실 구상 · ✂ L10–15');
  });
  it('/명령에는 컨텍스트를 붙이지 않는다', () => {
    expect(buildPrompt('/ingest raw/a.pdf', { note, selection })).toEqual({ prompt: '/ingest raw/a.pdf', contextLabel: null });
  });
});

describe('fenceFor', () => {
  it('본문의 가장 긴 백틱 연속보다 길게', () => {
    expect(fenceFor('plain')).toBe('```');
    expect(fenceFor('a ```js b')).toBe('````');
  });
});

describe('ContextSelection', () => {
  const snap: ContextSnapshot = { note, selection };
  it('해제한 칩은 제외하고, 대상이 바뀌면 다시 붙는다', () => {
    const cs = new ContextSelection();
    cs.update(snap);
    cs.dismiss('note');
    expect(cs.effective()).toEqual({ note: null, selection });
    cs.update({ note: { path: 'other.md' }, selection: null });
    expect(cs.effective().note).toEqual({ path: 'other.md' });
  });
  it('보낸 선택 영역은 같은 선택이 유지되는 동안 다시 붙이지 않는다', () => {
    const cs = new ContextSelection();
    cs.update(snap);
    cs.consumeSelection();
    cs.update(snap);
    expect(cs.effective().selection).toBeNull();
    cs.update({ note, selection: { ...selection, toLine: 16, text: '- 랙 2개\n- UPS\n- 공조' } });
    expect(cs.effective().selection).not.toBeNull();
  });
});
