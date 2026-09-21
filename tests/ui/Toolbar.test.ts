import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { EFFORT_LEVELS, effortOptions, modeOptions, nextMode } from '../../src/ui/Toolbar';

const models: ModelInfo[] = [
  { value: 'opus', displayName: 'Opus', description: '', resolvedModel: 'claude-opus-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', displayName: 'Haiku', description: '', supportsEffort: false },
  { value: 'sonnet', displayName: 'Sonnet', description: '', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high'] },
];

describe('nextMode', () => {
  it('기본 → 편집 자동 → 계획 → auto → 기본 순으로 돈다', () => {
    expect(nextMode('default')).toBe('acceptEdits');
    expect(nextMode('acceptEdits')).toBe('plan');
    expect(nextMode('plan')).toBe('auto');
    expect(nextMode('auto')).toBe('default');
  });
  it('모르는 모드·null은 기본부터', () => {
    expect(nextMode(null)).toBe('default');
    expect(nextMode('bypassPermissions')).toBe('default');
  });
});

describe('effortOptions', () => {
  it('모델이 지원하는 단계만, 모르면 전체', () => {
    expect(effortOptions(models, 'sonnet')).toEqual(['low', 'medium', 'high']);
    expect(effortOptions(models, 'claude-opus-5')).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
    expect(effortOptions(models, 'haiku')).toEqual([]);
    expect(effortOptions([], null)).toEqual(EFFORT_LEVELS);
  });
});

describe('modeOptions', () => {
  it('현재 모드를 모르면 "설정값" 항목을 앞에 둔다', () => {
    expect(modeOptions(null)[0]).toEqual({ value: '', label: '권한: 설정값' });
    expect(modeOptions('auto').map((o) => o.value)).toEqual(['default', 'acceptEdits', 'plan', 'auto']);
  });
  it('순환 목록에 없는 현재 모드도 표시한다', () => {
    expect(modeOptions('dontAsk').map((o) => o.value)).toContain('dontAsk');
  });
});
