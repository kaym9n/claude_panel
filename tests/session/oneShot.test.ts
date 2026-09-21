import { describe, expect, it } from 'vitest';
import { oneShot } from '../../src/session/oneShot';
import { fakeQueryFn } from '../helpers/fakeQuery';

const config = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' } };
const init = { type: 'system', subtype: 'init', model: 'claude-haiku-4-5', claude_code_version: '2.1.278', session_id: 's1' };

function scripted(messages: unknown[]) {
  const { fn, calls } = fakeQueryFn();
  const wrapped = ((params: Parameters<typeof fn>[0]) => {
    const q = fn(params);
    for (const m of messages) calls[calls.length - 1].emit(m);
    calls[calls.length - 1].end();
    return q;
  }) as typeof fn;
  return { fn: wrapped, calls };
}

describe('oneShot', () => {
  it('도구·설정·세션 기록 없이 호출하고 결과 텍스트를 돌려준다', async () => {
    const { fn, calls } = scripted([init, { type: 'result', subtype: 'success', is_error: false, result: '  pong \n' }]);
    const r = await oneShot(fn, config, 'Reply with exactly: pong', { model: 'haiku' });
    expect(r).toEqual({ text: 'pong', model: 'claude-haiku-4-5', cliVersion: '2.1.278' });
    const options = calls[0].params.options!;
    expect(calls[0].params.prompt).toBe('Reply with exactly: pong');
    expect(options).toMatchObject({
      cwd: '/vault', pathToClaudeCodeExecutable: '/bin/claude', env: { PATH: '/bin' },
      tools: [], persistSession: false, settingSources: [], maxTurns: 1, model: 'haiku',
    });
    expect(options.systemPrompt).toBeUndefined();
  });

  it('systemPrompt를 지정하면 그대로 넘긴다', async () => {
    const { fn, calls } = scripted([{ type: 'result', subtype: 'success', is_error: false, result: 'x' }]);
    await oneShot(fn, config, 'p', { systemPrompt: 'You rewrite.' });
    expect(calls[0].params.options!.systemPrompt).toBe('You rewrite.');
    expect(calls[0].params.options!.model).toBeUndefined();
  });

  it('오류 result면 예외를 던진다', async () => {
    const { fn } = scripted([{ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] }]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('boom');
  });

  it('성공 subtype이어도 is_error면 result 텍스트로 예외를 던진다', async () => {
    const { fn } = scripted([{ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached' }]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('usage limit');
  });

  it('result 없이 끝나면 예외', async () => {
    const { fn } = scripted([init]);
    await expect(oneShot(fn, config, 'p')).rejects.toThrow('결과 없이');
  });
});
