import { transferableAbortController } from 'node:util';

// Electron's renderer global is Chromium's AbortController. The SDK passes its
// signals to Node's events.setMaxListeners(), which requires a Node EventTarget.
// esbuild injects this binding into the bundle without changing window globals.
// Obtain the native constructor so subsequent controllers are ordinary Node ones.
export const AbortController = transferableAbortController().constructor as typeof globalThis.AbortController;
