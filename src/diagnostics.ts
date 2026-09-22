const MAX_ERRORS = 10;
const MAX_STDERR_LINES = 20;

/** Copy diagnostics 명령용: 버전·경로·최근 오류·stderr를 모은다. */
export class Diagnostics {
  cliVersion: string | null = null;
  private readonly errors: { at: string; message: string }[] = [];
  private readonly stderrLines: string[] = [];

  recordError(message: string, now: Date = new Date()): void {
    this.errors.push({ at: now.toISOString(), message });
    while (this.errors.length > MAX_ERRORS) this.errors.shift();
  }

  recordStderr(chunk: string): void {
    for (const line of chunk.split('\n')) if (line.trim()) this.stderrLines.push(line);
    while (this.stderrLines.length > MAX_STDERR_LINES) this.stderrLines.shift();
  }

  report(claudePath: string): string {
    return [
      `Claude Panel ${__PLUGIN_VERSION__}`,
      `Agent SDK ${__SDK_VERSION__}`,
      `Claude Code ${this.cliVersion ?? '(세션 시작 전)'}`,
      `claude 경로: ${claudePath}`,
      `플랫폼: ${process.platform} ${process.arch}, Electron ${process.versions.electron ?? '-'}, Node ${process.versions.node}`,
      '',
      `최근 오류 ${this.errors.length}건:`,
      ...this.errors.map((e) => `- ${e.at} ${e.message}`),
      '',
      `최근 stderr ${this.stderrLines.length}줄:`,
      ...this.stderrLines,
    ].join('\n');
  }
}
