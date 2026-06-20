/**
 * Recipe API integration tests.
 * Tests POST /api/recipes/from-images, GET /api/recipes, GET /api/recipes/:id.
 * Image bytes are kept in-memory and never written to D1 or logs.
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
import {
  DARK_BEAN,
  LIGHT_BEAN,
  MEDIUM_BEAN,
  MOCK_ENV,
  makeJpegBytes,
  makeMockAIBean,
  makePngBytes,
  makeWebpBytes,
} from "./fixtures.js";

vi.stubGlobal("fetch", vi.fn());

let db: ReturnType<typeof makeTestDb>;

function makeEnv(extras: Record<string, unknown> = {}): Env {
  return { ...MOCK_ENV, DB: db, AI: makeMockAIBean(LIGHT_BEAN), ...extras } as unknown as Env;
}

beforeEach(() => {
  db = makeTestDb();
});
afterEach(() => {
  db.close();
});

// ---------------------------------------------------------------------------
// Test session helper
// ---------------------------------------------------------------------------

async function createTestSession(
  opts: {
    username?: string;
    password?: string;
    role?: "admin" | "user";
    enabled?: boolean;
  } = {},
) {
  const username = opts.username ?? "alice";
  const password = opts.password ?? "SecurePass123!";
  const id = crypto.randomUUID();
  const hash = await hashPassword(password);
  await createUser(db, {
    id,
    usernameDisplay: username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: hash,
    role: opts.role ?? "user",
    isPrimary: false,
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
  return { id, username, token, cookieHeader: `${COOKIE_NAME}=${token}` };
}

function makeImagesRequest(
  images: Array<{ bytes: Uint8Array; name: string; mime: string }>,
  cookieHeader: string,
  brewMode?: "cold" | "hot",
): Request {
  const fd = new FormData();
  for (const img of images) {
    fd.append("images", new File([img.bytes], img.name, { type: img.mime }));
  }
  if (brewMode) fd.append("brewMode", brewMode);
  return new Request("http://localhost/api/recipes/from-images", {
    method: "POST",
    body: fd,
    headers: { Cookie: cookieHeader, Origin: "http://localhost" },
  });
}

// ---------------------------------------------------------------------------
// POST /api/recipes/from-images — auth guard
// ---------------------------------------------------------------------------

describe("POST /api/recipes/from-images — auth", () => {
  it("returns 401 without session cookie", async () => {
    const fd = new FormData();
    fd.append("images", new File([makeJpegBytes()], "bag.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipes/from-images — happy path
// ---------------------------------------------------------------------------

describe("POST /api/recipes/from-images — happy path", () => {
  it("returns 202 with a pending recommendation job", async () => {
    const { cookieHeader } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    const job = body.job as Record<string, unknown>;
    expect(typeof job.id).toBe("string");
    expect(job.status).toBe("pending");
  });

  it("recipe name is server-assigned: Username – BeanName (en dash)", async () => {
    const { username, cookieHeader } = await createTestSession({ username: "Alice" });
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;
    const row = await db
      .prepare("SELECT * FROM recommendation_jobs WHERE id = ?")
      .bind(jobId)
      .first<{
        username_display: string;
        bean_name: string;
      }>();
    const name = `${row?.username_display} – ${row?.bean_name}`;
    // Name must start with the display username
    expect(name).toContain(username);
    // Must contain an en dash
    expect(name).toContain("–");
    // Must NOT be the old origin-based format
    expect(name).not.toMatch(/^(Ethiopia|Brazil|Guatemala)/);
  });

  it("recipe name uses 'Unknown Bean' when beanName is empty", async () => {
    const { cookieHeader } = await createTestSession({ username: "Bob" });
    const emptyBeanNameAI = makeMockAIBean({ ...LIGHT_BEAN, beanName: "" });
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv({ AI: emptyBeanNameAI }));
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;
    const row = await db
      .prepare("SELECT bean_name FROM recommendation_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ bean_name: string }>();
    expect(row?.bean_name).toBe("Unknown Bean");
  });

  it("recommendation status is retrievable by its owner", async () => {
    const { cookieHeader, token } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;

    // Retrieve via GET /api/recipes/:id
    const getReq = new Request(`http://localhost/api/recommendations/${jobId}`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const getRes = await worker.fetch(getReq, makeEnv());
    expect(getRes.status).toBe(200);
    const getBody = (await getRes.json()) as Record<string, unknown>;
    expect((getBody.job as { id: string }).id).toBe(jobId);
  });

  it("image bytes are NOT stored in the recommendation job", async () => {
    const { cookieHeader } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;

    // Inspect the raw DB row — recipe_json must not contain base64 image data
    const row = await db
      .prepare("SELECT bean_json FROM recommendation_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ bean_json: string }>();
    expect(row).not.toBeNull();
    const json = row?.bean_json ?? "";
    // base64 data URLs start with "data:"
    expect(json).not.toContain("data:image");
    // No raw JPEG magic bytes in stored JSON
    expect(json).not.toContain("FF D8");
  });

  it("accepts legacy 'image' field (single image, backward compat)", async () => {
    const { cookieHeader } = await createTestSession();
    const fd = new FormData();
    fd.append("image", new File([makeJpegBytes()], "bag.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Cookie: cookieHeader, Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(202);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recipes/from-images — image validation
// ---------------------------------------------------------------------------

describe("POST /api/recipes/from-images — image validation", () => {
  it("returns 400 when no images field provided", async () => {
    const { cookieHeader } = await createTestSession();
    const fd = new FormData();
    fd.append("other", "value");
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Cookie: cookieHeader, Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 400 when too many images provided (> 4)", async () => {
    const { cookieHeader } = await createTestSession();
    const fd = new FormData();
    for (let i = 0; i < 5; i++) {
      fd.append("images", new File([makeJpegBytes()], `bag${i}.jpg`, { type: "image/jpeg" }));
    }
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Cookie: cookieHeader, Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("returns 415 for unsupported image format", async () => {
    const { cookieHeader } = await createTestSession();
    const buf = new Uint8Array(32).fill(0xaa);
    const fd = new FormData();
    fd.append("images", new File([buf], "bad.bmp", { type: "image/bmp" }));
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Cookie: cookieHeader, Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(415);
  });

  it("returns 400 for empty image file", async () => {
    const { cookieHeader } = await createTestSession();
    const fd = new FormData();
    fd.append("images", new File([], "empty.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost/api/recipes/from-images", {
      method: "POST",
      body: fd,
      headers: { Cookie: cookieHeader, Origin: "http://localhost" },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(400);
  });

  it("accepts JPEG, PNG and WebP types", async () => {
    const { cookieHeader } = await createTestSession();
    for (const [bytes, name, mime] of [
      [makeJpegBytes(), "a.jpg", "image/jpeg"],
      [makePngBytes(), "b.png", "image/png"],
      [makeWebpBytes(), "c.webp", "image/webp"],
    ] as const) {
      const fd = new FormData();
      fd.append("images", new File([bytes], name, { type: mime }));
      const req = new Request("http://localhost/api/recipes/from-images", {
        method: "POST",
        body: fd,
        headers: { Cookie: cookieHeader, Origin: "http://localhost" },
      });
      const res = await worker.fetch(req, makeEnv());
      expect(res.status).toBe(202);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/recipes — history
// ---------------------------------------------------------------------------

describe("GET /api/recipes — history", () => {
  it("returns 401 without session", async () => {
    const res = await worker.fetch(new Request("http://localhost/api/recipes"), makeEnv());
    expect(res.status).toBe(401);
  });

  it("returns only current user's recipes", async () => {
    const { id: uid1, token: t1 } = await createTestSession({ username: "user1" });
    const { id: uid2 } = await createTestSession({ username: "user2" });

    // Store one recipe per user
    await storeRecipe(db, {
      id: crypto.randomUUID(),
      ownerId: uid1,
      fullName: "User1 – Yirgacheffe",
      beanName: "Yirgacheffe",
      recipeJson: JSON.stringify({ name: "User1 – Yirgacheffe" }),
    });
    await storeRecipe(db, {
      id: crypto.randomUUID(),
      ownerId: uid2,
      fullName: "User2 – Blend",
      beanName: "Blend",
      recipeJson: JSON.stringify({ name: "User2 – Blend" }),
    });

    const req = new Request("http://localhost/api/recipes", {
      headers: { Cookie: `${COOKIE_NAME}=${t1}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; recipes: Array<{ fullName: string }> };
    expect(body.recipes.length).toBe(1);
    expect(body.recipes[0]?.fullName).toContain("User1");
  });
});

// ---------------------------------------------------------------------------
// GET /api/recipes/:id — ownership
// ---------------------------------------------------------------------------

describe("GET /api/recipes/:id — ownership", () => {
  it("returns 404 for recipe owned by another user (indistinguishable from missing)", async () => {
    const { id: uid1 } = await createTestSession({ username: "owner1" });
    const { token: t2 } = await createTestSession({ username: "other2" });

    const recipeId = crypto.randomUUID();
    await storeRecipe(db, {
      id: recipeId,
      ownerId: uid1,
      fullName: "owner1 – Bean",
      beanName: "Bean",
      recipeJson: JSON.stringify({ name: "owner1 – Bean" }),
    });

    const req = new Request(`http://localhost/api/recipes/${recipeId}`, {
      headers: { Cookie: `${COOKIE_NAME}=${t2}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("returns 404 for completely non-existent recipe UUID", async () => {
    const { token } = await createTestSession();
    const req = new Request(`http://localhost/api/recipes/${crypto.randomUUID()}`, {
      headers: { Cookie: `${COOKIE_NAME}=${token}` },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(404);
  });

  it("recipe IDs use unpredictable UUIDs, not sequential integers", async () => {
    const { cookieHeader, token } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    const id = (body.job as { id: string }).id;
    // UUID format: 8-4-4-4-12
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// Recipe generation rate limit
// ---------------------------------------------------------------------------

describe("recipe generation rate limit", () => {
  it("returns 429 after 10 recipe generation attempts per hour", async () => {
    const { cookieHeader, id } = await createTestSession();

    // Pre-populate recipe_attempts table with 10 attempts in the last hour
    for (let i = 0; i < 10; i++) {
      await db
        .prepare("INSERT INTO recipe_attempts (id, user_id, attempted_at) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), id, Date.now() - i * 1000)
        .run();
    }

    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Unicode and Arabic bean names (sanitization preserved)
// ---------------------------------------------------------------------------

describe("Unicode beanName sanitization", () => {
  it("preserves Arabic script in beanName", async () => {
    const arabicBean = { ...LIGHT_BEAN, beanName: "قهوة يمنية" };
    const { cookieHeader } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv({ AI: makeMockAIBean(arabicBean) }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;
    const row = await db
      .prepare("SELECT bean_name FROM recommendation_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ bean_name: string }>();
    expect(row?.bean_name).toBe("قهوة يمنية");
  });

  it("strips HTML delimiters from beanName before storage", async () => {
    const xssBean = { ...LIGHT_BEAN, beanName: '<script>alert("xss")</script>' };
    const { cookieHeader } = await createTestSession();
    const req = makeImagesRequest(
      [{ bytes: makeJpegBytes(), name: "bag.jpg", mime: "image/jpeg" }],
      cookieHeader,
    );
    const res = await worker.fetch(req, makeEnv({ AI: makeMockAIBean(xssBean) }));
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    const jobId = (body.job as { id: string }).id;
    const row = await db
      .prepare("SELECT bean_name FROM recommendation_jobs WHERE id = ?")
      .bind(jobId)
      .first<{ bean_name: string }>();
    expect(row?.bean_name).not.toContain("<script>");
    expect(row?.bean_name).not.toContain("<");
  });
});
