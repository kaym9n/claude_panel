import { describe, expect, it } from 'vitest';
import { augmentPath, buildEnv, findClaudeViaLoginShell, resolveOnPath } from '../../src/util/claudePath';

describe('augmentPath', () => {
  it('빠진 사용자 bin 경로를 뒤에 덧붙인다', () => {
    const result = augmentPath('/usr/bin:/bin', '/home/u').split(':');
    expect(result.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    expect(result).toContain('/home/u/.local/bin');
    expect(result).toContain('/usr/local/bin');
  });
  it('이미 있는 경로는 중복하지 않는다', () => {
    const result = augmentPath('/home/u/.local/bin:/usr/bin', '/home/u').split(':');
    expect(result.filter((p) => p === '/home/u/.local/bin')).toHaveLength(1);
  });
  it('PATH가 없어도 동작한다', () => {
    expect(augmentPath(undefined, '/home/u')).toContain('/home/u/.local/bin');
  });
});

describe('resolveOnPath', () => {
  const exists = (p: string) => p === '/b/claude' || p === '/abs/claude';
  it('PATH 순서대로 찾아 절대 경로를 돌려준다', () => {
    expect(resolveOnPath('claude', '/a:/b', exists)).toBe('/b/claude');
  });
  it('절대 경로는 존재할 때만 그대로 돌려준다', () => {
    expect(resolveOnPath('/abs/claude', '', exists)).toBe('/abs/claude');
    expect(resolveOnPath('/nope/claude', '', exists)).toBeNull();
  });
  it('못 찾으면 null', () => {
    expect(resolveOnPath('claude', '/a', exists)).toBeNull();
  });
});

describe('findClaudeViaLoginShell', () => {
  it('bash -lc 결과의 마지막 줄을 절대 경로로 받는다', async () => {
    const calls: string[][] = [];
    const exec = async (file: string, args: string[]) => {
      calls.push([file, ...args]);
      return 'motd noise\n/home/u/.local/bin/claude\n';
    };
    expect(await findClaudeViaLoginShell(exec)).toBe('/home/u/.local/bin/claude');
    expect(calls[0]).toEqual(['bash', '-lc', 'command -v claude']);
  });
  it('실행 실패나 상대 경로 결과는 null', async () => {
    expect(await findClaudeViaLoginShell(async () => { throw new Error('exit 1'); })).toBeNull();
    expect(await findClaudeViaLoginShell(async () => 'claude\n')).toBeNull();
  });
});

describe('buildEnv', () => {
  it('기존 환경을 유지하고 PATH를 보강하며 클라이언트 식별자를 넣는다', () => {
    const env = buildEnv({ PATH: '/usr/bin', HOME: '/home/u' }, '/home/u');
    expect(env.HOME).toBe('/home/u');
    expect(env.PATH).toContain('/home/u/.local/bin');
    expect(env.CLAUDE_AGENT_SDK_CLIENT_APP).toBe('claude-panel/test');
  });
});
