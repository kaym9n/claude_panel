import type { CanUseTool, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalBroker } from '../../src/session/ApprovalBroker';
import type { PanelEvent } from '../../src/types';

type ToolOptions = Parameters<CanUseTool>[2];
const suggestion: PermissionUpdate = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'ls:*' }], behavior: 'allow', destination: 'localSettings' };

function setup() {
  const events: PanelEvent[] = [];
  const onPlanApproved = vi.fn();
  const broker = new ApprovalBroker({ emit: (e) => events.push(e), onPlanApproved });
  const controller = new AbortController();
  const opts = (extra: Partial<ToolOptions> = {}): ToolOptions =>
    ({ signal: controller.signal, toolUseID: 'tu1', requestId: 'r1', ...extra }) as ToolOptions;
  const lastRequestId = () => {
    const req = [...events].reverse().find((e) => e.kind === 'approval-request');
    return req && req.kind === 'approval-request' ? req.request.id : '';
  };
  return { broker, events, onPlanApproved, controller, opts, lastRequestId };
}

describe('ApprovalBroker', () => {
  it('요청을 알리고 허용 결정을 입력 그대로 돌려준다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Bash', { command: 'ls' }, opts({ title: 'Claude wants to run ls', decisionReason: 'no rule' }));
    expect(events[0]).toMatchObject({ kind: 'approval-request', request: { toolName: 'Bash', title: 'Claude wants to run ls', reason: 'no rule', canAlwaysAllow: false } });
    broker.decide(lastRequestId(), { type: 'allow' });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
    expect(events[1]).toEqual({ kind: 'approval-settled', id: lastRequestId(), summary: '허용함' });
    expect(broker.pendingCount).toBe(0);
  });

  it('항상 허용은 suggestions를 updatedPermissions로 돌려준다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Bash', { command: 'ls' }, opts({ suggestions: [suggestion] }));
    expect(events[0]).toMatchObject({ request: { canAlwaysAllow: true } });
    broker.decide(lastRequestId(), { type: 'allow-always' });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' }, updatedPermissions: [suggestion] });
  });

  it('suppressAlwaysAllowRule이면 항상 허용을 막는다', () => {
    const { broker, events, opts } = setup();
    void broker.handle('Bash', {}, opts({ suggestions: [suggestion], suppressAlwaysAllowRule: true }));
    expect(events[0]).toMatchObject({ request: { canAlwaysAllow: false } });
  });

  it('거부 사유를 Claude에 전달한다', async () => {
    const { broker, events, opts, lastRequestId } = setup();
    const p = broker.handle('Write', {}, opts());
    broker.decide(lastRequestId(), { type: 'deny', message: '그 파일은 건드리지 마' });
    expect(await p).toEqual({ behavior: 'deny', message: '그 파일은 건드리지 마' });
    expect(events[1]).toMatchObject({ summary: '거부함: 그 파일은 건드리지 마' });
  });

  it('AskUserQuestion 답을 updatedInput.answers로 넘긴다', async () => {
    const { broker, opts, lastRequestId } = setup();
    const input = { questions: [{ question: '어느 쪽?', header: 'H', options: [], multiSelect: false }] };
    const p = broker.handle('AskUserQuestion', input, opts());
    broker.decide(lastRequestId(), { type: 'answer', answers: { '어느 쪽?': 'A' } });
    expect(await p).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { '어느 쪽?': 'A' } } });
  });

  it('Plan 승인은 허용 후 onPlanApproved를 부르고, 계속 계획은 의견과 함께 거부한다', async () => {
    const { broker, onPlanApproved, opts, lastRequestId } = setup();
    const p1 = broker.handle('ExitPlanMode', { plan: 'x' }, opts());
    broker.decide(lastRequestId(), { type: 'plan-approve' });
    expect(await p1).toEqual({ behavior: 'allow', updatedInput: { plan: 'x' } });
    expect(onPlanApproved).toHaveBeenCalledOnce();
    const p2 = broker.handle('ExitPlanMode', { plan: 'x' }, opts());
    broker.decide(lastRequestId(), { type: 'plan-revise', feedback: '테스트 단계 추가' });
    expect(await p2).toEqual({ behavior: 'deny', message: '테스트 단계 추가' });
  });

  it('signal abort 시 자동으로 거부하고 카드를 닫는다', async () => {
    const { broker, events, controller, opts } = setup();
    const p = broker.handle('Bash', {}, opts());
    controller.abort();
    expect(await p).toMatchObject({ behavior: 'deny' });
    expect(events[1]).toMatchObject({ kind: 'approval-settled', summary: '취소됨' });
  });

  it('denyAll은 대기 중 요청을 모두 interrupt 거부한다', async () => {
    const { broker, opts } = setup();
    const a = broker.handle('Bash', {}, opts());
    const b = broker.handle('Write', {}, opts());
    broker.denyAll('사용자가 중단함');
    expect(await a).toEqual({ behavior: 'deny', message: '사용자가 중단함', interrupt: true });
    expect(await b).toMatchObject({ behavior: 'deny' });
    expect(broker.pendingCount).toBe(0);
  });

  it('없는 id의 결정은 무시한다', () => {
    const { broker } = setup();
    expect(() => broker.decide('nope', { type: 'allow' })).not.toThrow();
  });
});
