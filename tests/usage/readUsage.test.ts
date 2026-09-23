import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from '../../src/session/oneShot';
import { readUsage, readUsageStandalone, UsageUnsupported } from '../../src/usage/readUsage';

afterEach(() => vi.useRealTimers());
const method = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';
describe('usage SDK boundary', () => {
  it('detects unsupported methods without issuing a prompt', async () => {
    await expect(readUsage({} as Query, new AbortController().signal)).rejects.toBeInstanceOf(UsageUnsupported);
  });
  it('opens only the control channel and closes the process after success', async () => {
    const close = vi.fn(); const call = vi.fn(async () => ({ rate_limits_available: false }));
    const query = vi.fn(() => ({ [method]: call, close }));
    await readUsageStandalone(query as unknown as QueryFn, { cwd: '/vault', claudePath: '/bin/claude', env: {} }, new AbortController().signal);
    const args = (query.mock.calls as unknown as [{ prompt: { isEnded: boolean }; options: unknown }[]])[0][0];
    expect(typeof args.prompt).toBe('object');
    expect(args.prompt.isEnded).toBe(true);
    expect(args.options).toMatchObject({ tools: [], settingSources: [], settings: { disableAllHooks: true }, persistSession: false });
    expect(call).toHaveBeenCalledWith({ skipBehaviors: true });
    expect(close).toHaveBeenCalledOnce();
  });
  it('times out stalled requests and cleans up the standalone process', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const query = (() => ({ [method]: () => new Promise(() => {}), close })) as unknown as QueryFn;
    const pending = readUsageStandalone(query, { cwd: '/vault', claudePath: '/bin/claude', env: {} }, new AbortController().signal);
    const assertion = expect(pending).rejects.toThrow('시간이 초과');
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(close).toHaveBeenCalledOnce();
  });
  it('cancels a pending control request without waiting for the timeout', async () => {
    const controller = new AbortController();
    const q = { [method]: () => new Promise(() => {}) } as unknown as Query;
    const pending = readUsage(q, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow('취소');
  });
});
