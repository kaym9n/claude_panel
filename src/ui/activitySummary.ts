import type { ChatItem } from '../chat/ChatState';

export function activitySummary(items: ChatItem[]): string {
  const tools = items.filter((i): i is Extract<ChatItem, { type: 'tool' }> => i.type === 'tool');
  const thoughts = items.filter(i => i.type === 'block' && i.blockType === 'thinking');
  const running = tools.filter(t => t.status === 'running').length;
  const failed = tools.filter(t => t.status === 'error').length;
  const cancelled = tools.filter(t => t.status === 'cancelled').length;
  const parts = [`작업 ${tools.length}개`, `생각 ${thoughts.length}개`];
  if (running) parts.push(`${running}개 실행 중`);
  else if (tools.length && !failed && !cancelled) parts.push('완료');
  if (failed) parts.push(`${failed}개 실패`);
  if (cancelled) parts.push(`${cancelled}개 중단`);
  if (thoughts.some(i => i.type === 'block' && i.streaming)) parts.push('생각 중');
  return parts.join(' · ');
}
