import type { SDKSessionInfo, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ThreadService, cleanTitle, fallbackTitle, titlePrompt, toThread, type SessionApi } from '../../src/threads/ThreadService';

const sessions: SDKSessionInfo[] = [
  { sessionId: 'aaaaaaaa-1', summary: 'A 요약', lastModified: 1 },
  { sessionId: 'bbbbbbbb-2', summary: 'B', customTitle: '서버실 정리', lastModified: 3 },
  { sessionId: 'cccccccc-3', summary: '', firstPrompt: '첫 질문', lastModified: 2 },
];
const messages: SessionMessage[] = [
  { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'user', content: '<context>\n현재 노트: a.md\n</context>\n\n요약해 줘' } },
  { type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: '요약입니다' }] } },
];

function makeApi(overrides: Partial<SessionApi> = {}): SessionApi {
  return {
    listSessions: vi.fn(async () => sessions),
    getSessionMessages: vi.fn(async () => messages),
    getSessionInfo: vi.fn(async (id: string) => ({ sessionId: id, summary: '', lastModified: 1 }) as SDKSessionInfo),
    forkSession: vi.fn(async () => ({ sessionId: 'forked-1' })),
    renameSession: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('ThreadService', () => {
  it('vault 경로의 세션을 최근 순으로, 제목은 사용자 제목 > 요약 > 첫 프롬프트', async () => {
    const api = makeApi();
    const threads = await new ThreadService(api, () => '/vault', async () => '').list();
    expect(api.listSessions).toHaveBeenCalledWith({ dir: '/vault', includeWorktrees: false });
    expect(threads).toEqual([
      { id: 'bbbbbbbb-2', title: '서버실 정리', lastModified: 3 },
      { id: 'cccccccc-3', title: '첫 질문', lastModified: 2 },
      { id: 'aaaaaaaa-1', title: 'A 요약', lastModified: 1 },
    ]);
  });

  it('과거 대화를 history 모드로 정규화한다', async () => {
    const api = makeApi();
    const events = await new ThreadService(api, () => '/vault', async () => '').history('s');
    expect(api.getSessionMessages).toHaveBeenCalledWith('s', { dir: '/vault' });
    expect(events).toEqual([
      { kind: 'user-text', text: '요약해 줘' },
      { kind: 'block-final', key: 'm1#0', blockType: 'text', text: '요약입니다' },
    ]);
  });

  it('fork·rename은 vault 경로를 넘긴다', async () => {
    const api = makeApi();
    const svc = new ThreadService(api, () => '/vault', async () => '');
    expect(await svc.fork('s')).toBe('forked-1');
    expect(api.forkSession).toHaveBeenCalledWith('s', { dir: '/vault' });
    await svc.rename('s', '새 이름');
    expect(api.renameSession).toHaveBeenCalledWith('s', '새 이름', { dir: '/vault' });
  });

  it('autoTitle은 생성한 제목을 정리해 저장한다', async () => {
    const api = makeApi();
    const generate = vi.fn(async () => '"B1 서버실 구상 정리."\n설명');
    const title = await new ThreadService(api, () => '/vault', generate).autoTitle('s', '서버실 구상 노트를 정리해 줘');
    expect(generate).toHaveBeenCalledWith('서버실 구상 노트를 정리해 줘');
    expect(title).toBe('B1 서버실 구상 정리');
    expect(api.renameSession).toHaveBeenCalledWith('s', 'B1 서버실 구상 정리', { dir: '/vault' });
  });

  it('이미 사용자 제목이 있으면 생성하지 않는다', async () => {
    const api = makeApi({ getSessionInfo: vi.fn(async () => ({ sessionId: 's', summary: '', customTitle: '내 제목', lastModified: 1 })) });
    const generate = vi.fn(async () => 'x');
    expect(await new ThreadService(api, () => '/vault', generate).autoTitle('s', 'q')).toBe('내 제목');
    expect(generate).not.toHaveBeenCalled();
    expect(api.renameSession).not.toHaveBeenCalled();
  });

  it('생성이 실패하거나 비면 첫 메시지 앞부분을 제목으로 쓴다', async () => {
    const api = makeApi();
    const long = '이 문장은 서른 글자를 넘기기 위해서 일부러 길게 쓴 첫 번째 메시지입니다';
    const t1 = await new ThreadService(api, () => '/vault', async () => { throw new Error('limit'); }).autoTitle('s', long);
    expect(t1).toBe(`${long.slice(0, 30)}…`);
    const t2 = await new ThreadService(api, () => '/vault', async () => '  ').autoTitle('s', '짧은 질문');
    expect(t2).toBe('짧은 질문');
  });
});

describe('제목 보조 함수', () => {
  it('cleanTitle은 첫 줄만, 따옴표·#·끝 마침표를 떼고 60자로 자른다', () => {
    expect(cleanTitle('# "제목입니다."\n둘째 줄')).toBe('제목입니다');
    expect(cleanTitle('x'.repeat(100))).toHaveLength(60);
  });
  it('fallbackTitle·toThread·titlePrompt', () => {
    expect(fallbackTitle('   ')).toBe('새 대화');
    expect(toThread({ sessionId: 'dddddddd-4', summary: '', lastModified: 9 })).toEqual({ id: 'dddddddd-4', title: 'dddddddd', lastModified: 9 });
    expect(titlePrompt('hello')).toContain('<message>\nhello\n</message>');
  });
});
