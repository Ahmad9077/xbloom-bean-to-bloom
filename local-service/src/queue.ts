import { ErrorCode, ServiceError } from "./errors.js";

type Job<T> = () => Promise<T>;

export class SerialQueue {
  private running = false;
  private readonly pending: Array<() => void> = [];
  private readonly maxPending: number;

  constructor(maxPending = 10) {
    this.maxPending = maxPending;
  }

  async run<T>(job: Job<T>): Promise<T> {
    if (this.pending.length >= this.maxPending) {
      throw new ServiceError(ErrorCode.QUEUE_FULL, "Too many concurrent recipe jobs", 503);
    }

    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        this.running = true;
        try {
          resolve(await job());
        } catch (err) {
          reject(err);
        } finally {
          this.running = false;
          const next = this.pending.shift();
          if (next) next();
        }
      };

      if (!this.running) {
        execute().catch(() => {});
      } else {
        this.pending.push(() => execute().catch(() => {}));
      }
    });
  }

  get depth(): number {
    return this.pending.length + (this.running ? 1 : 0);
  }
}
