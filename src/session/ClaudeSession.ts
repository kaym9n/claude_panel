import type { EffortLevel, ModelInfo, PermissionMode, Query, SDKUserMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import type { PanelEvent } from '../types';
import { ApprovalBroker } from './ApprovalBroker';
import { buildOptions, type SessionConfig, type SessionOverrides } from './buildOptions';
import { InputQueue } from './InputQueue';
import { Normalizer } from './normalize';
import type { QueryFn } from './oneShot';

export interface ClaudeSessionDeps {
  query: QueryFn;
  /** 시작할 때마다 호출해 최신 설정을 읽는다 */
  getConfig: () => SessionConfig;
  onStderr?: (data: string) => void;
}

export interface OutgoingMessage {
  /** Claude에 보낼 텍스트 (컨텍스트 포함) */
  prompt: string;
  /** 대화 목록에 보일 텍스트 */
  display: string;
  contextLabel: string | null;
}

type Listener = (e: PanelEvent) => void;

/** 패널 1개 = 세션 1개. SDK query()를 호출하는 유일한 객체. */
export class ClaudeSession {
  readonly broker: ApprovalBroker;
  sessionId: string | null = null;
  permissionMode: PermissionMode | null = null;
  model: string | null = null;
  cliVersion: string | null = null;

  private q: Query | null = null;
  private input: InputQueue<SDKUserMessage> | null = null;
  private normalizer = new Normalizer();
  private readonly listeners = new Set<Listener>();
  private readonly overrides: SessionOverrides = {};
  private modeBeforePlan: PermissionMode | null = null;
  private busy = false;
  private closed = false;

  constructor(private readonly deps: ClaudeSessionDeps) {
    this.broker = new ApprovalBroker({ emit: (e) => this.emit(e), onPlanApproved: () => this.restoreModeAfterPlan() });
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get isStarted(): boolean {
    return this.q !== null;
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 과거 세션을 이어서 대화한다. 다음 시작 때 resume으로 전달된다. */
  resumeFrom(sessionId: string): void {
    this.sessionId = sessionId;
    this.overrides.resume = sessionId;
  }

  /** 첫 전송 전에 프로세스가 필요할 때(예: `/` 자동완성 목록). */
  ensureStarted(): void {
    if (this.closed) throw new Error('세션이 닫혔습니다.');
    if (!this.q) this.start();
  }

  send(msg: OutgoingMessage): void {
    if (this.closed) throw new Error('세션이 닫혔습니다.');
    this.busy = true;
    this.emit({ kind: 'turn-start', text: msg.display, contextLabel: msg.contextLabel });
    if (!this.q) this.start();
    if (!this.input) return; // 시작 실패는 start()가 stream-error로 알렸다
    this.input.push({ type: 'user', message: { role: 'user', content: msg.prompt }, parent_tool_use_id: null });
  }

  async interrupt(): Promise<void> {
    if (!this.q || !this.busy) return;
    const q = this.q;
    this.emit({ kind: 'interrupted' });
    this.broker.denyAll('사용자가 중단함');
    try {
      await q.interrupt();
    } catch (err) {
      this.deps.onStderr?.(`interrupt 실패: ${errorMessage(err)}`);
    }
  }

  async setModel(model: string | undefined): Promise<void> {
    if (this.q) await this.q.setModel(model);
    this.overrides.model = model;
  }

  async setEffort(effort: EffortLevel | undefined): Promise<void> {
    if (this.q) await this.q.applyFlagSettings({ effortLevel: effort ?? null });
    this.overrides.effort = effort;
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    if (this.q) await this.q.setPermissionMode(mode);
    if (mode === 'plan' && this.permissionMode !== 'plan') this.modeBeforePlan = this.permissionMode ?? 'default';
    this.overrides.permissionMode = mode;
    this.permissionMode = mode;
    this.emit({ kind: 'mode-changed', permissionMode: mode });
  }

  async supportedCommands(): Promise<SlashCommand[]> {
    return this.q ? this.q.supportedCommands() : [];
  }

  async supportedModels(): Promise<ModelInfo[]> {
    return this.q ? this.q.supportedModels() : [];
  }

  /** 프로세스가 죽은 뒤 [다시 연결]: 마지막 세션 ID로 resume해 새 프로세스를 띄운다. */
  reconnect(): void {
    if (!this.q && !this.closed) this.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.broker.denyAll('패널이 닫힘');
    const q = this.q;
    this.detach();
    q?.close();
  }

  private async restoreModeAfterPlan(): Promise<void> {
    const previous = this.modeBeforePlan ?? 'default';
    this.modeBeforePlan = null;
    try {
      await this.setPermissionMode(previous);
    } catch (err) {
      this.deps.onStderr?.(`계획 모드 복귀 실패: ${errorMessage(err)}`);
    }
  }

  private start(): void {
    const input = new InputQueue<SDKUserMessage>();
    this.input = input;
    this.normalizer = new Normalizer();
    let q: Query;
    try {
      const options = buildOptions(this.deps.getConfig(), this.overrides, this.broker.handle, this.deps.onStderr);
      q = this.deps.query({ prompt: input, options });
    } catch (err) {
      this.fail(errorMessage(err), errorCode(err));
      return;
    }
    this.overrides.resume = undefined;
    this.q = q;
    void this.pump(q);
  }

  private async pump(q: Query): Promise<void> {
    try {
      for await (const msg of q) {
        if (this.q !== q) return;
        for (const e of this.normalizer.push(msg)) this.handle(q, e);
      }
      if (this.q !== q) return;
      if (this.busy) this.fail('Claude 프로세스가 종료되었습니다.', null);
      else this.detach();
    } catch (err) {
      if (this.q === q) this.fail(errorMessage(err), errorCode(err));
    }
  }

  private handle(q: Query, e: PanelEvent): void {
    if (e.kind === 'init') {
      this.sessionId = e.sessionId;
      this.model = e.model;
      this.cliVersion = e.cliVersion;
      this.permissionMode = e.permissionMode as PermissionMode;
    } else if (e.kind === 'model-resolved') {
      this.model = e.model;
    } else if (e.kind === 'mode-changed') {
      this.permissionMode = e.permissionMode as PermissionMode;
    } else if (e.kind === 'turn-end') {
      this.busy = false;
    }
    this.emit(e);
    if (e.kind === 'turn-end') void this.refreshContextUsage(q);
  }

  private fail(message: string, code: string | null): void {
    this.detach();
    this.broker.denyAll('Claude 프로세스 종료');
    this.busy = false;
    this.emit({ kind: 'stream-error', message, code });
  }

  private detach(): void {
    this.input?.end();
    this.input = null;
    this.q = null;
    if (this.sessionId && !this.closed) this.overrides.resume = this.sessionId;
  }

  private async refreshContextUsage(q: Query): Promise<void> {
    try {
      const usage = await q.getContextUsage({ detail: 'summary' });
      if (this.q === q) this.emit({ kind: 'context-usage', percentage: usage.percentage });
    } catch {
      // 컨텍스트 사용률은 부가 정보라 실패해도 무시한다
    }
  }

  private emit(e: PanelEvent): void {
    for (const listener of this.listeners) listener(e);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function errorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') return code;
  return /ENOENT|executable not found/i.test(errorMessage(err)) ? 'ENOENT' : null;
}
