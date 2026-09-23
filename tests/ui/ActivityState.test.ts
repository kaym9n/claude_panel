import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/ui/ActivityState';
import type { PanelEvent } from '../../src/types';

const start: PanelEvent = { kind: 'turn-start', text: 'hello', contextLabel: null };
const end = (ok = true): PanelEvent => ({ kind: 'turn-end', ok, subtype: 'success', errors: [], usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 0 } });
const approval = (id: string): PanelEvent => ({ kind: 'approval-request', request: { id, toolName: 'Read', input: {}, title: null, reason: null, suggestions: [], canAlwaysAllow: false } });

describe('activity status', () => {
  it('tracks connecting, thinking, writing and completion without usage events replacing status', () => {
    const s = new ActivityState();
    expect(s.apply(start)).toContain('연결');
    expect(s.apply({ kind: 'block-start', key: 'a', blockType: 'thinking' })).toBe('생각 중…');
    expect(s.apply({ kind: 'block-delta', key: 'a', text: 'x' })).toBe('생각 중…');
    expect(s.apply({ kind: 'context-usage', percentage: 50 })).toBe('생각 중…');
    expect(s.apply({ kind: 'block-start', key: 'b', blockType: 'text' })).toBe('답변 작성 중…');
    expect(s.apply(end())).toBe('완료');
    expect(s.apply({ kind: 'rate-limit', info: {} })).toBe('완료');
  });
  it('keeps approval waiting visible when parallel tools or tokens arrive', () => {
    const s = new ActivityState(); s.apply(start);
    s.apply({ kind: 'tool-start', toolUseId: 'a', name: 'Read', input: {} });
    s.apply({ kind: 'tool-start', toolUseId: 'b', name: 'Bash', input: {} });
    s.apply(approval('x')); s.apply(approval('y'));
    expect(s.apply({ kind: 'block-delta', key: 'z', text: 'x' })).toBe('승인 대기 · 2건');
    s.apply({ kind: 'approval-settled', id: 'x', summary: 'allow' });
    expect(s.apply({ kind: 'tool-result', toolUseId: 'a', isError: false, output: '' })).toContain('승인 대기');
    expect(s.apply({ kind: 'approval-settled', id: 'y', summary: 'allow' })).toBe('도구 실행 중 · Bash');
  });
  it('shows retry, compaction, interruption and failure; resets for a new conversation', () => {
    const s = new ActivityState(); s.apply(start);
    expect(s.apply({ kind: 'retry', attempt: 2, maxRetries: 3 })).toContain('2/3');
    expect(s.apply({ kind: 'compacting', active: true })).toContain('압축');
    expect(s.apply({ kind: 'interrupted' })).toContain('중단 처리');
    expect(s.apply(end(false))).toBe('중단됨');
    s.reset(); s.apply(start);
    expect(s.apply({ kind: 'stream-error', message: 'offline', code: null })).toContain('연결 오류');
    expect(s.reset('이전 대화 복원됨')).toBe('이전 대화 복원됨');
  });
});
