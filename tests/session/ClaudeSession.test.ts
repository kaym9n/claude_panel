import { describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../src/session/buildOptions';
import { ClaudeSession, errorCode } from '../../src/session/ClaudeSession';
import type { PanelEvent } from '../../src/types';
import { fakeQueryFn, tick } from '../helpers/fakeQuery';

const config: SessionConfig = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' }, useHooks: true, defaultModel: '' };
const init = (mode = 'auto') => ({ type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5', permissionMode: mode, slash_commands: [], claude_code_version: '2.1.278' });
const result = { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: {}, total_cost_usd: 0, duration_ms: 10 };
const msg = (prompt: string) => ({ prompt, display: prompt, contextLabel: null });

function setup(cfg: SessionConfig = config) {
  const { fn, calls } = fakeQueryFn();
  const session = new ClaudeSession({ query: fn, getConfig: () => cfg });
  const events: PanelEvent[] = [];
  session.on((e) => events.push(e));
  return { session, calls, events };
}

describe('ClaudeSession', () => {
  it('첫 전송 때 query를 시작하고 사용자 메시지를 입력 큐로 보낸다', async () => {
    const { session, calls, events } = setup();
    expect(calls).toHaveLength(0);
    session.send(msg('안녕'));
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].params.options).toMatchObject({ cwd: '/vault', includePartialMessages: true });
    expect(calls[0].sent).toEqual([{ type: 'user', message: { role: 'user', content: '안녕' }, parent_tool_use_id: null }]);
    expect(events[0]).toEqual({ kind: 'turn-start', text: '안녕', contextLabel: null });
    expect(session.isBusy).toBe(true);
  });

  it('스트림 이벤트를 전달하고 init·turn-end로 상태를 갱신하며 컨텍스트 사용률을 알린다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init('auto'));
    calls[0].emit(result);
    await tick();
    await tick();
    expect(session.sessionId).toBe('sess-1');
    expect(session.permissionMode).toBe('auto');
    expect(session.isBusy).toBe(false);
    expect(events.map((e) => e.kind)).toEqual(['turn-start', 'init', 'turn-end', 'context-usage']);
    expect(events[3]).toEqual({ kind: 'context-usage', percentage: 42 });
  });

  it('시작 전에 바꾼 모델·추론 강도·권한 모드를 시작 옵션에 담는다', async () => {
    const { session, calls } = setup();
    await session.setModel('sonnet');
    await session.setEffort('low');
    await session.setPermissionMode('plan');
    session.send(msg('x'));
    expect(calls[0].params.options).toMatchObject({ model: 'sonnet', effort: 'low', permissionMode: 'plan' });
  });

  it('시작 후 변경은 Query 제어 메서드로 즉시 보낸다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    await session.setModel('haiku');
    await session.setEffort('max');
    await session.setPermissionMode('acceptEdits');
    expect(calls[0].setModel).toHaveBeenCalledWith('haiku');
    expect(calls[0].applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'max' });
    expect(calls[0].setPermissionMode).toHaveBeenCalledWith('acceptEdits');
    expect(events).toContainEqual({ kind: 'mode-changed', permissionMode: 'acceptEdits' });
  });

  it('중단하면 interrupted를 알리고 대기 승인을 거부한 뒤 interrupt를 호출한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    const approval = session.broker.handle('Bash', {}, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' } as never);
    await session.interrupt();
    expect(events).toContainEqual({ kind: 'interrupted' });
    expect(await approval).toMatchObject({ behavior: 'deny', interrupt: true });
    expect(calls[0].interrupt).toHaveBeenCalledOnce();
  });

  it('대기 중이 아니면 interrupt는 아무것도 하지 않는다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(result);
    await tick();
    await session.interrupt();
    expect(calls[0].interrupt).not.toHaveBeenCalled();
  });

  it('스트림 예외 시 stream-error를 알리고, 다음 전송은 마지막 세션을 resume한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    await tick();
    calls[0].fail(new Error('process exited'));
    await tick();
    expect(events[events.length - 1]).toEqual({ kind: 'stream-error', message: 'process exited', code: null });
    expect(session.isStarted).toBe(false);
    session.send(msg('again'));
    expect(calls).toHaveLength(2);
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('대기 중이 아닐 때 프로세스가 끝나면 조용히 분리하고 다음 전송에서 resume한다', async () => {
    const { session, calls, events } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    calls[0].emit(result);
    await tick();
    calls[0].end();
    await tick();
    expect(events.some((e) => e.kind === 'stream-error')).toBe(false);
    session.send(msg('y'));
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('reconnect는 전송 없이 resume으로 새 프로세스를 띄운다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(init());
    await tick();
    calls[0].fail(new Error('boom'));
    await tick();
    session.reconnect();
    expect(calls).toHaveLength(2);
    expect(calls[1].params.options?.resume).toBe('sess-1');
  });

  it('query가 동기적으로 던지면 stream-error로 알리고 멈춘다', () => {
    const session = new ClaudeSession({
      query: (() => { throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }); }) as never,
      getConfig: () => config,
    });
    const events: PanelEvent[] = [];
    session.on((e) => events.push(e));
    session.send(msg('x'));
    expect(events[events.length - 1]).toEqual({ kind: 'stream-error', message: 'spawn claude ENOENT', code: 'ENOENT' });
    expect(session.isBusy).toBe(false);
  });

  it('resumeFrom은 시작 옵션의 resume으로 전달된다', () => {
    const { session, calls } = setup();
    session.resumeFrom('old-1');
    expect(session.sessionId).toBe('old-1');
    session.send(msg('x'));
    expect(calls[0].params.options?.resume).toBe('old-1');
  });

  it('Plan 승인 뒤 계획 모드 이전의 권한 모드로 되돌린다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    calls[0].emit(init('auto'));
    await tick();
    await session.setPermissionMode('plan');
    const p = session.broker.handle('ExitPlanMode', { plan: 'p' }, { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' } as never);
    session.broker.decide('apr-1', { type: 'plan-approve' });
    await p;
    await tick();
    expect(calls[0].setPermissionMode).toHaveBeenLastCalledWith('auto');
    expect(session.permissionMode).toBe('auto');
  });

  it('close는 프로세스를 닫고 이후 전송을 막는다', async () => {
    const { session, calls } = setup();
    session.send(msg('x'));
    session.close();
    expect(calls[0].close).toHaveBeenCalledOnce();
    expect(() => session.send(msg('y'))).toThrow();
  });

  it('ensureStarted 후 supportedCommands를 조회할 수 있다', async () => {
    const { session, calls } = setup();
    expect(await session.supportedCommands()).toEqual([]);
    session.ensureStarted();
    expect(calls).toHaveLength(1);
    expect((await session.supportedCommands())[0].name).toBe('ingest');
  });
});

describe('errorCode', () => {
  it('code 속성이나 메시지로 ENOENT를 식별한다', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
    expect(errorCode(new Error('Claude Code executable not found at /x'))).toBe('ENOENT');
    expect(errorCode(new Error('other'))).toBeNull();
  });
});
