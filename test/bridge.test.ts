/**
 * Bridge queue tests: job creation, claim, completion, auth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import {
  COOKIE_NAME,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "../src/auth/session.js";
import { createSession, createUser, storeRecipe } from "../src/db.js";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";
import { makeTestDb } from "./db-mock.js";
import { MOCK_ENV } from "./fixtures.js";

vi.stubGlobal("fetch", vi.fn());

let db: ReturnType<typeof makeTestDb>;

// SHA-256 of "test-bridge-token"
const BRIDGE_TOKEN = "test-bridge-token-12345678901";
let BRIDGE_TOKEN_HASH: string;

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function makeEnv(extras: Record<string, unknown> = {}): Env {
  return { ...MOCK_ENV, DB: db, BRIDGE_TOKEN_HASH, ...extras } as unknown as Env;
}

beforeEach(async () => {
  db = makeTestDb();
  BRIDGE_TOKEN_HASH = await hashToken(BRIDGE_TOKEN);
});
afterEach(() => {
  db.close();
});

async function createTestSession(username = "alice") {
  const id = crypto.randomUUID();
  const hash = await hashPassword("SecurePass123!");
  await createUser(db, {
    id,
    usernameDisplay: username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: hash,
    role: "user",
    isPrimary: false,
  });
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

async function createTestRecipe(ownerId: string) {
  const id = crypto.randomUUID();
  await storeRecipe(db, {
    id,
    ownerId,
    fullName: "Alice – Ethiopia",
    beanName: "Ethiopia",
    recipeJson: JSON.stringify({ name: "Alice – Ethiopia", machine: "xBloom Studio" }),
  });
  return id;
}

// ---------------------------------------------------------------------------
// POST /api/recipes/:id/bridge-jobs — create job
// ---------------------------------------------------------------------------

describe("POST /api/recipes/:id/bridge-jobs — create", () => {
  it("creates a bridge job and returns pending status", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    const req = new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
      method: "POST",
      headers: { Cookie: cookieHeader },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const job = body.job as Record<string, unknown>;
    expect(job.status).toBe("pending");
    expect(job.recipeId).toBe(recipeId);
  });

  it("is idempotent: second POST returns the same job", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    const makeReq = () =>
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

    const res1 = await worker.fetch(makeReq(), makeEnv());
    const res2 = await worker.fetch(makeReq(), makeEnv());
    const b1 = (await res1.json()) as Record<string, unknown>;
    const b2 = (await res2.json()) as Record<string, unknown>;
    expect((b1.job as Record<string, unknown>).id).toBe((b2.job as Record<string, unknown>).id);
  });

  it("requeues a failed job when the owner tries again", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);
    const makeReq = () =>
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      });

    const created = (await (await worker.fetch(makeReq(), makeEnv())).json()) as {
      job: { id: string };
    };
    await db
      .prepare(
        "UPDATE bridge_jobs SET status = 'failed', attempts = 3, safe_error = 'Previous failure', completed_at = ? WHERE id = ?",
      )
      .bind(Date.now(), created.job.id)
      .run();

    const retried = (await (await worker.fetch(makeReq(), makeEnv())).json()) as {
      job: { id: string; status: string; attempts: number; safeError: string | null };
    };
    expect(retried.job).toMatchObject({
      id: created.job.id,
      status: "pending",
      attempts: 0,
      safeError: null,
    });
  });

  it("returns 404 for recipe belonging to another user", async () => {
    const { id: uid1 } = await createTestSession("alice");
    const { cookieHeader: user2Cookie } = await createTestSession("bob");
    const recipeId = await createTestRecipe(uid1);

    const req = new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
      method: "POST",
      headers: { Cookie: user2Cookie },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 401 without session", async () => {
    const { id } = await createTestSession();
    const recipeId = await createTestRecipe(id);
    const res = await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, { method: "POST" }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /api/recipes/:id/bridge-jobs — status
// ---------------------------------------------------------------------------

describe("GET /api/recipes/:id/bridge-jobs — status", () => {
  it("returns job status after creation", async () => {
    const { id, cookieHeader, token } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    // Create job
    await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
      makeEnv(),
    );

    // Poll status
    const req = new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.job as Record<string, unknown>).status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// GET /api/bridge/jobs/next — bridge claim
// ---------------------------------------------------------------------------

describe("GET /api/bridge/jobs/next — bridge claim", () => {
  it("returns null when no pending jobs", async () => {
    const req = new Request("http://localhost/api/bridge/jobs/next", {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.job).toBeNull();
  });

  it("returns 403 without bridge token", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/bridge/jobs/next"), makeEnv());
    expect(res.status).toBe(403);
  });

  it("returns 403 with wrong bridge token", async () => {
    const res = await worker.fetch(
      new Request("http://localhost/api/bridge/jobs/next", {
        headers: { Authorization: "Bearer wrong-token" },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(403);
  });

  it("claims a pending job and returns recipe JSON", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    // Create bridge job
    await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
      makeEnv(),
    );

    // Claim
    const req = new Request("http://localhost/api/bridge/jobs/next", {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const job = body.job as Record<string, unknown>;
    expect(job.status).toBe("claimed");
    expect(job.recipeId).toBe(recipeId);
    expect(job.recipe).toBeDefined();
    const recipe = job.recipe as Record<string, unknown>;
    expect(recipe.machine).toBe("xBloom Studio");
  });

  it("does not return image bytes in the recipe JSON (images are ephemeral)", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
      makeEnv(),
    );

    const req = new Request("http://localhost/api/bridge/jobs/next", {
      headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
    });
    const res = await worker.fetch(req, makeEnv());
    const text = await res.text();
    expect(text).not.toContain("data:image");
  });
});

// ---------------------------------------------------------------------------
// POST /api/bridge/jobs/:id/complete
// ---------------------------------------------------------------------------

describe("POST /api/bridge/jobs/:id/complete", () => {
  it("completes a claimed job with status completed", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    // Create + claim job
    await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
      makeEnv(),
    );
    const claimRes = await worker.fetch(
      new Request("http://localhost/api/bridge/jobs/next", {
        headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
      }),
      makeEnv(),
    );
    const claimBody = (await claimRes.json()) as Record<string, unknown>;
    const jobId = (claimBody.job as Record<string, unknown>).id as string;

    // Complete
    const completeReq = new Request(`http://localhost/api/bridge/jobs/${jobId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({
        status: "completed",
        shareLink: "https://share-h5.xbloom.com/?id=official-test",
      }),
    });
    const completeRes = await worker.fetch(completeReq, makeEnv());
    expect(completeRes.status).toBe(200);

    // Job status should now be completed
    const row = await db
      .prepare("SELECT status, share_link FROM bridge_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ status: string; share_link: string }>();
    expect(row?.status).toBe("completed");
    expect(row?.share_link).toBe("https://share-h5.xbloom.com/?id=official-test");
  });

  it("marks job as failed with safeError", async () => {
    const { id, cookieHeader } = await createTestSession();
    const recipeId = await createTestRecipe(id);

    await worker.fetch(
      new Request(`http://localhost/api/recipes/${recipeId}/bridge-jobs`, {
        method: "POST",
        headers: { Cookie: cookieHeader },
      }),
      makeEnv(),
    );
    const claimRes = await worker.fetch(
      new Request("http://localhost/api/bridge/jobs/next", {
        headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
      }),
      makeEnv(),
    );
    const claimBody = (await claimRes.json()) as Record<string, unknown>;
    const jobId = (claimBody.job as Record<string, unknown>).id as string;

    const completeReq = new Request(`http://localhost/api/bridge/jobs/${jobId}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({ status: "failed", safeError: "Appium connection refused" }),
    });
    const completeRes = await worker.fetch(completeReq, makeEnv());
    expect(completeRes.status).toBe(200);

    const row = await db
      .prepare("SELECT status, safe_error FROM bridge_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ status: string; safe_error: string }>();
    expect(row?.status).toBe("failed");
    expect(row?.safe_error).toBe("Appium connection refused");
  });

  it("returns 404 for job not in claimed state", async () => {
    const req = new Request(`http://localhost/api/bridge/jobs/${crypto.randomUUID()}/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${BRIDGE_TOKEN}`,
      },
      body: JSON.stringify({ status: "completed" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 403 without bridge token", async () => {
    const req = new Request(`http://localhost/api/bridge/jobs/${crypto.randomUUID()}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});
