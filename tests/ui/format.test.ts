import { describe, expect, it } from 'vitest';
import { formatRelativeTime, formatSeconds, formatTokens, formatUsage } from '../../src/ui/format';

describe('format', () => {
  it('formatTokens', () => {
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12345)).toBe('12.3k');
  });
  it('formatSeconds는 최소 1초', () => {
    expect(formatSeconds(400)).toBe('1초');
    expect(formatSeconds(8200)).toBe('8초');
  });
  it('formatUsage는 캐시 포함 입력·출력 토큰과 시간을 보여 준다', () => {
    expect(formatUsage({ inputTokens: 100, cacheReadTokens: 12000, cacheCreationTokens: 200, outputTokens: 450, costUsd: 0, durationMs: 3100 }))
      .toBe('입력 12.3k · 출력 450 tok · 3초');
  });
  it('formatRelativeTime', () => {
    const now = 1_000_000_000_000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('방금');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5분 전');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3시간 전');
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2일 전');
  });
});
