type Level = "info" | "warn" | "error" | "debug";

interface LogEntry {
  ts: string;
  level: Level;
  requestId?: string;
  jobId?: string;
  stage?: string;
  msg: string;
  [key: string]: unknown;
}

function write(level: Level, msg: string, ctx: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  };
  // Write to stderr so stdout stays clean for process supervision
  process.stderr.write(`${JSON.stringify(entry)}\n`);
}

export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => write("debug", msg, ctx),
};
