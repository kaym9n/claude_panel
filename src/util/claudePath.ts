import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';

const HOME_BIN_DIRS = ['.local/bin', '.npm-global/bin', 'bin', '.claude/local'];
const SYSTEM_BIN_DIRS = ['/usr/local/bin', '/opt/homebrew/bin'];

/** 데스크톱 런처로 띄운 Obsidian은 PATH에 ~/.local/bin 등이 빠져 있다. */
export function augmentPath(current: string | undefined, home: string): string {
  const parts = (current ?? '').split(delimiter).filter(Boolean);
  for (const dir of [...HOME_BIN_DIRS.map((d) => join(home, d)), ...SYSTEM_BIN_DIRS]) {
    if (!parts.includes(dir)) parts.push(dir);
  }
  return parts.join(delimiter);
}

/** SDK는 실행 파일 존재 여부를 검사하므로 이름만 있는 설정값을 절대 경로로 바꾼다. */
export function resolveOnPath(command: string, pathValue: string, exists: (p: string) => boolean = existsSync): string | null {
  if (isAbsolute(command)) return exists(command) ? command : null;
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (exists(candidate)) return candidate;
  }
  return null;
}

export type ExecFn = (file: string, args: string[]) => Promise<string>;

const execDefault: ExecFn = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });

/** 로그인 셸의 PATH로 claude를 찾는다 (nvm 등 셸 초기화 파일에서 PATH를 잡는 경우). */
export async function findClaudeViaLoginShell(exec: ExecFn = execDefault): Promise<string | null> {
  try {
    const lines = (await exec('bash', ['-lc', 'command -v claude'])).trim().split('\n');
    const last = lines[lines.length - 1]?.trim() ?? '';
    return isAbsolute(last) ? last : null;
  } catch {
    return null;
  }
}

export function buildEnv(base: NodeJS.ProcessEnv = process.env, home: string = homedir()): Record<string, string | undefined> {
  return { ...base, PATH: augmentPath(base.PATH, home), CLAUDE_AGENT_SDK_CLIENT_APP: `claude-panel/${__PLUGIN_VERSION__}` };
}
