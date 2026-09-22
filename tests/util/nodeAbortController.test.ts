import { setMaxListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

describe('Node AbortController in Electron', () => {
  it('ignores the renderer constructor and supports Node listeners and cancellation', async () => {
    class RendererAbortController {
      constructor() { throw new Error('Renderer constructor must not be used'); }
    }
    vi.stubGlobal('AbortController', RendererAbortController);
    const { AbortController } = await import('../../src/util/nodeAbortController');
    const controller = new AbortController();
    const other = new AbortController();
    expect(() => setMaxListeners(50, controller.signal)).not.toThrow();
    const listener = vi.fn();
    controller.signal.addEventListener('abort', listener);
    const reason = new Error('cancelled');
    controller.abort(reason);
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(reason);
    expect(listener).toHaveBeenCalledOnce();
    expect(other.signal.aborted).toBe(false);
    expect(globalThis.AbortController).toBe(RendererAbortController);
  });
});
