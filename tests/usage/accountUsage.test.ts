import { describe, expect, it } from 'vitest';
import { parseAccountUsage, parseLimitAlert, resetText } from '../../src/usage/accountUsage';

describe('account limit parsing', () => {
  it('preserves server order, scoped labels, active row and severity', () => {
    const data = parseAccountUsage({ rate_limits_available: true, rate_limits: { limits: [
      { kind: 'weekly_scoped', percent: 35, scope: { model: { display_name: 'Future model' } }, severity: 'warning', is_active: true, resets_at: '2026-09-27T00:00:00Z' },
      { kind: 'session', percent: 100, severity: 'critical' },
    ], extra_usage: { is_enabled: false } } });
    expect(data.rows[0]).toEqual({ label: '모델별 주간 · Future model', percent: 35, resetsAt: Date.parse('2026-09-27T00:00:00Z'), severity: 'warning', active: true });
    expect(data.rows[1].percent).toBe(100);
    expect(data.extraUsage).toBe(false);
  });
  it('does not interpret missing or invalid percentages as zero', () => {
    const data = parseAccountUsage({ rate_limits_available: true, rate_limits: { limits: [
      { kind: 'session', percent: null, resets_at: 'invalid' }, { kind: 'weekly_all', percent: 101 },
    ] } });
    expect(data.rows.map(r => r.percent)).toEqual([null, null]);
    expect(data.rows[0].resetsAt).toBeNull();
  });
  it('handles unavailable, empty, malformed and legacy replies separately', () => {
    expect(parseAccountUsage({ rate_limits_available: false }).available).toBe(false);
    expect(parseAccountUsage({ rate_limits_available: true, rate_limits: { limits: [], five_hour: { utilization: 99 } } }).rows).toEqual([]);
    expect(() => parseAccountUsage({ rate_limits_available: true, rate_limits: null })).toThrow();
    expect(() => parseAccountUsage({})).toThrow();
    const data = parseAccountUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 0 }, seven_day: { utilization: 35 } } });
    expect(data.rows.map(r => r.percent)).toEqual([0, 35]);
  });
  it('preserves alerts without guessing their utilization units', () => {
    expect(parseLimitAlert({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1234, utilization: 1 })).toEqual({ status: 'rejected', label: '5시간', resetsAt: 1234000 });
    expect(parseLimitAlert({ status: 'unknown' })).toBeNull();
    expect(resetText(1000, 2000)).toContain('재확인 필요');
    expect(resetText(null)).toContain('미제공');
  });
});
