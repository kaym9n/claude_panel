import type { PanelEvent } from '../types';

/** Progress is independent from token streaming and account usage. */
export class ActivityState {
  private connected = false;
  private phase = '새 대화';
  private busy = false;
  private interrupted = false;
  private readonly tools = new Map<string, string>();
  private readonly approvals = new Set<string>();
  private readonly blocks = new Map<string, string>();

  reset(label = '새 대화'): string {
    this.connected = false;
    this.busy = false;
    this.interrupted = false;
    this.tools.clear(); this.approvals.clear(); this.blocks.clear();
    this.phase = label;
    return this.text;
  }

  get text(): string {
    if (!this.busy) return this.phase;
    if (this.interrupted) return '중단 처리 중…';
    if (this.approvals.size) return `승인 대기 · ${this.approvals.size}건`;
    if (this.phase.startsWith('재시도') || this.phase.startsWith('대화 압축')) return this.phase;
    if (this.tools.size) return `도구 실행 중 · ${[...this.tools.values()].join(', ')}`;
    return this.phase;
  }

  apply(e: PanelEvent): string {
    switch (e.kind) {
      case 'turn-start':
        this.busy = true; this.interrupted = false;
        this.tools.clear(); this.approvals.clear(); this.blocks.clear();
        this.phase = this.connected ? '응답 대기 중…' : 'Claude 연결 중…';
        break;
      case 'init':
        this.connected = true;
        if (this.busy) this.phase = '응답 대기 중…';
        break;
      case 'block-start':
        this.blocks.set(e.key, e.blockType);
        this.phase = e.blockType === 'thinking' ? '생각 중…' : '답변 작성 중…';
        break;
      case 'block-delta':
        this.phase = this.blocks.get(e.key) === 'thinking' ? '생각 중…' : '답변 작성 중…';
        break;
      case 'block-final':
        this.phase = e.blockType === 'thinking' ? '생각 정리 중…' : '답변 정리 중…';
        break;
      case 'tool-start': this.tools.set(e.toolUseId, e.name); break;
      case 'tool-result': this.tools.delete(e.toolUseId); this.phase = '응답 대기 중…'; break;
      case 'approval-request': this.approvals.add(e.request.id); break;
      case 'approval-settled': this.approvals.delete(e.id); this.phase = '응답 대기 중…'; break;
      case 'retry': this.phase = `재시도 중 · ${e.attempt}/${e.maxRetries}`; break;
      case 'compacting': this.phase = e.active ? '대화 압축 중…' : '응답 대기 중…'; break;
      case 'interrupted': this.interrupted = true; break;
      case 'turn-end':
        this.busy = false;
        this.phase = this.interrupted ? '중단됨' : e.ok ? '완료' : '응답 실패 · 오류 내용을 확인하세요';
        break;
      case 'stream-error':
        this.busy = false; this.connected = false;
        this.phase = '연결 오류 · 다시 연결할 수 있습니다';
        break;
    }
    return this.text;
  }
}
