import type { CanUseTool, EffortLevel, Options, PermissionMode } from '@anthropic-ai/claude-agent-sdk';

export interface SessionConfig {
  cwd: string;
  /** 절대 경로 (SDK가 존재 여부를 검사한다) */
  claudePath: string;
  env: Record<string, string | undefined>;
  useHooks: boolean;
  /** 비우면 CLI 설정을 따른다 */
  defaultModel: string;
}

/** 패널에서 바꾼 값. 바꾸지 않은 항목은 넘기지 않아 터미널과 같은 설정을 따른다. */
export interface SessionOverrides {
  model?: string;
  effort?: EffortLevel;
  permissionMode?: PermissionMode;
  resume?: string;
}

export function buildOptions(config: SessionConfig, overrides: SessionOverrides, canUseTool: CanUseTool, stderr?: (data: string) => void): Options {
  const options: Options = {
    cwd: config.cwd,
    pathToClaudeCodeExecutable: config.claudePath,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
    includePartialMessages: true,
    canUseTool,
    env: config.env,
  };
  const model = overrides.model ?? (config.defaultModel || undefined);
  if (model) options.model = model;
  if (overrides.effort) options.effort = overrides.effort;
  if (overrides.permissionMode) options.permissionMode = overrides.permissionMode;
  if (overrides.resume) options.resume = overrides.resume;
  if (!config.useHooks) options.settings = { disableAllHooks: true };
  if (stderr) options.stderr = stderr;
  return options;
}
