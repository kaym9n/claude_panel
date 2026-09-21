import type { ApprovalRequest, BlockType, PanelEvent, TurnUsage } from '../types';

export type NoticeAction = 'reconnect' | 'find-claude' | 'open-settings';

export type ChatItem =
  | { id: string; type: 'user'; text: string; contextLabel: string | null }
  | { id: string; type: 'block'; blockType: BlockType; text: string; streaming: boolean; startedAt: number; endedAt: number | null }
  | { id: string; type: 'tool'; toolUseId: string; name: string; input: Record<string, unknown>; status: 'running' | 'done' | 'error' | 'cancelled'; output: string | null }
  | { id: string; type: 'approval'; request: ApprovalRequest; settled: string | null }
  | { id: string; type: 'notice'; level: 'info' | 'error'; text: string; action: NoticeAction | null }
  | { id: string; type: 'footer'; usage: TurnUsage; ok: boolean };

export type ItemOf<T extends ChatItem['type']> = Extract<ChatItem, { type: T }>;

/** CLI 오류 문구를 안내 문구로 바꾼다. 사용량 한도는 `…usage limit reached|<epoch초>` 형태로 온다. */
export function friendlyError(text: string): string {
  const limit = /usage limit reached\|(\d+)/i.exec(text);
  if (limit) return `사용량 한도에 도달했습니다. ${new Date(Number(limit[1]) * 1000).toLocaleString()}에 초기화됩니다.`;
  return text;
}

const ASSISTANT_ERRORS: Record<string, string> = {
  authentication_failed: '로그인이 필요합니다. 터미널에서 `claude`를 실행해 로그인한 뒤 다시 보내세요.',
  oauth_org_not_allowed: '이 계정의 조직에서 Claude Code 사용이 허용되지 않았습니다.',
  billing_error: '결제 정보에 문제가 있습니다.',
  rate_limit: '사용량 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
  overloaded: 'API가 과부하 상태입니다. 잠시 후 다시 시도하세요.',
  model_not_found: '선택한 모델을 찾을 수 없습니다.',
};

/** 패널 이벤트를 화면 항목 목록으로 접는다. DOM을 모른다. */
export class ChatState {
  readonly items: ChatItem[] = [];
  busy = false;
  private readonly byId = new Map<string, ChatItem>();
  private seq = 0;
  private turnNo = 0;
  private interrupted = false;

  constructor(private readonly now: () => number = Date.now) {}

  get(id: string): ChatItem | undefined {
    return this.byId.get(id);
  }

  clear(): void {
    this.items.length = 0;
    this.byId.clear();
    this.busy = false;
    this.interrupted = false;
  }

  /** ChatView가 직접 띄우는 알림 (예: 경로 자동 찾기 결과). */
  notice(level: 'info' | 'error', text: string, action: NoticeAction | null = null): string {
    return this.add({ id: this.nextId('n'), type: 'notice', level, text, action });
  }

  /** 이벤트를 반영하고 바뀌거나 추가된 항목 id를 돌려준다. */
  apply(e: PanelEvent): string[] {
    switch (e.kind) {
      case 'turn-start':
        this.busy = true;
        this.interrupted = false;
        this.turnNo += 1;
        return [this.add({ id: this.nextId('u'), type: 'user', text: e.text, contextLabel: e.contextLabel })];
      case 'user-text':
        return [this.add({ id: this.nextId('u'), type: 'user', text: e.text, contextLabel: null })];
      case 'block-start': {
        const id = `b:${e.key}`;
        if (this.byId.has(id)) return [];
        return [this.add({ id, type: 'block', blockType: e.blockType, text: '', streaming: true, startedAt: this.now(), endedAt: null })];
      }
      case 'block-delta': {
        const item = this.find('block', `b:${e.key}`);
        if (!item) return [];
        item.text += e.text;
        return [item.id];
      }
      case 'block-final': {
        const id = `b:${e.key}`;
        const item = this.find('block', id);
        if (item) {
          item.text = e.text;
          item.streaming = false;
          item.endedAt = this.now();
          return [id];
        }
        return [this.add({ id, type: 'block', blockType: e.blockType, text: e.text, streaming: false, startedAt: this.now(), endedAt: null })];
      }
      case 'tool-start': {
        const id = `t:${e.toolUseId}`;
        if (this.byId.has(id)) return [];
        return [this.add({ id, type: 'tool', toolUseId: e.toolUseId, name: e.name, input: e.input, status: 'running', output: null })];
      }
      case 'tool-result': {
        const item = this.find('tool', `t:${e.toolUseId}`);
        if (!item || item.status === 'cancelled') return [];
        item.status = e.isError ? 'error' : 'done';
        item.output = e.output;
        return [item.id];
      }
      case 'retry': {
        const id = `n:retry:${this.turnNo}`;
        const text = `재시도 중 (${e.attempt}/${e.maxRetries})…`;
        const item = this.find('notice', id);
        if (item) {
          item.text = text;
          return [id];
        }
        return [this.add({ id, type: 'notice', level: 'info', text, action: null })];
      }
      case 'assistant-error':
        return [this.notice('error', ASSISTANT_ERRORS[e.error] ?? `API 오류: ${e.error}`)];
      case 'approval-request':
        return [this.add({ id: `a:${e.request.id}`, type: 'approval', request: e.request, settled: null })];
      case 'approval-settled': {
        const item = this.find('approval', `a:${e.id}`);
        if (!item) return [];
        item.settled = e.summary;
        return [item.id];
      }
      case 'interrupted': {
        this.interrupted = true;
        const changed = this.stopActivity();
        changed.push(this.notice('info', '중단됨'));
        return changed;
      }
      case 'turn-end': {
        this.busy = false;
        const changed = this.stopActivity();
        if (!e.ok && !this.interrupted) {
          changed.push(this.notice('error', e.errors.length > 0 ? e.errors.map(friendlyError).join('\n') : `오류로 끝남 (${e.subtype})`));
        }
        changed.push(this.add({ id: this.nextId('f'), type: 'footer', usage: e.usage, ok: e.ok }));
        return changed;
      }
      case 'stream-error': {
        this.busy = false;
        const changed = this.stopActivity();
        changed.push(this.notice('error', e.message, e.code === 'ENOENT' ? 'find-claude' : 'reconnect'));
        return changed;
      }
      default:
        return []; // init, mode-changed, context-usage는 ChatView가 상단 막대에 반영
    }
  }

  /** 진행 중이던 블록·도구·승인을 멈춘 상태로 바꾼다. */
  private stopActivity(): string[] {
    const changed: string[] = [];
    for (const item of this.items) {
      if (item.type === 'block' && item.streaming) {
        item.streaming = false;
        item.endedAt = this.now();
        changed.push(item.id);
      } else if (item.type === 'tool' && item.status === 'running') {
        item.status = 'cancelled';
        changed.push(item.id);
      } else if (item.type === 'approval' && item.settled === null) {
        item.settled = '취소됨';
        changed.push(item.id);
      }
    }
    return changed;
  }

  private add(item: ChatItem): string {
    this.items.push(item);
    this.byId.set(item.id, item);
    return item.id;
  }

  private find<T extends ChatItem['type']>(type: T, id: string): ItemOf<T> | undefined {
    const item = this.byId.get(id);
    return item && item.type === type ? (item as ItemOf<T>) : undefined;
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}:${this.seq}`;
  }
}
