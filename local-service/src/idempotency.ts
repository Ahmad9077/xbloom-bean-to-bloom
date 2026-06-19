import type { JobResult } from "./types.js";

interface Entry {
  result: JobResult;
  expiresAt: number;
}

export class IdempotencyStore {
  private readonly store = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<JobResult>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): JobResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(key: string, result: JobResult): void {
    this.store.set(key, { result, expiresAt: Date.now() + this.ttlMs });
    this.pending.delete(key);
  }

  getPending(key: string): Promise<JobResult> | undefined {
    return this.pending.get(key);
  }

  // Register an in-flight job promise for coalescing concurrent identical keys.
  // On failure the pending entry is cleared here so the key can be retried.
  // On success, set() is responsible for clearing pending; doing it only there
  // prevents a gap window where neither pending nor store holds the entry.
  setPending(key: string, promise: Promise<JobResult>): void {
    this.pending.set(key, promise);
    promise.catch(() => {
      if (this.pending.get(key) === promise) {
        this.pending.delete(key);
      }
    });
  }

  prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (now > v.expiresAt) this.store.delete(k);
    }
  }
}
