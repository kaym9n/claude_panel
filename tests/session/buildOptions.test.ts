import { describe, expect, it } from 'vitest';
import { buildOptions, type SessionConfig } from '../../src/session/buildOptions';

const config: SessionConfig = { cwd: '/vault', claudePath: '/bin/claude', env: { PATH: '/bin' }, useHooks: true, defaultModel: '' };
const canUseTool = async () => ({ behavior: 'allow' as const });

describe('buildOptions', () => {
  it('터미널과 같은 기본 옵션을 만들고, 바꾸지 않은 모델·권한 모드는 넘기지 않는다', () => {
    const o = buildOptions(config, {}, canUseTool);
    expect(o).toMatchObject({
      cwd: '/vault',
      pathToClaudeCodeExecutable: '/bin/claude',
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      env: { PATH: '/bin' },
    });
    expect(o.canUseTool).toBe(canUseTool);
    for (const key of ['model', 'permissionMode', 'effort', 'resume', 'settings']) expect(o).not.toHaveProperty(key);
  });

  it('기본 모델 설정과 재정의를 반영한다 (재정의 우선)', () => {
    expect(buildOptions({ ...config, defaultModel: 'sonnet' }, {}, canUseTool).model).toBe('sonnet');
    const o = buildOptions({ ...config, defaultModel: 'sonnet' }, { model: 'opus', effort: 'low', permissionMode: 'plan', resume: 's1' }, canUseTool);
    expect(o).toMatchObject({ model: 'opus', effort: 'low', permissionMode: 'plan', resume: 's1' });
  });

  it('hook 사용 off면 disableAllHooks를 덧붙인다', () => {
    expect(buildOptions({ ...config, useHooks: false }, {}, canUseTool).settings).toEqual({ disableAllHooks: true });
  });

  it('stderr 콜백을 전달한다', () => {
    const stderr = () => undefined;
    expect(buildOptions(config, {}, canUseTool, stderr).stderr).toBe(stderr);
  });
});
