// 실제 claude CLI를 띄운다. 임시 폴더(vault 아님)에서 가장 가벼운 모델로, hook을 끄고 실행한다.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { SessionConfig } from '../../src/session/buildOptions';
import { ClaudeSession } from '../../src/session/ClaudeSession';
import type { PanelEvent } from '../../src/types';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from '../../src/util/claudePath';

const cwd = mkdtempSync(join(tmpdir(), 'claude-panel-live-'));
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

async function config(): Promise<SessionConfig> {
  const env = buildEnv();
  const claudePath = resolveOnPath('claude', env.PATH ?? '') ?? (await findClaudeViaLoginShell());
  if (!claudePath) throw new Error('claude 실행 파일을 찾지 못함');
  return { cwd, claudePath, env, useHooks: false, defaultModel: 'haiku' };
}

async function newSession(): Promise<ClaudeSession> {
  const cfg = await config();
  return new ClaudeSession({ query, getConfig: () => cfg });
}

function waitFor(session: ClaudeSession, pred: (e: PanelEvent) => boolean, ms = 120_000): Promise<PanelEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('timeout'));
    }, ms);
    const off = session.on((e) => {
      if (pred(e)) {
        clearTimeout(timer);
        off();
        resolve(e);
      }
    });
  });
}

function textOf(events: PanelEvent[]): string {
  return events.map((e) => (e.kind === 'block-final' && e.blockType === 'text' ? e.text : '')).join('');
}

function collect(session: ClaudeSession): PanelEvent[] {
  const all: PanelEvent[] = [];
  session.on((e) => all.push(e));
  return all;
}

function childPids(): string[] {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).split('\n').filter(Boolean);
  } catch {
    return []; // pgrep은 결과가 없으면 종료 코드 1
  }
}

describe('실제 CLI', () => {
  let firstSessionId = '';

  it('텍스트 응답', async () => {
    const s = await newSession();
    const events = collect(s);
    s.send({ prompt: 'Reply with exactly: pong', display: 'pong?', contextLabel: null });
    expect(await waitFor(s, (e) => e.kind === 'turn-end')).toMatchObject({ ok: true });
    expect(textOf(events).toLowerCase()).toContain('pong');
    firstSessionId = s.sessionId ?? '';
    s.close();
  });

  it('default 모드 파일 쓰기는 canUseTool 승인을 거친다', async () => {
    const s = await newSession();
    await s.setPermissionMode('default');
    s.on((e) => {
      if (e.kind === 'approval-request') s.broker.decide(e.request.id, { type: 'allow' });
    });
    const approval = waitFor(s, (e) => e.kind === 'approval-request');
    s.send({ prompt: 'Use the Write tool to create a file named out.txt containing the word hi. Do nothing else.', display: 'write', contextLabel: null });
    expect(await approval).toMatchObject({ request: { toolName: 'Write' } });
    await waitFor(s, (e) => e.kind === 'turn-end');
    expect(existsSync(join(cwd, 'out.txt'))).toBe(true);
    s.close();
  });

  it('이어하기', async () => {
    expect(firstSessionId).not.toBe('');
    const s = await newSession();
    s.resumeFrom(firstSessionId);
    const events = collect(s);
    s.send({ prompt: 'What exact word did you reply with in your previous message? Answer with that word only.', display: 'recall', contextLabel: null });
    await waitFor(s, (e) => e.kind === 'turn-end');
    expect(textOf(events).toLowerCase()).toContain('pong');
    s.close();
  });

  it('중단', async () => {
    const s = await newSession();
    const firstDelta = waitFor(s, (e) => e.kind === 'block-delta');
    s.send({ prompt: 'Write the numbers from 1 to 400, one per line.', display: 'count', contextLabel: null });
    await firstDelta;
    const end = waitFor(s, (e) => e.kind === 'turn-end' || e.kind === 'stream-error', 60_000);
    await s.interrupt();
    await end;
    expect(s.isBusy).toBe(false);
    s.close();
  });

  it('close 후 자식 프로세스가 남지 않는다', async () => {
    const s = await newSession();
    s.send({ prompt: 'Reply with exactly: ok', display: 'ok', contextLabel: null });
    await waitFor(s, (e) => e.kind === 'turn-end');
    s.close();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(childPids()).toEqual([]);
  });
});
