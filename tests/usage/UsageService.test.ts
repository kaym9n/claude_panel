import { describe, expect, it, vi } from 'vitest';
import { UsageService, USAGE_TTL } from '../../src/usage/UsageService';
import { UsageUnsupported } from '../../src/usage/readUsage';

const reply = { rate_limits_available: true, rate_limits: { limits: [{ kind: 'session', percent: 100 }] } };

describe('shared account usage state', () => {
  it('deduplicates concurrent panels, caches, and permits a manual refresh', async () => {
    let now = 1000;
    const read = vi.fn(async () => reply);
    const service = new UsageService(read, () => now);
    const a = vi.fn(), b = vi.fn();
    service.subscribe(a); service.subscribe(b);
    await Promise.all([service.refresh(), service.refresh(true)]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(service.state.status).toBe('ready');
    await service.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    now += USAGE_TTL;
    expect(service.isStale()).toBe(true);
    await service.refresh();
    await service.refresh(true);
    expect(read).toHaveBeenCalledTimes(3);
    expect(a).toHaveBeenCalledTimes(b.mock.calls.length);
  });
  it('retains last success on failure and backs off automatic retries', async () => {
    let now = 0;
    const read = vi.fn().mockResolvedValueOnce(reply).mockRejectedValue(new Error('offline'));
    const service = new UsageService(read, () => now);
    await service.refresh();
    now += USAGE_TTL;
    await service.refresh();
    expect(service.state).toMatchObject({ status: 'error', checkedAt: 0, error: 'offline' });
    expect(service.state.data?.rows[0].percent).toBe(100);
    await service.refresh();
    expect(read).toHaveBeenCalledTimes(2);
    now += USAGE_TTL;
    await service.refresh();
    now += USAGE_TTL;
    await service.refresh();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('distinguishes missing API and non-subscription accounts from failure', async () => {
    const a = new UsageService(async () => { throw new UsageUnsupported('unsupported'); });
    await a.refresh();
    expect(a.state.status).toBe('unsupported');
    const b = new UsageService(async () => ({ rate_limits_available: false }));
    await b.refresh();
    expect(b.state).toMatchObject({ status: 'unsupported', data: { available: false, rows: [] } });
  });
  it('marks a passed reset time stale instead of assuming a fresh zero', async () => {
    let now = 0;
    const s = new UsageService(async () => ({ rate_limits_available: true, rate_limits: { limits: [{ kind: 'session', percent: 100, resets_at: new Date(5000).toISOString() }] } }), () => now);
    await s.refresh(); now = 5001;
    expect(s.isStale()).toBe(true);
    expect(s.state.data?.rows[0].percent).toBe(100);
  });
  it('discards in-flight results after account settings change or unload', async () => {
    let resolve!: (v: unknown) => void;
    const s = new UsageService(() => new Promise(r => { resolve = r; }));
    const request = s.refresh(); await Promise.resolve();
    s.reset(); resolve(reply); await request;
    expect(s.state.status).toBe('idle');
    const request2 = s.refresh(); await Promise.resolve();
    const observer = vi.fn(); s.subscribe(observer); observer.mockClear();
    s.dispose(); resolve(reply); await request2;
    expect(observer).not.toHaveBeenCalled();
  });
  it('keeps rate-limit alerts separate from the last account snapshot', async () => {
    const s = new UsageService(async () => reply);
    await s.refresh();
    s.onRateLimit({ status: 'rejected', rateLimitType: 'seven_day', resetsAt: 2000 });
    expect(s.state.alert).toMatchObject({ status: 'rejected', label: '주간' });
    expect(s.state.data?.rows).toHaveLength(1);
    s.onRateLimit({ status: 'allowed' });
    expect(s.state.alert?.status).toBe('allowed');
  });
  it('does not erase a newer restriction with an already pending snapshot', async () => {
    let resolve!: (v: unknown) => void;
    const s = new UsageService(() => new Promise(r => { resolve = r; }));
    const pending = s.refresh(); await Promise.resolve();
    s.onRateLimit({ status: 'rejected', rateLimitType: 'five_hour' });
    resolve(reply); await pending;
    expect(s.state.alert?.status).toBe('rejected');
  });
});
