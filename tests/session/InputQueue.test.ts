import { describe, expect, it } from 'vitest';
import { InputQueue } from '../../src/session/InputQueue';

describe('InputQueue', () => {
  it('먼저 넣은 값과 나중에 넣은 값을 순서대로 내보내고 end로 끝난다', async () => {
    const q = new InputQueue<number>();
    q.push(1);
    const it = q[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: 1, done: false });
    const pending = it.next();
    q.push(2);
    expect(await pending).toEqual({ value: 2, done: false });
    const last = it.next();
    q.end();
    expect(await last).toEqual({ value: undefined, done: true });
    expect(q.isEnded).toBe(true);
  });

  it('끝난 큐에 넣으면 예외', () => {
    const q = new InputQueue<number>();
    q.end();
    expect(() => q.push(1)).toThrow();
  });
});
