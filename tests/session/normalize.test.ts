import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Normalizer, cleanUserText, toolResultText } from '../../src/session/normalize';
import type { PanelEvent } from '../../src/types';

type Of<K extends PanelEvent['kind']> = Extract<PanelEvent, { kind: K }>;
const ofKind = <K extends PanelEvent['kind']>(events: PanelEvent[], kind: K): Of<K>[] =>
  events.filter((e): e is Of<K> => e.kind === kind);

function replay(file: string): PanelEvent[] {
  const n = new Normalizer();
  const lines = readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8').split('\n').filter(Boolean);
  return lines.flatMap((line) => n.push(JSON.parse(line)));
}

describe('Normalizer — 녹화된 실제 스트림', () => {
  const events = replay('read-and-reply.jsonl');

  it('init으로 시작해 성공한 turn-end로 끝난다', () => {
    expect(events[0]).toMatchObject({ kind: 'init' });
    expect(events[events.length - 1]).toMatchObject({ kind: 'turn-end', ok: true, subtype: 'success' });
  });

  it('Read 도구 시작과 결과가 같은 id로 짝지어진다', () => {
    const [start] = ofKind(events, 'tool-start');
    const [result] = ofKind(events, 'tool-result');
    expect(start.name).toBe('Read');
    expect(result.toolUseId).toBe(start.toolUseId);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('hello-fixture');
  });

  it('delta를 이어 붙인 텍스트가 같은 키의 최종 블록 텍스트와 같다', () => {
    const finals = ofKind(events, 'block-final').filter((e) => e.blockType === 'text');
    expect(finals.length).toBeGreaterThan(0);
    for (const f of finals) {
      const streamed = ofKind(events, 'block-delta').filter((d) => d.key === f.key).map((d) => d.text).join('');
      expect(streamed).toBe(f.text);
      expect(ofKind(events, 'block-start').some((s) => s.key === f.key)).toBe(true);
    }
  });

  it('실시간 모드에서는 user-text를 만들지 않는다', () => {
    expect(ofKind(events, 'user-text')).toHaveLength(0);
  });
});

describe('Normalizer — 개별 경우', () => {
  it('stream_event 키와 assistant 블록 키가 같은 규칙으로 맞춰진다', () => {
    const n = new Normalizer();
    const out = [
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hm' } } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'thinking', thinking: 'hm' }] } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }] } }),
      ...n.push({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_start', index: 2, content_block: { type: 'text' } } }),
      ...n.push({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'done' }] } }),
    ];
    expect(out).toEqual([
      { kind: 'block-start', key: 'm1#0', blockType: 'thinking' },
      { kind: 'block-delta', key: 'm1#0', text: 'hm' },
      { kind: 'block-final', key: 'm1#0', blockType: 'thinking', text: 'hm' },
      { kind: 'tool-start', toolUseId: 'tu1', name: 'Bash', input: { command: 'ls' } },
      { kind: 'block-start', key: 'm1#2', blockType: 'text' },
      { kind: 'block-final', key: 'm1#2', blockType: 'text', text: 'done' },
    ]);
  });

  it('모르는 메시지 타입과 서브에이전트 메시지는 무시한다', () => {
    const n = new Normalizer();
    expect(n.push({ type: 'rate_limit_event' })).toEqual([]);
    expect(n.push(null)).toEqual([]);
    expect(n.push({ type: 'assistant', parent_tool_use_id: 'tu9', message: { id: 'x', content: [{ type: 'text', text: 'sub' }] } })).toEqual([]);
  });

  it('api_retry·status·init을 변환한다', () => {
    const n = new Normalizer();
    expect(n.push({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10 })).toEqual([{ kind: 'retry', attempt: 2, maxRetries: 10 }]);
    expect(n.push({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan' })).toEqual([{ kind: 'mode-changed', permissionMode: 'plan' }]);
    expect(n.push({ type: 'system', subtype: 'status', status: 'requesting' })).toEqual([]);
    expect(n.push({ type: 'system', subtype: 'init', session_id: 's1', model: 'm', permissionMode: 'auto', slash_commands: ['ingest'], claude_code_version: '2.1.278', effort: 'high' }))
      .toEqual([{ kind: 'init', sessionId: 's1', model: 'm', permissionMode: 'auto', slashCommands: ['ingest'], cliVersion: '2.1.278', effort: 'high' }]);
  });

  it('오류 result와 is_error인 success를 실패한 turn-end로 만든다', () => {
    const n = new Normalizer();
    const [a] = n.push({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'], usage: { input_tokens: 5, output_tokens: 1 }, total_cost_usd: 0.01, duration_ms: 900 });
    expect(a).toEqual({ kind: 'turn-end', ok: false, subtype: 'error_during_execution', errors: ['boom'], usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.01, durationMs: 900 } });
    const [b] = n.push({ type: 'result', subtype: 'success', is_error: true, result: 'Claude AI usage limit reached|1760000000' });
    expect(b).toMatchObject({ ok: false, errors: ['Claude AI usage limit reached|1760000000'] });
  });

  it('assistant의 error 필드를 assistant-error로 만든다', () => {
    const n = new Normalizer();
    const out = n.push({ type: 'assistant', parent_tool_use_id: null, error: 'authentication_failed', message: { id: 'e1', content: [{ type: 'text', text: 'Invalid API key' }] } });
    expect(out[0]).toEqual({ kind: 'assistant-error', error: 'authentication_failed' });
  });

  it('배열 형태 tool_result와 is_error를 처리한다', () => {
    const n = new Normalizer();
    const out = n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: [{ type: 'text', text: 'a' }, { type: 'image' }] }] } });
    expect(out).toEqual([{ kind: 'tool-result', toolUseId: 't1', isError: true, output: 'a\n[image]' }]);
  });

  it('history 모드에서는 사용자 텍스트를 정리해 user-text로 만든다', () => {
    const n = new Normalizer({ history: true });
    expect(n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: '<context>\n현재 노트: a.md\n</context>\n\n요약해 줘' } }))
      .toEqual([{ kind: 'user-text', text: '요약해 줘' }]);
    expect(n.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>x</system-reminder>' }] } })).toEqual([]);
  });
});

describe('cleanUserText / toolResultText', () => {
  it('슬래시 명령 표식을 /명령 인자 형태로 바꾼다', () => {
    expect(cleanUserText('<command-message>ingest</command-message>\n<command-name>/ingest</command-name>\n<command-args>raw/a.pdf</command-args>')).toBe('/ingest raw/a.pdf');
    expect(cleanUserText('<command-name>/clear</command-name><command-args></command-args>')).toBe('/clear');
  });
  it('로컬 명령 출력은 빈 문자열', () => {
    expect(cleanUserText('<local-command-stdout>ok</local-command-stdout>')).toBe('');
  });
  it('문자열·배열·기타 content', () => {
    expect(toolResultText('x')).toBe('x');
    expect(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(toolResultText(undefined)).toBe('');
  });
});
