import type { Options, Query } from '@anthropic-ai/claude-agent-sdk';
import { vi } from 'vitest';
import type { QueryFn } from '../../src/session/oneShot';

type Params = { prompt: string | AsyncIterable<unknown>; options?: Options };

/** SDK Query를 흉내 낸다: emit()으로 메시지를 흘리고, 제어 메서드는 vi.fn으로 기록한다. */
export class FakeQuery {
  readonly sent: unknown[] = [];
  private readonly queue: unknown[] = [];
  private waiter: ((r: IteratorResult<unknown>) => void) | null = null;
  private rejecter: ((e: unknown) => void) | null = null;
  private finished = false;

  interrupt = vi.fn(async () => undefined);
  setModel = vi.fn(async (_model?: string) => undefined);
  setPermissionMode = vi.fn(async (_mode: string) => undefined);
  applyFlagSettings = vi.fn(async (_settings: Record<string, unknown>) => undefined);
  getContextUsage = vi.fn(async () => ({ percentage: 42 }));
  supportedCommands = vi.fn(async () => [{ name: 'ingest', description: 'raw/ 신규 자료 ingest', argumentHint: '' }]);
  supportedModels = vi.fn(async () => []);
  close = vi.fn(() => this.end());

  constructor(readonly params: Params) {
    const prompt = params.prompt;
    if (typeof prompt !== 'string') {
      void (async () => {
        for await (const m of prompt) this.sent.push(m);
      })();
    }
  }

  emit(msg: unknown): void {
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  end(): void {
    this.finished = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      this.rejecter = null;
      w({ value: undefined, done: true });
    }
  }

  /** 대기 중인 next()를 예외로 끝낸다 (스트림 도중 프로세스 종료 흉내). */
  fail(err: unknown): void {
    const r = this.rejecter;
    this.waiter = null;
    this.rejecter = null;
    r?.(err);
  }

  next(): Promise<IteratorResult<unknown>> {
    if (this.queue.length > 0) return Promise.resolve({ value: this.queue.shift(), done: false });
    if (this.finished) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve, reject) => {
      this.waiter = resolve;
      this.rejecter = reject;
    });
  }

  async return(): Promise<IteratorResult<unknown>> {
    this.end();
    return { value: undefined, done: true };
  }

  [Symbol.asyncIterator](): this {
    return this;
  }
}

export function fakeQueryFn(): { fn: QueryFn; calls: FakeQuery[] } {
  const calls: FakeQuery[] = [];
  const fn = ((params: Params) => {
    const q = new FakeQuery(params);
    calls.push(q);
    return q as unknown as Query;
  }) as unknown as QueryFn;
  return { fn, calls };
}

export const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
