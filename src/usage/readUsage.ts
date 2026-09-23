import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { OneShotConfig, QueryFn } from '../session/oneShot';
import { InputQueue } from '../session/InputQueue';

export class UsageUnsupported extends Error {}
const METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';

export async function readUsage(query: Query, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw new Error('계정 한도 조회가 취소되었습니다.');
  const method = (query as unknown as Record<string, unknown>)[METHOD];
  if (typeof method !== 'function') throw new UsageUnsupported('이 CLI/SDK는 계정 한도 조회를 지원하지 않습니다.');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel = () => {};
  try {
    return await Promise.race([
      Promise.resolve().then(() => method.call(query, { skipBehaviors: true })),
      new Promise<never>((_, reject) => {
        cancel = () => reject(new Error('계정 한도 조회가 취소되었습니다.'));
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        timer = setTimeout(() => reject(new Error('계정 한도 조회 시간이 초과되었습니다.')), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

/** An empty input stream only opens the control channel; no model prompt is sent. */
export async function readUsageStandalone(queryFn: QueryFn, config: OneShotConfig, signal: AbortSignal): Promise<unknown> {
  const input = new InputQueue<SDKUserMessage>();
  let q: Query | undefined;
  try {
    if (signal.aborted) throw new Error('계정 한도 조회가 취소되었습니다.');
    q = queryFn({ prompt: input, options: {
      cwd: config.cwd, pathToClaudeCodeExecutable: config.claudePath, env: config.env,
      tools: [], settingSources: [], settings: { disableAllHooks: true }, persistSession: false,
    } });
    return await readUsage(q, signal);
  } finally {
    input.end();
    q?.close();
  }
}
