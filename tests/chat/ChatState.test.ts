import { describe, expect, it } from 'vitest';
import { ChatState, friendlyError, type ChatItem } from '../../src/chat/ChatState';
import type { ApprovalRequest, TurnUsage } from '../../src/types';

const usage: TurnUsage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0, durationMs: 1000 };
const request: ApprovalRequest = { id: 'apr-1', toolName: 'Write', input: {}, title: null, reason: null, suggestions: [], canAlwaysAllow: false };

function make() {
  let t = 1000;
  const state = new ChatState(() => t);
  return { state, advance: (ms: number) => { t += ms; } };
}
const find = (state: ChatState, id: string) => state.get(id) as ChatItem;

describe('ChatState', () => {
  it('turn-start는 사용자 항목을 추가하고 busy가 된다', () => {
    const { state } = make();
    const ids = state.apply({ kind: 'turn-start', text: '안녕', contextLabel: '📄 a' });
    expect(state.busy).toBe(true);
    expect(find(state, ids[0])).toMatchObject({ type: 'user', text: '안녕', contextLabel: '📄 a' });
  });

  it('블록 start → delta → final을 한 항목에 접고 경과 시간을 기록한다', () => {
    const { state, advance } = make();
    state.apply({ kind: 'block-start', key: 'm#0', blockType: 'thinking' });
    state.apply({ kind: 'block-delta', key: 'm#0', text: 'a' });
    expect(state.apply({ kind: 'block-delta', key: 'm#0', text: 'b' })).toEqual(['b:m#0']);
    expect(find(state, 'b:m#0')).toMatchObject({ text: 'ab', streaming: true, endedAt: null });
    advance(8000);
    state.apply({ kind: 'block-final', key: 'm#0', blockType: 'thinking', text: 'abc' });
    expect(find(state, 'b:m#0')).toMatchObject({ text: 'abc', streaming: false, startedAt: 1000, endedAt: 9000 });
    expect(state.items).toHaveLength(1);
  });

  it('start 없이 온 final은 완성된 블록으로 추가한다 (과거 대화)', () => {
    const { state } = make();
    state.apply({ kind: 'block-final', key: 'h#0', blockType: 'text', text: 'hi' });
    expect(find(state, 'b:h#0')).toMatchObject({ type: 'block', text: 'hi', streaming: false, endedAt: null });
  });

  it('도구 시작과 결과를 짝짓는다', () => {
    const { state } = make();
    state.apply({ kind: 'tool-start', toolUseId: 'tu1', name: 'Read', input: { file_path: '/v/a.md' } });
    state.apply({ kind: 'tool-result', toolUseId: 'tu1', isError: false, output: 'body' });
    expect(find(state, 't:tu1')).toMatchObject({ status: 'done', output: 'body' });
    state.apply({ kind: 'tool-start', toolUseId: 'tu2', name: 'Bash', input: {} });
    state.apply({ kind: 'tool-result', toolUseId: 'tu2', isError: true, output: 'fail' });
    expect(find(state, 't:tu2')).toMatchObject({ status: 'error' });
  });

  it('중단하면 진행 중 도구·블록·승인을 멈추고, 이후 도착한 tool_result는 무시한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'block-start', key: 'm#0', blockType: 'text' });
    state.apply({ kind: 'tool-start', toolUseId: 'tu1', name: 'Bash', input: {} });
    state.apply({ kind: 'approval-request', request });
    state.apply({ kind: 'interrupted' });
    expect(find(state, 'b:m#0')).toMatchObject({ streaming: false });
    expect(find(state, 't:tu1')).toMatchObject({ status: 'cancelled' });
    expect(find(state, 'a:apr-1')).toMatchObject({ settled: '취소됨' });
    expect(state.apply({ kind: 'tool-result', toolUseId: 'tu1', isError: false, output: 'late' })).toEqual([]);
    expect(state.items.some((i) => i.type === 'notice' && i.text === '중단됨')).toBe(true);
  });

  it('중단 뒤의 오류 turn-end는 오류 알림 없이 사용량만 남긴다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'interrupted' });
    state.apply({ kind: 'turn-end', ok: false, subtype: 'error_during_execution', errors: ['aborted'], usage });
    expect(state.busy).toBe(false);
    expect(state.items.filter((i) => i.type === 'notice' && i.level === 'error')).toHaveLength(0);
    expect(state.items[state.items.length - 1]).toMatchObject({ type: 'footer', ok: false });
  });

  it('실패한 turn-end는 오류 알림을 추가한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'turn-end', ok: false, subtype: 'success', errors: ['Claude AI usage limit reached'], usage });
    expect(state.items.find((i) => i.type === 'notice')).toMatchObject({ level: 'error', text: 'Claude AI usage limit reached' });
  });

  it('사용량 한도 오류에는 리셋 시각을 붙인다', () => {
    const text = friendlyError('Claude AI usage limit reached|1760000000');
    expect(text).toContain('사용량 한도에 도달했습니다.');
    expect(text).toContain(new Date(1760000000 * 1000).toLocaleString());
    expect(friendlyError('other')).toBe('other');
  });

  it('retry는 같은 턴 안에서 한 알림을 갱신한다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    state.apply({ kind: 'retry', attempt: 1, maxRetries: 10 });
    state.apply({ kind: 'retry', attempt: 2, maxRetries: 10 });
    const notices = state.items.filter((i) => i.type === 'notice');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ text: '재시도 중 (2/10)…' });
  });

  it('stream-error는 busy를 풀고 코드에 맞는 조치를 붙인다', () => {
    const { state } = make();
    state.apply({ kind: 'turn-start', text: 'x', contextLabel: null });
    const ids = state.apply({ kind: 'stream-error', message: 'spawn claude ENOENT', code: 'ENOENT' });
    expect(state.busy).toBe(false);
    expect(find(state, ids[ids.length - 1])).toMatchObject({ type: 'notice', level: 'error', action: 'find-claude' });
    const ids2 = state.apply({ kind: 'stream-error', message: 'died', code: null });
    expect(find(state, ids2[ids2.length - 1])).toMatchObject({ action: 'reconnect' });
  });

  it('assistant-error는 알려진 오류를 안내 문구로 바꾼다', () => {
    const { state } = make();
    const [id] = state.apply({ kind: 'assistant-error', error: 'authentication_failed' });
    expect((find(state, id) as { text: string }).text).toContain('로그인');
    const [id2] = state.apply({ kind: 'assistant-error', error: 'weird' });
    expect((find(state, id2) as { text: string }).text).toBe('API 오류: weird');
  });

  it('승인 요청과 결정 요약', () => {
    const { state } = make();
    state.apply({ kind: 'approval-request', request });
    expect(state.apply({ kind: 'approval-settled', id: 'apr-1', summary: '허용함' })).toEqual(['a:apr-1']);
    expect(find(state, 'a:apr-1')).toMatchObject({ settled: '허용함' });
  });

  it('상단 막대용 이벤트는 항목을 만들지 않고, clear는 모두 비운다', () => {
    const { state } = make();
    expect(state.apply({ kind: 'context-usage', percentage: 30 })).toEqual([]);
    state.apply({ kind: 'user-text', text: 'old' });
    state.notice('info', 'hello');
    state.clear();
    expect(state.items).toHaveLength(0);
    expect(state.get('u:1')).toBeUndefined();
  });
});
