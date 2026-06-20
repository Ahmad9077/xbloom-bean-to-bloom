/**
 * Auth tests: login, logout, session expiry, throttle, me endpoint.
 *
 * Uses InMemoryD1 (better-sqlite3 backed) so all DB behavior is real SQL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import {
  COOKIE_NAME,
  buildSessionCookie,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "../src/auth/session.js";
import { createSession, createUser } from "../src/db.js";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";
import { makeTestDb } from "./db-mock.js";
import { MOCK_ENV } from "./fixtures.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

let db: ReturnType<typeof makeTestDb>;

function makeEnv(extras: Record<string, unknown> = {}): Env {
  return { ...MOCK_ENV, DB: db, ...extras } as unknown as Env;
}

beforeEach(() => {
  db = makeTestDb();
});
afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Helper: create a test user
// ---------------------------------------------------------------------------

async function createTestUser(
  opts: {
    username?: string;
    password?: string;
    role?: "admin" | "user";
    enabled?: boolean;
    isPrimary?: boolean;
  } = {},
) {
  const username = opts.username ?? "testuser";
  const password = opts.password ?? "SecureP@ssword123";
  const role = opts.role ?? "user";
  const enabled = opts.enabled ?? true;
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await createUser(db, {
    id,
    usernameDisplay: username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: hash,
    role,
    isPrimary: opts.isPrimary ?? false,
  });
  if (!enabled) {
    await db
      .prepare("UPDATE users SET enabled = 0, auth_version = auth_version + 1 WHERE id = ?")
      .bind(id)
      .run();
  }
  return { id, username, password };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login — success
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — success", () => {
  it("returns 200 with user info on valid credentials", async () => {
    const { username, password } = await createTestUser();
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const user = body.user as Record<string, unknown>;
    expect(user.username).toBe(username);
    expect(user.role).toBe("user");
    expect(typeof user.id).toBe("string");
  });

  it("sets __Host-xbloom_session cookie on success", async () => {
    const { username, password } = await createTestUser();
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toMatch(/^__Host-xbloom_session=/);
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("login is case-insensitive for username", async () => {
    await createTestUser({ username: "Alice" });
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "ALICE", password: "SecureP@ssword123" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login — wrong credentials
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — wrong credentials", () => {
  it("returns 401 for wrong password", async () => {
    const { username } = await createTestUser();
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password: "WrongPassword999!" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for wrong username (same generic message)", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "nonexistent", password: "SecureP@ssword123" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).message).toBe("Invalid username or password");
  });

  it("wrong username and wrong password produce identical error message", async () => {
    const { username } = await createTestUser();
    const wrongPwReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password: "WrongPassword999!" }),
    });
    const wrongUserReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username: "noexist", password: "SecureP@ssword123" }),
    });
    const res1 = await worker.fetch(wrongPwReq, makeEnv());
    const res2 = await worker.fetch(wrongUserReq, makeEnv());
    const b1 = (await res1.json()) as Record<string, unknown>;
    const b2 = (await res2.json()) as Record<string, unknown>;
    const msg1 = (b1.error as Record<string, unknown>).message;
    const msg2 = (b2.error as Record<string, unknown>).message;
    expect(msg1).toBe(msg2);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login — disabled account
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — disabled account", () => {
  it("returns 401 for disabled user (same generic message)", async () => {
    const { username, password } = await createTestUser({ enabled: false });
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).message).toBe("Invalid username or password");
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login — rate limiting (throttle)
// ---------------------------------------------------------------------------

describe("POST /api/auth/login — throttle", () => {
  it("returns 429 after 5 consecutive failed attempts", async () => {
    const { username } = await createTestUser();
    const badReq = () =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ username, password: "wrong-password!" }),
      });

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      await worker.fetch(badReq(), makeEnv());
    }

    // 6th attempt → 429
    const res = await worker.fetch(badReq(), makeEnv());
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.error as Record<string, unknown>).code).toBe("TOO_MANY_REQUESTS");
  });

  it("throttle message does not reveal internal details", async () => {
    const { username } = await createTestUser();
    const badReq = () =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ username, password: "wrong-password!" }),
      });

    for (let i = 0; i < 5; i++) await worker.fetch(badReq(), makeEnv());
    const res = await worker.fetch(badReq(), makeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    const msg = (body.error as Record<string, unknown>).message as string;
    expect(msg).not.toMatch(/sql|db|hash|token/i);
  });

  it("rate limits malformed usernames instead of allowing an unbounded bypass", async () => {
    const badReq = () =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost",
          "CF-Connecting-IP": "192.0.2.10",
        },
        body: JSON.stringify({ username: "<invalid>", password: "wrong-password!" }),
      });

    for (let i = 0; i < 5; i++) expect((await worker.fetch(badReq(), makeEnv())).status).toBe(401);
    expect((await worker.fetch(badReq(), makeEnv())).status).toBe(429);
  });

  it("clears failed-attempt history after a successful login", async () => {
    const { username, password } = await createTestUser();
    const request = (candidate: string) =>
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ username, password: candidate }),
      });

    for (let i = 0; i < 4; i++)
      expect((await worker.fetch(request("wrong!"), makeEnv())).status).toBe(401);
    expect((await worker.fetch(request(password), makeEnv())).status).toBe(200);
    for (let i = 0; i < 5; i++)
      expect((await worker.fetch(request("wrong!"), makeEnv())).status).toBe(401);
    expect((await worker.fetch(request("wrong!"), makeEnv())).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout", () => {
  it("returns 200 even with no session cookie", async () => {
    const req = new Request("http://localhost/api/auth/logout", { method: "POST" });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it("sets expired cookie on logout", async () => {
    const req = new Request("http://localhost/api/auth/logout", { method: "POST" });
    const res = await worker.fetch(req, makeEnv());
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toContain("__Host-xbloom_session=");
  });

  it("invalidates the session so subsequent /me returns 401", async () => {
    const { username, password } = await createTestUser();

    // Login
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const loginRes = await worker.fetch(loginReq, makeEnv());
    const sessionCookie = loginRes.headers.get("Set-Cookie") ?? "";
    const token = sessionCookie.match(/^__Host-xbloom_session=([^;]+)/)?.[1] ?? "";

    // Logout
    const logoutReq = new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    await worker.fetch(logoutReq, makeEnv());

    // /me should now 401
    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const meRes = await worker.fetch(meReq, makeEnv());
    expect(meRes.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe("GET /api/auth/me", () => {
  it("returns 401 when no session cookie", async () => {
    const req = new Request("http://localhost/api/auth/me");
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns 200 with user info for valid session", async () => {
    const { id, username, password } = await createTestUser();

    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const loginRes = await worker.fetch(loginReq, makeEnv());
    const sessionCookie = loginRes.headers.get("Set-Cookie") ?? "";
    const token = sessionCookie.match(/^__Host-xbloom_session=([^;]+)/)?.[1] ?? "";

    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const meRes = await worker.fetch(meReq, makeEnv());
    expect(meRes.status).toBe(200);
    const body = (await meRes.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const user = body.user as Record<string, unknown>;
    expect(user.id).toBe(id);
    expect(user.username).toBe(username);
    expect(user.role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------

describe("session expiry", () => {
  it("returns 401 for expired session", async () => {
    const { id } = await createTestUser();

    // Create a session that expired 1 second ago
    const token = generateSessionToken();
    const tokenHash = await hashSessionToken(token);
    await createSession(db, {
      tokenHash,
      userId: id,
      authVersion: 0,
      expiresAt: Date.now() - 1000,
    });

    const req = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it("deletes expired session row from DB on access", async () => {
    const { id } = await createTestUser();
    const token = generateSessionToken();
    const tokenHash = await hashSessionToken(token);
    await createSession(db, {
      tokenHash,
      userId: id,
      authVersion: 0,
      expiresAt: Date.now() - 1000,
    });

    const req = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    await worker.fetch(req, makeEnv());

    // Session should be gone
    const row = await db
      .prepare("SELECT * FROM sessions WHERE token_hash = ?")
      .bind(tokenHash)
      .first();
    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// auth_version invalidation
// ---------------------------------------------------------------------------

describe("auth_version invalidation", () => {
  it("returns 401 when auth_version has been incremented (password changed)", async () => {
    const { id, username, password } = await createTestUser();

    // Login normally
    const loginReq = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://localhost" },
      body: JSON.stringify({ username, password }),
    });
    const loginRes = await worker.fetch(loginReq, makeEnv());
    const cookie = loginRes.headers.get("Set-Cookie") ?? "";
    const token = cookie.match(/^__Host-xbloom_session=([^;]+)/)?.[1] ?? "";

    // Simulate password change: increment auth_version
    await db
      .prepare("UPDATE users SET auth_version = auth_version + 1 WHERE id = ?")
      .bind(id)
      .run();

    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const meRes = await worker.fetch(meReq, makeEnv());
    expect(meRes.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Protected routes redirect unauthenticated SPA visitors
// ---------------------------------------------------------------------------

describe("SPA protected route redirect", () => {
  it("redirects / to /login when no session cookie and ASSETS present", async () => {
    const mockAssets = {
      fetch: () => new Response("<html>", { status: 200 }),
    };
    const req = new Request("http://localhost/");
    const res = await worker.fetch(req, makeEnv({ ASSETS: mockAssets }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toMatch(/\/login/);
  });

  it("redirects /history to /login when unauthenticated", async () => {
    const mockAssets = { fetch: () => new Response("", { status: 200 }) };
    const req = new Request("http://localhost/history");
    const res = await worker.fetch(req, makeEnv({ ASSETS: mockAssets }));
    expect(res.status).toBe(302);
  });

  it("does not redirect /login itself", async () => {
    const mockAssets = { fetch: () => new Response("<html>login</html>", { status: 200 }) };
    const req = new Request("http://localhost/login");
    const res = await worker.fetch(req, makeEnv({ ASSETS: mockAssets }));
    expect(res.status).toBe(200);
  });

  it("does not redirect static assets (e.g. .js files)", async () => {
    const mockAssets = { fetch: () => new Response("// js", { status: 200 }) };
    const req = new Request("http://localhost/assets/app.js");
    const res = await worker.fetch(req, makeEnv({ ASSETS: mockAssets }));
    expect(res.status).toBe(200);
  });
});
