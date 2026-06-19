import { describe, expect, it } from "vitest";
import { ErrorCode } from "../src/errors.js";
import { SerialQueue } from "../src/queue.js";

describe("SerialQueue", () => {
  it("runs a single job", async () => {
    const q = new SerialQueue();
    const result = await q.run(async () => "done");
    expect(result).toBe("done");
  });

  it("serialises concurrent jobs in order", async () => {
    const q = new SerialQueue();
    const order: number[] = [];

    await Promise.all([
      q.run(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 10));
        order.push(2);
      }),
      q.run(async () => {
        order.push(3);
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it("propagates errors without blocking the queue", async () => {
    const q = new SerialQueue();
    await expect(
      q.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // Queue should still be usable
    const result = await q.run(async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("rejects when queue is full", async () => {
    const q = new SerialQueue(2);
    const pending: Array<() => void> = [];

    // Fill queue with long-running jobs
    const jobs = Array.from({ length: 3 }, () =>
      q
        .run(
          () =>
            new Promise<void>((resolve) => {
              pending.push(resolve);
            }),
        )
        .catch((e) => e),
    );

    // 4th job should be rejected
    const overflow = await q.run(async () => "ok").catch((e) => e);
    expect(overflow).toBeInstanceOf(Error);
    expect((overflow as Error & { code?: string }).code ?? "").toMatch(ErrorCode.QUEUE_FULL);

    // Release each job as the serial queue starts it.
    for (let i = 0; i < jobs.length; i++) {
      while (!pending[i]) {
        await Promise.resolve();
      }
      pending[i]();
    }
    await Promise.allSettled(jobs);
  });

  it("reports correct depth", async () => {
    const q = new SerialQueue();
    expect(q.depth).toBe(0);
    let resolveJob!: () => void;
    const running = q.run(
      () =>
        new Promise<void>((r) => {
          resolveJob = r;
        }),
    );
    // Give the microtask queue a chance to start
    await Promise.resolve();
    expect(q.depth).toBeGreaterThanOrEqual(1);
    resolveJob();
    await running;
    expect(q.depth).toBe(0);
  });
});
