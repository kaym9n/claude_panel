import { query } from '@anthropic-ai/claude-agent-sdk';
import { FileSystemAdapter, Notice, Plugin } from 'obsidian';
import { oneShot } from './session/oneShot';
import { buildEnv, findClaudeViaLoginShell, resolveOnPath } from './util/claudePath';

export default class ClaudePanelPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.addCommand({ id: 'test-connection', name: 'Test connection', callback: () => void this.testConnection() });
  }

  vaultPath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) return adapter.getBasePath();
    throw new Error('데스크톱 vault에서만 동작합니다.');
  }

  private async testConnection(): Promise<void> {
    const env = buildEnv();
    const claudePath = resolveOnPath('claude', env.PATH ?? '') ?? (await findClaudeViaLoginShell());
    if (!claudePath) {
      new Notice('claude 실행 파일을 찾지 못했습니다.');
      return;
    }
    const notice = new Notice('Claude 연결 확인 중…', 0);
    try {
      const r = await oneShot(query, { cwd: this.vaultPath(), claudePath, env }, 'Reply with exactly: pong', { model: 'haiku' });
      notice.setMessage(`연결 성공: ${r.text} (CLI ${r.cliVersion ?? '?'}, ${r.model ?? '?'})`);
    } catch (err) {
      notice.setMessage(`연결 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    window.setTimeout(() => notice.hide(), 8000);
  }
}
