import { describe, expect, it } from 'vitest';
import { activitySummary } from '../../src/ui/activitySummary';
import type { ChatItem } from '../../src/chat/ChatState';

describe('activity group summary', () => {
  it('does not call failed or cancelled operations completed', () => {
    const items = ['done', 'error', 'cancelled'].map((status, i) => ({ id: String(i), type: 'tool', toolUseId: String(i), name: 'Read', input: {}, output: null, status })) as ChatItem[];
    expect(activitySummary(items)).toContain('1개 실패');
    expect(activitySummary(items)).toContain('1개 중단');
    expect(activitySummary(items)).not.toContain('완료');
  });
});
