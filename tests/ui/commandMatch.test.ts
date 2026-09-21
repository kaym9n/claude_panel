import { describe, expect, it } from 'vitest';
import { applyCommand, matchCommands, slashToken, toCommandItems, type CommandItem } from '../../src/ui/commandMatch';

const cmd = (name: string): CommandItem => ({ name, description: '', argumentHint: '' });

describe('slashToken', () => {
  it('입력 맨 앞의 /토큰 안에 커서가 있을 때만 토큰을 준다', () => {
    expect(slashToken('/ing', 4)).toBe('ing');
    expect(slashToken('/', 1)).toBe('');
    expect(slashToken('/ingest raw', 11)).toBeNull();
    expect(slashToken('hi /ing', 7)).toBeNull();
    expect(slashToken('/ing', 2)).toBe('i');
  });
});

describe('matchCommands', () => {
  const commands = ['ingest', 'init', 'query', 'superpowers:brainstorming', 'lint'].map(cmd);
  it('접두어 일치를 먼저, 부분 일치를 나중에 이름순으로', () => {
    expect(matchCommands('in', commands).map((c) => c.name)).toEqual(['ingest', 'init', 'lint', 'superpowers:brainstorming']);
  });
  it('빈 질의는 전체를 이름순으로, 개수 제한', () => {
    expect(matchCommands('', commands, 2).map((c) => c.name)).toEqual(['ingest', 'init']);
  });
  it('대소문자 무시', () => {
    expect(matchCommands('QUE', commands).map((c) => c.name)).toEqual(['query']);
  });
});

describe('applyCommand', () => {
  it('토큰을 /이름 + 공백으로 바꾸고 뒤 텍스트를 보존한다', () => {
    expect(applyCommand('/ing', 4, 'ingest')).toEqual({ value: '/ingest ', cursor: 8 });
    expect(applyCommand('/ing raw/a.pdf', 4, 'ingest')).toEqual({ value: '/ingest raw/a.pdf', cursor: 8 });
  });
});

describe('toCommandItems', () => {
  it('앞의 /를 떼고 중복을 없앤다', () => {
    expect(toCommandItems([{ name: '/ingest', description: 'd', argumentHint: '' }, { name: 'ingest', description: 'd2', argumentHint: '' }]))
      .toEqual([{ name: 'ingest', description: 'd', argumentHint: '' }]);
  });
});
