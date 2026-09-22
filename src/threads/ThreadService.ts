import type {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  SDKSessionInfo,
  SessionMessage,
  SessionMutationOptions,
} from '@anthropic-ai/claude-agent-sdk';
import { Normalizer } from '../session/normalize';
import type { PanelEvent } from '../types';

/** SDK 세션 함수들 (테스트에서 주입) */
export interface SessionApi {
  listSessions(options?: ListSessionsOptions): Promise<SDKSessionInfo[]>;
  getSessionMessages(id: string, options?: GetSessionMessagesOptions): Promise<SessionMessage[]>;
  getSessionInfo(id: string, options?: GetSessionInfoOptions): Promise<SDKSessionInfo | undefined>;
  forkSession(id: string, options?: ForkSessionOptions): Promise<ForkSessionResult>;
  renameSession(id: string, title: string, options?: SessionMutationOptions): Promise<void>;
}

export interface ThreadInfo {
  id: string;
  title: string;
  lastModified: number;
}

export type TitleGenerator = (firstMessage: string) => Promise<string>;

export function toThread(s: SDKSessionInfo): ThreadInfo {
  return { id: s.sessionId, title: s.customTitle || s.summary || s.firstPrompt || s.sessionId.slice(0, 8), lastModified: s.lastModified };
}

export function cleanTitle(raw: string): string {
  const first = raw.trim().split('\n')[0] ?? '';
  return first.replace(/^[\s#"'“”‘’`]+/, '').replace(/[\s"'“”‘’`.]+$/, '').slice(0, 60);
}

export function fallbackTitle(firstMessage: string): string {
  const s = firstMessage.replace(/\s+/g, ' ').trim();
  if (!s) return '새 대화';
  return s.length > 30 ? `${s.slice(0, 30)}…` : s;
}

export function titlePrompt(firstMessage: string): string {
  return [
    'Write a short title (at most 6 words) for a conversation that starts with the message below.',
    "Use the same language as the message. Reply with the title only.",
    '',
    '<message>',
    firstMessage.slice(0, 1000),
    '</message>',
  ].join('\n');
}

/** 스레드 목록·과거 대화·fork·이름 변경·제목 생성. 터미널에서 시작한 같은 vault 경로의 세션도 포함된다. */
export class ThreadService {
  constructor(
    private readonly api: SessionApi,
    private readonly dir: () => string,
    private readonly generate: TitleGenerator,
  ) {}

  async list(): Promise<ThreadInfo[]> {
    const sessions = await this.api.listSessions({ dir: this.dir(), includeWorktrees: false });
    return sessions.map(toThread).sort((a, b) => b.lastModified - a.lastModified);
  }

  async history(id: string): Promise<PanelEvent[]> {
    const messages = await this.api.getSessionMessages(id, { dir: this.dir() });
    const normalizer = new Normalizer({ history: true });
    return messages.flatMap((m) => normalizer.push(m));
  }

  async fork(id: string): Promise<string> {
    return (await this.api.forkSession(id, { dir: this.dir() })).sessionId;
  }

  async rename(id: string, title: string): Promise<void> {
    await this.api.renameSession(id, title, { dir: this.dir() });
  }

  /** 첫 턴이 끝난 새 세션에 제목을 붙이고 그 제목을 돌려준다. 사용자가 이미 이름을 붙였으면 그대로 둔다. */
  async autoTitle(id: string, firstMessage: string): Promise<string> {
    const info = await this.api.getSessionInfo(id, { dir: this.dir() });
    if (info?.customTitle) return info.customTitle;
    let title = '';
    try {
      title = cleanTitle(await this.generate(firstMessage));
    } catch {
      title = '';
    }
    if (!title) title = fallbackTitle(firstMessage);
    await this.api.renameSession(id, title, { dir: this.dir() });
    return title;
  }
}
