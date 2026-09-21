import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { ApprovalRequest, PanelEvent } from '../types';

export type ApprovalDecision =
  | { type: 'allow' }
  | { type: 'allow-always' }
  | { type: 'deny'; message: string }
  | { type: 'answer'; answers: Record<string, string> }
  | { type: 'plan-approve' }
  | { type: 'plan-revise'; feedback: string };

export interface BrokerHooks {
  emit(e: PanelEvent): void;
  /** ExitPlanMode 승인 직후: 계획 모드 이전 권한 모드로 되돌린다. */
  onPlanApproved(): Promise<void> | void;
}

interface Pending {
  request: ApprovalRequest;
  resolve: (result: PermissionResult) => void;
  cleanup: () => void;
}

/** canUseTool 호출마다 Promise를 만들고 UI 결정으로 완료한다. 규칙·권한 모드가 이미 허용한 도구는 여기 오지 않는다. */
export class ApprovalBroker {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private readonly hooks: BrokerHooks) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  readonly handle: CanUseTool = (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      this.seq += 1;
      const id = `apr-${this.seq}`;
      const suggestions = options.suggestions ?? [];
      const request: ApprovalRequest = {
        id,
        toolName,
        input,
        title: options.title ?? null,
        reason: options.decisionReason ?? null,
        suggestions,
        canAlwaysAllow: suggestions.length > 0 && options.suppressAlwaysAllowRule !== true,
      };
      const onAbort = () => this.settle(id, { behavior: 'deny', message: 'Request aborted' }, '취소됨');
      options.signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(id, { request, resolve, cleanup: () => options.signal.removeEventListener('abort', onAbort) });
      this.hooks.emit({ kind: 'approval-request', request });
      if (options.signal.aborted) onAbort();
    });

  decide(id: string, decision: ApprovalDecision): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    const input = pending.request.input;
    switch (decision.type) {
      case 'allow':
        this.settle(id, { behavior: 'allow', updatedInput: input }, '허용함');
        return;
      case 'allow-always':
        this.settle(id, { behavior: 'allow', updatedInput: input, updatedPermissions: pending.request.suggestions }, '항상 허용함');
        return;
      case 'deny':
        this.settle(id, { behavior: 'deny', message: decision.message || 'User denied this action.' }, decision.message ? `거부함: ${decision.message}` : '거부함');
        return;
      case 'answer':
        this.settle(id, { behavior: 'allow', updatedInput: { ...input, answers: decision.answers } }, '답변함');
        return;
      case 'plan-approve':
        this.settle(id, { behavior: 'allow', updatedInput: input }, '계획 승인함');
        void this.hooks.onPlanApproved();
        return;
      case 'plan-revise':
        this.settle(id, { behavior: 'deny', message: decision.feedback || 'Keep planning.' }, '계획 계속');
        return;
    }
  }

  /** 중단·종료 시 대기 중인 승인을 모두 거부한다. */
  denyAll(reason: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { behavior: 'deny', message: reason, interrupt: true }, '취소됨');
  }

  private settle(id: string, result: PermissionResult, summary: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    pending.resolve(result);
    this.hooks.emit({ kind: 'approval-settled', id, summary });
  }
}
