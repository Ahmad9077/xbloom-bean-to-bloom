import { describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "../src/idempotency.js";
import type { JobResult } from "../src/types.js";

const makeResult = (id: string): JobResult => ({
  ok: true,
  jobId: id,
  requestId: "req-1",
  dryRun: false,
  confirmed: true,
  recipeName: "Test",
  message: "ok",
});

describe("IdempotencyStore", () => {
  it("returns undefined for unknown key", () => {
    const store = new IdempotencyStore(60_000);
    expect(store.get("unknown")).toBeUndefined();
  });

  it("returns cached result after set", () => {
    const store = new IdempotencyStore(60_000);
    const result = makeResult("job-1");
    store.set("key-1", result);
    expect(store.get("key-1")).toEqual(result);
  });

  it("returns undefined after TTL expiry", () => {
    const store = new IdempotencyStore(100);
    store.set("key-2", makeResult("job-2"));

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    expect(store.get("key-2")).toBeUndefined();
    vi.useRealTimers();
  });

  it("prune removes expired entries", () => {
    const store = new IdempotencyStore(100);
    store.set("key-3", makeResult("job-3"));

    vi.useFakeTimers();
    vi.advanceTimersByTime(200);
    store.prune();
    vi.useRealTimers();

    // After prune, should be gone
    expect(store.get("key-3")).toBeUndefined();
  });

  it("second set overwrites first", () => {
    const store = new IdempotencyStore(60_000);
    store.set("key-4", makeResult("job-a"));
    store.set("key-4", makeResult("job-b"));
    expect(store.get("key-4")?.jobId).toBe("job-b");
  });

  it("getPending returns the same promise to coalesce concurrent requests", async () => {
    const store = new IdempotencyStore(60_000);
    let resolve!: (r: JobResult) => void;
    const promise = new Promise<JobResult>((res) => {
      resolve = res;
    });
    store.setPending("key-5", promise);

    expect(store.getPending("key-5")).toBe(promise);
    expect(store.getPending("key-5")).toBe(promise);

    const result = makeResult("job-5");
    resolve(result);
    const [r1, r2] = await Promise.all([promise, promise]);
    expect(r1).toEqual(result);
    expect(r2).toEqual(result);
  });

  it("clears pending on failure so the key can be retried", async () => {
    const store = new IdempotencyStore(60_000);
    let reject!: (err: Error) => void;
    const promise = new Promise<JobResult>((_, rej) => {
      reject = rej;
    });
    store.setPending("key-6", promise);
    expect(store.getPending("key-6")).toBe(promise);

    reject(new Error("boom"));
    await promise.catch(() => {});

    expect(store.getPending("key-6")).toBeUndefined();
    expect(store.get("key-6")).toBeUndefined();
  });

  it("keeps pending until set() is called on success to avoid a replay gap", async () => {
    const store = new IdempotencyStore(60_000);
    let resolve!: (r: JobResult) => void;
    const promise = new Promise<JobResult>((res) => {
      resolve = res;
    });
    store.setPending("key-7", promise);

    const result = makeResult("job-7");
    resolve(result);
    await promise;

    expect(store.getPending("key-7")).toBe(promise);

    store.set("key-7", result);
    expect(store.getPending("key-7")).toBeUndefined();
    expect(store.get("key-7")).toEqual(result);
  });
});
