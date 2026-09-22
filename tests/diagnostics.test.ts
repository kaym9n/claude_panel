import { describe, expect, it } from 'vitest';
import { Diagnostics } from '../src/diagnostics';

describe('Diagnostics', () => {
  it('최근 오류 10건만 보관한다', () => {
    const d = new Diagnostics();
    for (let i = 1; i <= 12; i++) d.recordError(`e${i}`, new Date(Date.UTC(2026, 8, 19, 0, 0, i)));
    const report = d.report('/bin/claude');
    expect(report).toContain('최근 오류 10건:');
    expect(report).not.toContain(' e2\n');
    expect(report).toContain('- 2026-09-19T00:00:12.000Z e12');
  });

  it('stderr는 줄 단위로 최근 20줄만 보관한다', () => {
    const d = new Diagnostics();
    d.recordStderr(Array.from({ length: 25 }, (_, i) => `line${i}`).join('\n'));
    const report = d.report('/bin/claude');
    expect(report).toContain('최근 stderr 20줄:');
    expect(report).not.toContain('line4\n');
    expect(report).toContain('line24');
  });

  it('버전·경로를 담는다', () => {
    const d = new Diagnostics();
    expect(d.report('/bin/claude')).toContain('Claude Code (세션 시작 전)');
    d.cliVersion = '2.1.278';
    const report = d.report('/home/u/.local/bin/claude');
    expect(report).toContain('Claude Panel test');
    expect(report).toContain('Agent SDK test');
    expect(report).toContain('Claude Code 2.1.278');
    expect(report).toContain('claude 경로: /home/u/.local/bin/claude');
  });
});
