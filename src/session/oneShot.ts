import type { Options } from '@anthropic-ai/claude-agent-sdk';

export type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk').query;

export interface OneShotConfig {
  cwd: string;
  claudePath: string;
  env: Record<string, string | undefined>;
}

export interface OneShotOptions {
  model?: string;
  systemPrompt?: string;
}

export interface OneShotResult {
  text: string;
  model: string | null;
  cliVersion: string | null;
}

/** 도구·설정·세션 기록 없이 한 번 묻고 답을 받는다 (연결 테스트·제목 생성·고쳐쓰기). */
export async function oneShot(queryFn: QueryFn, config: OneShotConfig, prompt: string, opts: OneShotOptions = {}): Promise<OneShotResult> {
  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.claudePath,
    env: config.env,
    tools: [],
    persistSession: false,
    settingSources: [],
    maxTurns: 1,
  };
  if (opts.model) options.model = opts.model;
  if (opts.systemPrompt !== undefined) options.systemPrompt = opts.systemPrompt;

  let model: string | null = null;
  let cliVersion: string | null = null;
  for await (const msg of queryFn({ prompt, options })) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      model = msg.model;
      cliVersion = msg.claude_code_version;
    } else if (msg.type === 'result') {
      if (msg.subtype === 'success' && !msg.is_error) return { text: msg.result.trim(), model, cliVersion };
      const detail = msg.subtype === 'success' ? msg.result : msg.errors.join('\n');
      throw new Error(detail || msg.subtype);
    }
  }
  throw new Error('Claude가 결과 없이 종료되었습니다.');
}
