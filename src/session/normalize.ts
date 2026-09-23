import type { BlockType, PanelEvent, TurnUsage } from '../types';

// SDK 메시지는 버전마다 필드가 늘어나므로 필요한 필드만 느슨하게 읽는다.
type Loose = Record<string, any>;

const CONTEXT_RE = /<context>[\s\S]*?<\/context>\s*/g;
const COMMAND_NAME_RE = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([^<]*)<\/command-args>/;

export interface NormalizerOptions {
  /** true면 getSessionMessages로 불러온 과거 대화: 사용자 텍스트도 이벤트로 만든다. */
  history: boolean;
}

/**
 * SDK 메시지 → 패널 이벤트.
 * 실시간 스트림에서 CLI는 content block 하나마다 assistant 메시지를 하나씩 보내고,
 * 같은 message.id 안에서 도착 순서가 stream_event의 index와 같다. 이 순서로 블록 키를 맞춘다.
 */
export class Normalizer {
  private readonly blockCount = new Map<string, number>();
  private streamMessageId: string | null = null;

  constructor(private readonly options: NormalizerOptions = { history: false }) {}

  push(raw: unknown): PanelEvent[] {
    if (!raw || typeof raw !== 'object') return [];
    const msg = raw as Loose;
    if (msg.parent_tool_use_id) return []; // 서브에이전트 내부 흐름은 1차 버전에서 표시하지 않음
    switch (msg.type) {
      case 'rate_limit_event':
        return this.options.history || !msg.rate_limit_info ? [] : [{ kind: 'rate-limit', info: msg.rate_limit_info }];
      case 'system':
        return this.system(msg);
      case 'stream_event':
        return this.stream(msg.event ?? {});
      case 'assistant':
        return this.assistant(msg);
      case 'user':
        return this.user(msg);
      case 'result':
        return [resultEvent(msg)];
      default:
        console.debug('[claude-panel] 표시하지 않는 SDK 메시지', msg.type);
        return [];
    }
  }

  private system(msg: Loose): PanelEvent[] {
    switch (msg.subtype) {
      case 'init':
        return [{
          kind: 'init',
          sessionId: String(msg.session_id ?? ''),
          model: String(msg.model ?? ''),
          permissionMode: String(msg.permissionMode ?? 'default'),
          slashCommands: Array.isArray(msg.slash_commands) ? msg.slash_commands.map(String) : [],
          cliVersion: String(msg.claude_code_version ?? ''),
          effort: typeof msg.effort === 'string' ? msg.effort : null,
        }];
      case 'api_retry':
        return [{ kind: 'retry', attempt: Number(msg.attempt ?? 0), maxRetries: Number(msg.max_retries ?? 0) }];
      case 'status': {
        const out: PanelEvent[] = [];
        if (typeof msg.permissionMode === 'string') out.push({ kind: 'mode-changed', permissionMode: msg.permissionMode });
        if (msg.status === null || msg.status === 'compacting') out.push({ kind: 'compacting', active: msg.status === 'compacting' });
        return out;
      }
      default:
        return [];
    }
  }

  private stream(event: Loose): PanelEvent[] {
    if (event.type === 'message_start') {
      this.streamMessageId = typeof event.message?.id === 'string' ? event.message.id : null;
      return typeof event.message?.model === 'string' ? [{ kind: 'model-resolved', model: event.message.model }] : [];
    }
    if (!this.streamMessageId || typeof event.index !== 'number') return [];
    const key = `${this.streamMessageId}#${event.index}`;
    if (event.type === 'content_block_start') {
      const t = event.content_block?.type;
      return t === 'text' || t === 'thinking' ? [{ kind: 'block-start', key, blockType: t }] : [];
    }
    if (event.type === 'content_block_delta') {
      const d: Loose = event.delta ?? {};
      if (d.type === 'text_delta') return [{ kind: 'block-delta', key, text: String(d.text ?? '') }];
      if (d.type === 'thinking_delta') return [{ kind: 'block-delta', key, text: String(d.thinking ?? '') }];
    }
    return [];
  }

