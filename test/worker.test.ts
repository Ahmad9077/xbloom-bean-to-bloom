import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.js";
import type { Env } from "../src/types.js";
import {
  DARK_BEAN,
  LIGHT_BEAN,
  MOCK_ENV,
  makeFormDataRequest,
  makeJpegBytes,
  makeMockAI,
  makeMockAIBean,
  makeMockAIReject,
  makePngBytes,
} from "./fixtures.js";

// ---------------------------------------------------------------------------
// Global fetch mock — used for Turnstile calls; vision now uses env.AI binding
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Helper: call worker with a Request and optional env override
// ---------------------------------------------------------------------------

async function callWorker(
  req: Request,
  envOverride: Partial<Env> = {},
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const fullEnv = { ...MOCK_ENV, ...envOverride } as unknown as Env;
  const res = await worker.fetch(req, fullEnv);
  const body = (await res.json()) as Record<string, unknown>;
  return { res, body };
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 with ok: true", async () => {
    const req = new Request("http://localhost/health");
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.requestId).toBeTruthy();
  });

  it("returns 405 for POST /health", async () => {
    const req = new Request("http://localhost/health", { method: "POST" });
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(405);
    expect(body.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 404 for unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for GET /unknown", async () => {
    const req = new Request("http://localhost/unknown");
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("returns 404 for POST /v2/recipes", async () => {
    const req = new Request("http://localhost/v2/recipes", { method: "POST" });
    const { res } = await callWorker(req);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// OPTIONS preflight
// ---------------------------------------------------------------------------

describe("OPTIONS preflight", () => {
  it("returns 204 for allowed origin", async () => {
    const req = new Request("http://localhost/v1/recipes/from-image", {
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
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.com" },
    });
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// POST /v1/recipes/from-image — method guard
// ---------------------------------------------------------------------------

describe("POST /v1/recipes/from-image — method guard", () => {
  it("returns 405 for GET", async () => {
    const req = new Request("http://localhost/v1/recipes/from-image");
    const { res } = await callWorker(req);
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/recipes/from-image — happy path
// ---------------------------------------------------------------------------

describe("POST /v1/recipes/from-image — happy path", () => {
  it("returns 200 with a valid xBloom Studio recipe for a JPEG", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.machine).toBe("xBloom Studio");
    expect(recipe.bean).toMatchObject({ roastLevel: "light" });
    expect(typeof body.requestId).toBe("string");
  });

  it("recipe machine is always xBloom Studio (deterministic invariant)", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    expect((body.recipe as Record<string, unknown>).machine).toBe("xBloom Studio");
  });

  it("returns 200 with a valid recipe for a PNG using dark bean", async () => {
    const req = makeFormDataRequest(makePngBytes(), "photo.png", "image/png");
    const { res, body } = await callWorker(req, {
      AI: makeMockAIBean(DARK_BEAN) as unknown as Ai,
    });
    expect(res.status).toBe(200);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.machine).toBe("xBloom Studio");
    expect((recipe.bean as Record<string, unknown>).roastLevel).toBe("dark");
  });

  it("recipe has pour volumes summing to totalVolumeMl", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    const recipe = body.recipe as {
      totalVolumeMl: number;
      pours: Array<{ volumeMl: number }>;
    };
    const pourSum = recipe.pours.reduce((s, p) => s + p.volumeMl, 0);
    expect(pourSum).toBe(recipe.totalVolumeMl);
  });

  it("includes correct CORS header for allowed origin", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
    );
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
  });

  it("response has security headers", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// POST /v1/recipes/from-image — upload validation errors
// ---------------------------------------------------------------------------

describe("POST /v1/recipes/from-image — upload errors", () => {
  it("returns 400 when no image field is present", async () => {
    const fd = new FormData();
    fd.append("other", "value");
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 415 for unsupported image format", async () => {
    const buf = new Uint8Array(32).fill(0xaa);
    const fd = new FormData();
    fd.append("image", new File([buf], "bad.bmp", { type: "image/bmp" }));
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res } = await callWorker(req);
    expect(res.status).toBe(415);
  });

  it("returns 400 for empty image file", async () => {
    const fd = new FormData();
    fd.append("image", new File([], "empty.jpg", { type: "image/jpeg" }));
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res } = await callWorker(req);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /v1/recipes/from-image — upstream error propagation
// ---------------------------------------------------------------------------

describe("POST /v1/recipes/from-image — upstream errors", () => {
  it("returns 502 when AI binding rejects", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { res } = await callWorker(req, {
      AI: makeMockAIReject(new Error("Workers AI binding error")) as unknown as Ai,
    });
    expect(res.status).toBe(502);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 502 when AI returns non-JSON output", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { res } = await callWorker(req, {
      AI: makeMockAI("This is prose, not JSON.") as unknown as Ai,
    });
    expect(res.status).toBe(502);
  });

  it("returns 502 when AI returns malformed JSON", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { res } = await callWorker(req, {
      AI: makeMockAI("{bad json{{") as unknown as Ai,
    });
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// Turnstile integration
// ---------------------------------------------------------------------------

describe("Turnstile", () => {
  it("returns 400 when Turnstile token is missing and Turnstile is enabled", async () => {
    const req = makeFormDataRequest(makeJpegBytes()); // no cf-turnstile-response
    const { res, body } = await callWorker(req, {
      TURNSTILE_SECRET_KEY: "ts-secret-key",
    } as Partial<Env>);
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("returns 403 when Turnstile verification fails", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), {
        status: 200,
      }),
    );
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      { "cf-turnstile-response": "bad-token" },
    );
    const { res, body } = await callWorker(req, {
      TURNSTILE_SECRET_KEY: "ts-secret-key",
    } as Partial<Env>);
    expect(res.status).toBe(403);
    expect((body.error as Record<string, unknown>).code).toBe("TURNSTILE_FAILED");
  });

  it("proceeds to recipe generation when Turnstile succeeds", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, "error-codes": [] }), { status: 200 }),
    );
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      { "cf-turnstile-response": "valid-token" },
    );
    const { res, body } = await callWorker(req, {
      TURNSTILE_SECRET_KEY: "ts-secret-key",
    } as Partial<Env>);
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it("skips Turnstile when TURNSTILE_SECRET_KEY is not set", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { res } = await callWorker(req); // MOCK_ENV has no TURNSTILE_SECRET_KEY
    expect(res.status).toBe(200);
    // No Turnstile check → no fetch call at all (AI uses binding, not fetch)
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CORS: disallowed origin receives no ACAO header but request still processes
// ---------------------------------------------------------------------------

describe("CORS — disallowed origin", () => {
  it("processes the request but does not return ACAO header for unknown origin", async () => {
    const req = makeFormDataRequest(makeJpegBytes(), "test.jpg", "image/jpeg", "https://other.com");
    const res = await worker.fetch(req, MOCK_ENV as unknown as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Response envelope stability
// ---------------------------------------------------------------------------

describe("response envelope", () => {
  it("every successful response has ok, requestId, recipe", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.requestId).toBe("string");
    expect(typeof body.recipe).toBe("object");
  });

  it("every error response has ok: false, requestId, error.code, error.message", async () => {
    const fd = new FormData();
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { body } = await callWorker(req);
    expect(body.ok).toBe(false);
    expect(typeof body.requestId).toBe("string");
    const err = body.error as Record<string, unknown>;
    expect(typeof err.code).toBe("string");
    expect(typeof err.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Sentinel: upstream content must not appear in HTTP responses
// ---------------------------------------------------------------------------

describe("upstream content not leaked in HTTP responses", () => {
  it("does not include AI binding error text in response", async () => {
    const SENTINEL = "BINDING_ERR_SENTINEL_xyz123abc";
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, {
      ...MOCK_ENV,
      AI: makeMockAIReject(new Error(SENTINEL)),
    } as unknown as Env);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it("does not include malformed AI response text in response", async () => {
    const SENTINEL = "MALFORMED_SENTINEL_def456ghi";
    const req = makeFormDataRequest(makeJpegBytes());
    const res = await worker.fetch(req, {
      ...MOCK_ENV,
      AI: makeMockAI(`not-json: ${SENTINEL}`),
    } as unknown as Env);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it("does not include network error message in response (generic catch)", async () => {
    const SENTINEL = "NETWORK_ERR_SENTINEL_jkl789mno";
    mockFetch.mockRejectedValueOnce(new Error(SENTINEL));
    // Trigger a code path that uses fetch (Turnstile)
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      { "cf-turnstile-response": "some-token" },
    );
    const res = await worker.fetch(req, {
      ...MOCK_ENV,
      TURNSTILE_SECRET_KEY: "ts-secret",
    } as unknown as Env);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it("does not include Turnstile error-codes in response", async () => {
    const SENTINEL = "TS_CODE_SENTINEL_vwx345yza";
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, "error-codes": [SENTINEL] }), { status: 200 }),
    );
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      { "cf-turnstile-response": "bad-token" },
    );
    const res = await worker.fetch(req, {
      ...MOCK_ENV,
      TURNSTILE_SECRET_KEY: "ts-secret",
    } as unknown as Env);
    expect(await res.text()).not.toContain(SENTINEL);
  });

  it("does not include Turnstile network error in response", async () => {
    const SENTINEL = "TS_NET_SENTINEL_bcd678efg";
    mockFetch.mockRejectedValueOnce(new Error(SENTINEL));
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      { "cf-turnstile-response": "some-token" },
    );
    const res = await worker.fetch(req, {
      ...MOCK_ENV,
      TURNSTILE_SECRET_KEY: "ts-secret",
    } as unknown as Env);
    expect(await res.text()).not.toContain(SENTINEL);
  });
});

// ---------------------------------------------------------------------------
// brewMode handling
// ---------------------------------------------------------------------------

describe("brewMode — default cold", () => {
  it("defaults to cold when brewMode field is absent", async () => {
    const req = makeFormDataRequest(makeJpegBytes()); // no brewMode field
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(200);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.brewMode).toBe("cold");
  });

  it("cold recipe has brewRatio 1:10 (16 g dose → 160 ml)", async () => {
    const req = makeFormDataRequest(makeJpegBytes()); // default cold
    const { body } = await callWorker(req);
    const recipe = body.recipe as { brewRatio: string; totalVolumeMl: number; doseG: number };
    expect(recipe.brewRatio).toBe("1:10");
    expect(recipe.doseG).toBe(16);
    expect(recipe.totalVolumeMl).toBe(160);
  });

  it("cold recipe name includes 'Iced'", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    const recipe = body.recipe as { name: string };
    expect(recipe.name.toLowerCase()).toContain("iced");
  });

  it("cold recipe has icedServing with iceG=80 and totalBeverageMl=240", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    const recipe = body.recipe as Record<string, unknown>;
    const iced = recipe.icedServing as Record<string, unknown>;
    expect(iced).toBeDefined();
    expect(iced.iceG).toBe(80);
    expect(iced.totalBeverageMl).toBe(240);
    expect(typeof iced.instruction).toBe("string");
  });

  it("cold recipe pour volumes sum to machine totalVolumeMl (160 ml, not 240)", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const { body } = await callWorker(req);
    const recipe = body.recipe as { totalVolumeMl: number; pours: Array<{ volumeMl: number }> };
    const pourSum = recipe.pours.reduce((s, p) => s + p.volumeMl, 0);
    expect(pourSum).toBe(recipe.totalVolumeMl);
    expect(recipe.totalVolumeMl).toBe(160);
  });
});

describe("brewMode — explicit cold", () => {
  it("explicit cold=cold gives same result as default", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      undefined,
      "cold",
    );
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(200);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.brewMode).toBe("cold");
    expect(recipe.brewRatio).toBe("1:10");
  });
});

describe("brewMode — hot mode", () => {
  it("hot recipe preserves roast-derived ratio (light=1:14)", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      undefined,
      "hot",
    );
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(200);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.brewMode).toBe("hot");
    expect(recipe.brewRatio).toBe("1:14"); // LIGHT_BEAN ratioN=14
    expect(recipe.totalVolumeMl).toBe(224); // 16 * 14
  });

  it("hot recipe has no icedServing field", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      undefined,
      "hot",
    );
    const { body } = await callWorker(req);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.icedServing).toBeUndefined();
  });

  it("hot recipe name does not include 'Iced'", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      undefined,
      "hot",
    );
    const { body } = await callWorker(req);
    const recipe = body.recipe as { name: string };
    expect(recipe.name.toLowerCase()).not.toContain("iced");
  });

  it("hot recipe pour volumes sum to hot totalVolumeMl", async () => {
    const req = makeFormDataRequest(
      makeJpegBytes(),
      "test.jpg",
      "image/jpeg",
      "http://localhost:3000",
      undefined,
      "hot",
    );
    const { body } = await callWorker(req);
    const recipe = body.recipe as { totalVolumeMl: number; pours: Array<{ volumeMl: number }> };
    const pourSum = recipe.pours.reduce((s, p) => s + p.volumeMl, 0);
    expect(pourSum).toBe(recipe.totalVolumeMl);
  });
});

