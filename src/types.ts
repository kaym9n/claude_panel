import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';

export type BlockType = 'text' | 'thinking';

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  /** CLI가 만들어 준 승인 문장 (예: "Claude wants to read foo.txt"). 없으면 도구 이름+요약으로 표시 */
  title: string | null;
  reason: string | null;
  suggestions: PermissionUpdate[];
  canAlwaysAllow: boolean;
}

export type PanelEvent =
  // normalize.ts가 SDK 메시지에서 만드는 이벤트
  | { kind: 'init'; sessionId: string; model: string; permissionMode: string; slashCommands: string[]; cliVersion: string; effort: string | null }
  | { kind: 'block-start'; key: string; blockType: BlockType }
  | { kind: 'block-delta'; key: string; text: string }
  | { kind: 'block-final'; key: string; blockType: BlockType; text: string }
  | { kind: 'tool-start'; toolUseId: string; name: string; input: Record<string, unknown> }
  | { kind: 'tool-result'; toolUseId: string; isError: boolean; output: string }
  | { kind: 'user-text'; text: string }
  | { kind: 'retry'; attempt: number; maxRetries: number }
  | { kind: 'mode-changed'; permissionMode: string }
  | { kind: 'assistant-error'; error: string }
  | { kind: 'turn-end'; ok: boolean; subtype: string; errors: string[]; usage: TurnUsage }
  // ClaudeSession·ApprovalBroker가 만드는 이벤트
  | { kind: 'turn-start'; text: string; contextLabel: string | null }
  | { kind: 'interrupted' }
  | { kind: 'stream-error'; message: string; code: string | null }
  | { kind: 'context-usage'; percentage: number }
  | { kind: 'approval-request'; request: ApprovalRequest }
  | { kind: 'approval-settled'; id: string; summary: string };
