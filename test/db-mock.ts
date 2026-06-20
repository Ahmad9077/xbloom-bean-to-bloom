import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * In-memory D1-compatible database for tests.
 * Wraps better-sqlite3 with the D1 API surface used by src/db.ts.
 * Applies the project migration SQL so all tables exist.
 */
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(join(__dirname, "../migrations/0001_auth_recipes.sql"), "utf8");

// ---------------------------------------------------------------------------
// D1PreparedStatement shim
// ---------------------------------------------------------------------------

type BsqStatement = ReturnType<Database.Database["prepare"]>;

class D1Statement {
  private stmt: BsqStatement;
  private bindings: unknown[] = [];

  constructor(stmt: BsqStatement) {
    this.stmt = stmt;
  }

  bind(...values: unknown[]): D1Statement {
    const copy = new D1Statement(this.stmt);
    copy.bindings = values;
    return copy;
  }

  first<T = unknown>(_colName?: string): Promise<T | null> {
    // biome-ignore lint/suspicious/noExplicitAny: need variadic call
    const row = (this.stmt as any).get(...this.bindings);
    return Promise.resolve((row as T | undefined) ?? null);
  }

  all<T = unknown>(): Promise<D1Result<T>> {
    // biome-ignore lint/suspicious/noExplicitAny: need variadic call
    const rows = (this.stmt as any).all(...this.bindings);
    return Promise.resolve({
      results: rows as T[],
      success: true,
      meta: { duration: 0, rows_read: rows.length, rows_written: 0 },
    } as D1Result<T>);
  }

  run<T = unknown>(): Promise<D1Result<T>> {
    // biome-ignore lint/suspicious/noExplicitAny: need variadic call
    const info = (this.stmt as any).run(...this.bindings) as {
      changes: number;
      lastInsertRowid: number | bigint;
    };
    return Promise.resolve({
      results: [] as T[],
      success: true,
      meta: {
        duration: 0,
        last_row_id: Number(info.lastInsertRowid),
        changes: info.changes,
        rows_read: 0,
        rows_written: info.changes,
      },
    } as D1Result<T>);
  }

  raw<T = unknown[]>(): Promise<T[]> {
    // biome-ignore lint/suspicious/noExplicitAny: need variadic call
    const rows = (this.stmt.raw(true) as any).all(...this.bindings);
    return Promise.resolve(rows as T[]);
  }
}

// ---------------------------------------------------------------------------
// D1Database shim — implements the subset used by src/db.ts
// ---------------------------------------------------------------------------

class InMemoryD1 {
  private db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.exec(MIGRATION_SQL);
  }

  prepare(sql: string): D1PreparedStatement {
    const stmt = this.db.prepare(sql);
    return new D1Statement(stmt) as unknown as D1PreparedStatement;
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error("dump() not implemented in test mock");
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const stmt of statements) {
      results.push(await (stmt as unknown as D1Statement).run<T>());
    }
    return results;
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.db.exec(query);
    return { count: 1, duration: 0 };
  }

  withSession(_sessionId: string): D1DatabaseSession {
    return {
      prepare: (sql: string) => this.prepare(sql),
      dump: () => this.dump(),
      batch: (stmts: D1PreparedStatement[]) => this.batch(stmts),
      exec: (query: string) => this.exec(query),
      withSession: (_id: string) => this.withSession(_id),
      getBookmark: () => Promise.resolve(null),
    } as unknown as D1DatabaseSession;
  }

  close(): void {
    this.db.close();
  }
}

export type TestDb = D1Database & { close(): void };

export function makeTestDb(): TestDb {
  return new InMemoryD1() as unknown as TestDb;
}