describe("brewMode — invalid mode", () => {
  it("returns 400 BAD_REQUEST for brewMode=warm", async () => {
    const fd = new FormData();
    fd.append("image", new File([makeJpegBytes()], "test.jpg", { type: "image/jpeg" }));
    fd.append("brewMode", "warm");
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(400);
    expect((body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("returns 400 BAD_REQUEST for brewMode=COLD (case-sensitive)", async () => {
    const fd = new FormData();
    fd.append("image", new File([makeJpegBytes()], "test.jpg", { type: "image/jpeg" }));
    fd.append("brewMode", "COLD");
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(400);
    expect((body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
  });

  it("returns 400 BAD_REQUEST for brewMode=iced", async () => {
    const fd = new FormData();
    fd.append("image", new File([makeJpegBytes()], "test.jpg", { type: "image/jpeg" }));
    fd.append("brewMode", "iced");
    const req = new Request("http://localhost/v1/recipes/from-image", {
      method: "POST",
      body: fd,
    });
    const { res, body } = await callWorker(req);
    expect(res.status).toBe(400);
    expect((body.error as Record<string, unknown>).code).toBe("BAD_REQUEST");
  });
});

describe("brewMode — cold with dark bean", () => {
  it("cold dark recipe also has 1:10 ratio and iceG=80", async () => {
    const req = makeFormDataRequest(
      makePngBytes(),
      "photo.png",
      "image/png",
      "http://localhost:3000",
      undefined,
    );
    // default cold, dark bean
    const { res, body } = await callWorker(req, { AI: makeMockAIBean(DARK_BEAN) as unknown as Ai });
    expect(res.status).toBe(200);
    const recipe = body.recipe as Record<string, unknown>;
    expect(recipe.brewMode).toBe("cold");
    expect(recipe.brewRatio).toBe("1:10");
    const iced = recipe.icedServing as Record<string, unknown>;
    expect(iced.iceG).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

describe("configuration validation", () => {
  it("returns 500 with INTERNAL_ERROR when AI binding is absent, without calling fetch", async () => {
    const req = makeFormDataRequest(makeJpegBytes());
    const envNoAI = { ALLOWED_ORIGINS: MOCK_ENV.ALLOWED_ORIGINS } as unknown as Env;
    const res = await worker.fetch(req, envNoAI);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(500);
    expect((body.error as Record<string, unknown>).code).toBe("INTERNAL_ERROR");
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
