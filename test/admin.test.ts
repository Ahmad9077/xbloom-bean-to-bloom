/**
 * Admin API tests: user management, self-protection, authorization.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import {
  COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "../src/auth/session.js";
import { createSession, createUser } from "../src/db.js";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";
import { makeTestDb } from "./db-mock.js";
import { MOCK_ENV } from "./fixtures.js";

let db: ReturnType<typeof makeTestDb>;

function makeEnv(): Env {
  return { ...MOCK_ENV, DB: db } as unknown as Env;
}

beforeEach(() => {
  db = makeTestDb();
});
afterEach(() => {
  db.close();
});

async function createTestUser(opts: {
  username: string;
  password?: string;
  role?: "admin" | "user";
  isPrimary?: boolean;
  enabled?: boolean;
}) {
  const id = crypto.randomUUID();
  const hash = await hashPassword(opts.password ?? "SecurePass123!");
  await createUser(db, {
    id,
    usernameDisplay: opts.username,
    usernameNormalized: opts.username.toLowerCase(),
    passwordHash: hash,
    role: opts.role ?? "user",
    isPrimary: opts.isPrimary ?? false,
  });
  if (opts.enabled === false) {
    await db.prepare("UPDATE users SET enabled = 0 WHERE id = ?").bind(id).run();
  }
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  await createSession(db, {
    tokenHash,
    userId: id,
    authVersion: 0,
    expiresAt: sessionExpiresAt(),
  });
  return { id, token, cookieHeader: `${COOKIE_NAME}=${token}` };
}

// ---------------------------------------------------------------------------
// Authorization: non-admin cannot access admin routes
// ---------------------------------------------------------------------------

describe("admin authorization — regular user denied", () => {
  it("GET /api/admin/users returns 403 for regular user", async () => {
    const { cookieHeader } = await createTestUser({ username: "user1", role: "user" });
    const req = new Request("http://localhost/api/admin/users", {
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/users returns 403 for regular user", async () => {
    const { cookieHeader } = await createTestUser({ username: "user1", role: "user" });
    const req = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ username: "newuser", password: "SecurePass123!", role: "user" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("admin routes return 401 with no session", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/admin/users"), makeEnv());
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe("GET /api/admin/users", () => {
  it("returns user list without password hashes", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    await createTestUser({ username: "user2", role: "user" });

    const req = new Request("http://localhost/api/admin/users", {
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; users: Array<Record<string, unknown>> };
    expect(body.ok).toBe(true);
    expect(body.users.length).toBeGreaterThanOrEqual(2);
    for (const u of body.users) {
      expect(u.password_hash).toBeUndefined();
      expect(u.passwordHash).toBeUndefined();
      expect(typeof u.username).toBe("string");
      expect(typeof u.recipeCount).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users — create user
// ---------------------------------------------------------------------------

describe("POST /api/admin/users — create", () => {
  it("creates a user and returns id + username", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ username: "newuser", password: "SecurePass999#", role: "user" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const user = body.user as Record<string, unknown>;
    expect(user.username).toBe("newuser");
    expect(user.role).toBe("user");
    expect(typeof user.id).toBe("string");
  });

  it("returns 409 for duplicate username", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    await createTestUser({ username: "existing" });
    const req = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ username: "existing", password: "SecurePass999#" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(409);
  });

  it("returns 400 for password shorter than four characters", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ username: "newuser2", password: "abc" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing username", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ password: "SecurePass999#" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id — password reset, enable/disable, role change
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/users/:id", () => {
  it("can reset another user's password", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const { id: uid2 } = await createTestUser({ username: "user2" });
    const req = new Request(`http://localhost/api/admin/users/${uid2}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ password: "NewSecurePass999#" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
  });

  it("disabling a user invalidates their sessions", async () => {
    const { cookieHeader: adminCookie } = await createTestUser({
      username: "admin1",
      role: "admin",
    });
    const { id: uid2, cookieHeader: user2Cookie } = await createTestUser({ username: "user2" });

    // Disable user2
    const patchReq = new Request(`http://localhost/api/admin/users/${uid2}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ enabled: false }),
    });
    await worker.fetch(patchReq, makeEnv());

    // user2's session should now be invalid
    const meReq = new Request("http://localhost/api/auth/me", {
      headers: { Cookie: user2Cookie },
    });
    const meRes = await worker.fetch(meReq, makeEnv());
    expect(meRes.status).toBe(401);
  });

  it("can re-enable a disabled user", async () => {
    const { cookieHeader: adminCookie } = await createTestUser({
      username: "admin1",
      role: "admin",
    });
    const { id: uid2 } = await createTestUser({ username: "user2", enabled: false });

    const req = new Request(`http://localhost/api/admin/users/${uid2}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ enabled: true }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);

    const row = await db
      .prepare("SELECT enabled FROM users WHERE id = ?")
      .bind(uid2)
      .first<{ enabled: number }>();
    expect(row?.enabled).toBe(1);
  });

  it("returns 404 for non-existent user ID", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request(`http://localhost/api/admin/users/${crypto.randomUUID()}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ enabled: false }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("validates the entire patch before changing any field", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const { id: uid2 } = await createTestUser({ username: "user2" });
    const before = await db
      .prepare("SELECT password_hash, auth_version FROM users WHERE id = ?")
      .bind(uid2)
      .first<{ password_hash: string; auth_version: number }>();

    const res = await worker.fetch(
      new Request(`http://localhost/api/admin/users/${uid2}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieHeader },
        body: JSON.stringify({ password: "NewSecurePass999#", role: "owner" }),
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);

    const after = await db
      .prepare("SELECT password_hash, auth_version FROM users WHERE id = ?")
      .bind(uid2)
      .first<{ password_hash: string; auth_version: number }>();
    expect(after).toEqual(before);
  });

  it("rejects empty and unknown-field patches", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const { id: uid2 } = await createTestUser({ username: "user2" });
    for (const body of [{}, { username: "renamed" }]) {
      const res = await worker.fetch(
        new Request(`http://localhost/api/admin/users/${uid2}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: cookieHeader },
          body: JSON.stringify(body),
        }),
        makeEnv(),
      );
      expect(res.status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id
// ---------------------------------------------------------------------------

describe("DELETE /api/admin/users/:id", () => {
  it("deletes a regular user", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const { id: uid2 } = await createTestUser({ username: "user2" });
    const req = new Request(`http://localhost/api/admin/users/${uid2}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);

    const row = await db.prepare("SELECT id FROM users WHERE id = ?").bind(uid2).first();
    expect(row).toBeNull();
  });

  it("returns 404 for non-existent user", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request(`http://localhost/api/admin/users/${crypto.randomUUID()}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Primary admin self-protection
// ---------------------------------------------------------------------------

describe("primary admin self-protection", () => {
  it("primary admin cannot disable themselves", async () => {
    const { id: adminId, cookieHeader } = await createTestUser({
      username: "primaryadmin",
      role: "admin",
      isPrimary: true,
    });
    // Set is_primary manually (createUser doesn't set via DB fixture, let's set it directly)
    await db.prepare("UPDATE users SET is_primary = 1 WHERE id = ?").bind(adminId).run();

    const req = new Request(`http://localhost/api/admin/users/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ enabled: false }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("primary admin cannot change their own role to user", async () => {
    const { id: adminId, cookieHeader } = await createTestUser({
      username: "primaryadmin",
      role: "admin",
      isPrimary: true,
    });
    await db.prepare("UPDATE users SET is_primary = 1 WHERE id = ?").bind(adminId).run();

    const req = new Request(`http://localhost/api/admin/users/${adminId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ role: "user" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });

  it("primary admin cannot delete themselves", async () => {
    const { id: adminId, cookieHeader } = await createTestUser({
      username: "primaryadmin",
      role: "admin",
      isPrimary: true,
    });
    await db.prepare("UPDATE users SET is_primary = 1 WHERE id = ?").bind(adminId).run();

    const req = new Request(`http://localhost/api/admin/users/${adminId}`, {
      method: "DELETE",
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Response never exposes password hash
// ---------------------------------------------------------------------------

describe("admin response never exposes hashes", () => {
  it("user list does not contain any password_hash fields", async () => {
    const { cookieHeader } = await createTestUser({ username: "admin1", role: "admin" });
    const req = new Request("http://localhost/api/admin/users", {
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    const text = await res.text();
    expect(text).not.toContain("password_hash");
    expect(text).not.toContain("pbkdf2");
  });
});
