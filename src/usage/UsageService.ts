import { parseAccountUsage, parseLimitAlert, type AccountUsage, type LimitAlert } from './accountUsage';
import { UsageUnsupported } from './readUsage';

export const USAGE_TTL = 60_000;
export interface UsageState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';
  data: AccountUsage | null;
  checkedAt: number | null;
  error: string | null;
  alert: LimitAlert | null;
  alertAt: number | null;
}

/** One cache/request per plugin instance, shared by every panel in this vault. */
export class UsageService {
  state: UsageState = { status: 'idle', data: null, checkedAt: null, error: null, alert: null, alertAt: null };
  private readonly listeners = new Set<() => void>();
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private nextAttempt = 0;
  private failures = 0;
  private disposed = false;
  private generation = 0;
  private alertRevision = 0;

  constructor(private readonly read: (signal: AbortSignal) => Promise<unknown>, private readonly now = Date.now) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    listener();
    return () => this.listeners.delete(listener);
  }

  isStale(): boolean {
    const { checkedAt, data } = this.state;
    return checkedAt === null || this.now() - checkedAt >= USAGE_TTL ||
      !!data?.rows.some(r => r.resetsAt !== null && r.resetsAt <= this.now());
  }

  refresh(force = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.pending) return this.pending;
    if (!force && (this.now() < this.nextAttempt || !this.isStale())) return Promise.resolve();
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    const alertRevision = this.alertRevision;
    this.state = { ...this.state, status: 'loading', error: null };
    // Defer the request so synchronous reads and listeners cannot race pending.
    this.pending = Promise.resolve().then(async () => {
      try {
        const data = parseAccountUsage(await this.read(controller.signal));
        if (this.disposed || generation !== this.generation) return;
        this.state = { ...this.state, data, checkedAt: this.now(), status: data.available ? 'ready' : 'unsupported', error: null,
          ...(this.alertRevision === alertRevision ? { alert: null, alertAt: null } : {}) };
        this.failures = 0;
        this.nextAttempt = this.now() + USAGE_TTL;
      } catch (error) {
        if (this.disposed || generation !== this.generation) return;
        const unsupported = error instanceof UsageUnsupported;
        this.state = { ...this.state, status: unsupported ? 'unsupported' : 'error', error: error instanceof Error ? error.message : String(error),
          ...(unsupported ? { data: null, checkedAt: null } : {}) };
        this.failures++;
        this.nextAttempt = this.now() + Math.min(USAGE_TTL * 2 ** (this.failures - 1), 300_000);
      } finally {
        if (generation === this.generation) {
          this.pending = null;
          this.controller = null;
          if (!this.disposed) this.emit();
        }
      }
    });
    this.emit();
    return this.pending;
  }

  onRateLimit(raw: unknown): void {
    const alert = parseLimitAlert(raw);
    if (!alert) return;
    this.alertRevision++;
    this.state = { ...this.state, alert, alertAt: this.now() };
    this.emit();
    void this.refresh();
  }

  reset(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.pending = null;
    this.nextAttempt = 0;
    this.failures = 0;
    this.state = { status: 'idle', data: null, checkedAt: null, error: null, alert: null, alertAt: null };
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.listeners.clear();
  }

  private emit(): void { for (const listener of this.listeners) listener(); }
}
