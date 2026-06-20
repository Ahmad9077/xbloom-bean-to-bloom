import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";
import { MOCK_ENV, makeFormDataRequest, makeJpegBytes } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Global fetch mock — used for Turnstile calls
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with ok: true", async () => {
    const req = new Request("http://localhost/health");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.requestId).toBeTruthy();
    expect(body.status).toBe("ok");
  });

  it("returns 405 for POST /health", async () => {
    const req = new Request("http://localhost/health", { method: "POST" });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(405);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for GET /unknown", async () => {
    const req = new Request("http://localhost/unknown");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
  });

  it("returns 404 for POST /v2/recipes", async () => {
    const req = new Request("http://localhost/v2/recipes", { method: "POST" });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

describe("OPTIONS preflight", () => {
  it("returns 204 for allowed origin", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
      },
    });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("returns 204 without CORS headers for disallowed origin", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" },
    });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Legacy endpoint /v1/recipes/from-image → 401
// ---------------------------------------------------------------------------

describe("legacy /v1/recipes/from-image", () => {
  it("returns 401 UNAUTHORIZED for any method (unauthenticated generation disabled)", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("legacy 401 response body contains migration guidance", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    const body = (await res.json()) as Record<string, unknown>;
    const msg = (body.error as Record<string, unknown>).message as string;
    expect(msg).toMatch(/api\/recipes\/from-images/i);
  });
});

// ---------------------------------------------------------------------------
// Security headers on API responses
// ---------------------------------------------------------------------------

describe("security headers", () => {
  it("health response carries baseline security headers", async () => {
    const req = new Request("http://localhost/health");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("401 response from legacy endpoint carries security headers", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

// ---------------------------------------------------------------------------
// Error envelope structure
// ---------------------------------------------------------------------------

describe("error envelope", () => {
  it("every error response has ok: false, requestId, error.code, error.message", async () => {
    const req = new Request("http://localhost/unknown");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect(typeof body.requestId).toBe("string");
    const err = body.error as Record<string, unknown>;
    expect(typeof err.code).toBe("string");
    expect(typeof err.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Auth routes reachable (unauthenticated — just checking routing)
// ---------------------------------------------------------------------------

describe("auth routes routing", () => {
  it("POST /api/auth/login returns 400 (not 404) when body is missing", async () => {
    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost",
      },
      body: "not-json",
    });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    // Should be 400 (bad request/json parse error) — not 404
    expect(res.status).not.toBe(404);
  });

  it("GET /api/auth/me returns 401 when no session cookie", async () => {
    const req = new Request("http://localhost/api/auth/me");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(false);
    expect((body.error as Record<string, unknown>).code).toBe("UNAUTHORIZED");
  });

  it("POST /api/auth/logout returns 200 even without a session cookie", async () => {
    const req = new Request("http://localhost/api/auth/logout", { method: "POST" });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(200);
  });
});