  private assistant(msg: Loose): PanelEvent[] {
    const out: PanelEvent[] = [];
    if (!this.options.history && typeof msg.message?.model === 'string') out.push({ kind: 'model-resolved', model: msg.message.model });
    if (typeof msg.error === 'string') out.push({ kind: 'assistant-error', error: msg.error });
    const messageId = String(msg.message?.id ?? msg.uuid ?? '');
    const content: Loose[] = Array.isArray(msg.message?.content) ? msg.message.content : [];
    for (const block of content) {
      const index = this.blockCount.get(messageId) ?? 0;
      this.blockCount.set(messageId, index + 1);
      const key = `${messageId}#${index}`;
      if (block.type === 'text') out.push(finalBlock(key, 'text', block.text));
      else if (block.type === 'thinking') out.push(finalBlock(key, 'thinking', block.thinking));
      else if (block.type === 'tool_use') {
        out.push({ kind: 'tool-start', toolUseId: String(block.id), name: String(block.name), input: (block.input ?? {}) as Record<string, unknown> });
      }
    }
    return out;
  }

  private user(msg: Loose): PanelEvent[] {
    const content = msg.message?.content;
    const out: PanelEvent[] = [];
    if (typeof content === 'string') {
      if (this.options.history) pushUserText(out, content);
      return out;
    }
    if (!Array.isArray(content)) return out;
    for (const block of content as Loose[]) {
      if (block.type === 'tool_result') {
        out.push({ kind: 'tool-result', toolUseId: String(block.tool_use_id), isError: block.is_error === true, output: toolResultText(block.content) });
      } else if (block.type === 'text' && this.options.history) {
        pushUserText(out, String(block.text ?? ''));
      }
    }
    return out;
  }
}

function finalBlock(key: string, blockType: BlockType, text: unknown): PanelEvent {
  return { kind: 'block-final', key, blockType, text: String(text ?? '') };
}

function pushUserText(out: PanelEvent[], raw: string): void {
  const text = cleanUserText(raw);
  if (text) out.push({ kind: 'user-text', text });
}

/** 과거 대화의 사용자 메시지에서 패널이 붙인 컨텍스트와 CLI 내부 표식을 걷어낸다. */
export function cleanUserText(raw: string): string {
  const command = COMMAND_NAME_RE.exec(raw);
  if (command) {
    const args = COMMAND_ARGS_RE.exec(raw)?.[1]?.trim() ?? '';
    return args ? `${command[1]} ${args}` : command[1];
  }
  const text = raw.replace(CONTEXT_RE, '').trim();
  if (text.startsWith('<local-command') || text.startsWith('<system-reminder>')) return '';
  return text;
}

export function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Loose[]).map((part) => (part.type === 'text' ? String(part.text ?? '') : `[${String(part.type)}]`)).join('\n');
}

function resultEvent(msg: Loose): PanelEvent {
  const u: Loose = msg.usage ?? {};
  const usage: TurnUsage = {
    inputTokens: Number(u.input_tokens ?? 0),
    outputTokens: Number(u.output_tokens ?? 0),
    cacheReadTokens: Number(u.cache_read_input_tokens ?? 0),
    cacheCreationTokens: Number(u.cache_creation_input_tokens ?? 0),
    costUsd: Number(msg.total_cost_usd ?? 0),
    durationMs: Number(msg.duration_ms ?? 0),
  };
  const ok = msg.subtype === 'success' && msg.is_error !== true;
  let errors: string[] = [];
  if (Array.isArray(msg.errors)) errors = msg.errors.map(String);
  else if (!ok && typeof msg.result === 'string' && msg.result) errors = [msg.result];
  return { kind: 'turn-end', ok, subtype: String(msg.subtype ?? ''), errors, usage };
}
