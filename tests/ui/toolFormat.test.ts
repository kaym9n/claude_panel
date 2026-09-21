import { describe, expect, it } from 'vitest';
import { oneLine, relativePath, toolDetails, toolSummary, truncate } from '../../src/ui/toolFormat';

const vault = '/home/u/Vault/Boxx';

describe('toolSummary', () => {
  it('파일 도구는 vault 기준 상대 경로', () => {
    expect(toolSummary('Read', { file_path: `${vault}/회의/a.md` }, vault)).toBe('회의/a.md');
    expect(toolSummary('Edit', { file_path: '/etc/hosts' }, vault)).toBe('/etc/hosts');
  });
  it('Bash는 description이 있으면 그것을, 없으면 명령을 한 줄로', () => {
    expect(toolSummary('Bash', { command: 'ls\n-la', description: 'List files' }, vault)).toBe('List files');
    expect(toolSummary('Bash', { command: 'ls\n  -la' }, vault)).toBe('ls -la');
  });
  it('검색·웹·스킬·에이전트 도구', () => {
    expect(toolSummary('Grep', { pattern: 'GAEMI' }, vault)).toBe('GAEMI');
    expect(toolSummary('WebFetch', { url: 'https://x.y' }, vault)).toBe('https://x.y');
    expect(toolSummary('Skill', { skill: 'ingest' }, vault)).toBe('ingest');
    expect(toolSummary('Agent', { description: 'Explore repo' }, vault)).toBe('Explore repo');
    expect(toolSummary('mcp__x__y', { a: 1 }, vault)).toBe('');
  });
  it('80자를 넘으면 줄인다', () => {
    expect(toolSummary('Bash', { command: 'x'.repeat(200) }, vault)).toHaveLength(80);
  });
});

describe('toolDetails', () => {
  it('Edit은 줄 단위 diff', () => {
    expect(toolDetails('Edit', { old_string: 'a\nb', new_string: 'a\nc' }, null)).toEqual([
      { kind: 'diff', lines: [{ type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'add', text: 'c' }] },
    ]);
  });
  it('MultiEdit은 편집마다 diff', () => {
    const d = toolDetails('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] }, null);
    expect(d).toHaveLength(2);
    expect(d.every((x) => x.kind === 'diff')).toBe(true);
  });
  it('Write는 내용, Bash는 명령과 출력', () => {
    expect(toolDetails('Write', { content: 'hello' }, null)).toEqual([{ kind: 'text', label: '내용', text: 'hello' }]);
    expect(toolDetails('Bash', { command: 'ls' }, 'a.md')).toEqual([
      { kind: 'text', label: '명령', text: 'ls' },
      { kind: 'text', label: '출력', text: 'a.md' },
    ]);
  });
  it('그 밖의 도구는 입력 JSON, 긴 출력은 잘라 표시한다', () => {
    const d = toolDetails('Grep', { pattern: 'x' }, 'y'.repeat(5000));
    expect(d[0]).toEqual({ kind: 'text', label: '입력', text: JSON.stringify({ pattern: 'x' }, null, 2) });
    expect(d[1]).toMatchObject({ label: '출력' });
    expect((d[1] as { text: string }).text).toContain('(1000자 생략)');
  });
});

describe('문자열 보조 함수', () => {
  it('relativePath·oneLine·truncate', () => {
    expect(relativePath(`${vault}/a.md`, `${vault}/`)).toBe('a.md');
    expect(oneLine('a  b\nc', 80)).toBe('a b c');
    expect(oneLine('abcdef', 4)).toBe('abc…');
    expect(truncate('abcdef', 4)).toBe('abcd… (2자 생략)');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
