/** SDK 스트리밍 입력(AsyncIterable<SDKUserMessage>)에 메시지를 밀어 넣는 큐. */
export class InputQueue<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private waiting: ((r: IteratorResult<T>) => void) | null = null;
  private ended = false;

  get isEnded(): boolean {
    return this.ended;
  }

  push(value: T): void {
    if (this.ended) throw new Error('InputQueue: 이미 종료됨');
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value, done: false });
    } else {
      this.buffer.push(value);
    }
  }

  end(): void {
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = null;
      resolve({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.buffer.length > 0) return Promise.resolve({ value: this.buffer.shift() as T, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
