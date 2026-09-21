import { describe, expect, it } from 'vitest';
import { buildAnswers, extractPlan, parseQuestions } from '../../src/session/approvalInputs';

const input = {
  questions: [
    { question: '어느 폴더?', header: '위치', multiSelect: false, options: [{ label: '회의', description: '회의록' }, { label: '데일리', description: '일일 기록' }] },
    { question: '어떤 태그?', header: '태그', multiSelect: true, options: [{ label: 'a', description: '' }, { label: 'b', description: '' }] },
  ],
};

describe('parseQuestions', () => {
  it('질문·선택지를 읽고 형식이 틀린 항목은 버린다', () => {
    const qs = parseQuestions({ questions: [...input.questions, { header: 'no question' }, 'junk'] });
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ question: '어느 폴더?', header: '위치', multiSelect: false, options: [{ label: '회의', description: '회의록' }, { label: '데일리', description: '일일 기록' }] });
    expect(parseQuestions({})).toEqual([]);
  });
});

describe('buildAnswers', () => {
  const qs = parseQuestions(input);
  it('모든 질문에 답이 있어야 한다', () => {
    expect(buildAnswers(qs, new Map([[0, new Set(['회의'])]]), new Map())).toBeNull();
  });
  it('다중 선택은 선택지 순서대로 쉼표로 잇고, 기타 입력을 뒤에 붙인다', () => {
    const picked = new Map([[0, new Set(['데일리'])], [1, new Set(['b', 'a'])]]);
    expect(buildAnswers(qs, picked, new Map([[1, ' 직접 ']]))).toEqual({ '어느 폴더?': '데일리', '어떤 태그?': 'a, b, 직접' });
  });
  it('기타 입력만으로도 답이 된다', () => {
    expect(buildAnswers(qs, new Map(), new Map([[0, 'x'], [1, 'y']]))).toEqual({ '어느 폴더?': 'x', '어떤 태그?': 'y' });
  });
});

describe('extractPlan', () => {
  it('plan 문자열, 계획 파일 경로, 둘 다 없음', () => {
    expect(extractPlan({ plan: '# 계획\n- a' })).toBe('# 계획\n- a');
    expect(extractPlan({ planFilePath: '/home/u/.claude/plans/x.md' })).toBe('계획 파일: /home/u/.claude/plans/x.md');
    expect(extractPlan({})).toBe('(계획 본문 없음)');
  });
});
