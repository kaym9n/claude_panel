import type { TurnUsage } from '../types';

export function formatTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

export function formatSeconds(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}초`;
}

export function formatUsage(u: TurnUsage): string {
  const input = u.inputTokens + u.cacheReadTokens + u.cacheCreationTokens;
  return `입력 ${formatTokens(input)} · 출력 ${formatTokens(u.outputTokens)} tok · ${formatSeconds(u.durationMs)}`;
}

export function formatRelativeTime(ms: number, now: number): string {
  const minutes = Math.floor((now - ms) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}
