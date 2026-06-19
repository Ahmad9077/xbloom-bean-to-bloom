import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks must be declared before any module imports ─────────────────────────

vi.mock("../src/automation.js", () => ({
  createRecipe: vi.fn().mockResolvedValue(undefined),
  captureFailureScreenshot: vi.fn().mockResolvedValue(undefined),
}));

import { createRecipe } from "../src/automation.js";

vi.mock("../src/driver.js", () => ({
  createDriver: vi.fn().mockResolvedValue({ _sessionId: "mock" }),
  closeDriver: vi.fn().mockResolvedValue(undefined),
  id: (r: string) => r,
  idText: (r: string) => r,
  contentDesc: (d: string) => d,
}));

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    port: 3999,
    appiumUrl: "http://127.0.0.1:4723",
    allowedOrigins: new Set(["http://localhost:3000"]),
    allowedHosts: new Set(["localhost:3999", "127.0.0.1:3999"]),
    expectedAppVersion: "2.2.2",
    skipVersionCheck: true,
    elementTimeoutMs: 5000,
    sliderMaxRetries: 3,
    screenshotDir: "./runtime/screenshots",
    idempotencyTtlMs: 3600000,
  }),
}));

import request from "supertest";
import { app } from "../src/server.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const bloomPour = {
  label: "Bloom",
  volumeMl: 225,
  tempC: 93,
  flowRateMlPerSec: 3.0,
  pauseSec: 30,
  pattern: "centered" as const,
  agitationBefore: false,
  agitationAfter: false,
};

const validRecipe = {
  name: "Test Recipe",
  machine: "xBloom Studio",
  dripper: "Omni",
  brewRatio: "1:15",
  totalVolumeMl: 225,
  doseG: 15,
  grindSize: 23,
  rpm: 90,
  pours: [bloomPour],
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns ok:true with status and queueDepth", async () => {
    const res = await request(app).get("/health").set("Host", "localhost:3999");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("ready");
    expect(typeof res.body.queueDepth).toBe("number");
  });
});

describe("POST /v1/recipes — Host validation", () => {
  it("rejects an invalid Host header with 421", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "evil.example.com")
      .send({ recipe: validRecipe, confirmSave: true });
    expect(res.status).toBe(421);
  });

  it("allows a listed Host header", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "127.0.0.1:3999")
      .send({ recipe: validRecipe, dryRun: true });
    expect(res.status).toBe(200);
  });
});

describe("POST /v1/recipes — CORS", () => {
  it("allows listed Origin and returns ACAO header", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .set("Origin", "http://localhost:3000")
      .send({ recipe: validRecipe, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("rejects unlisted Origin with 403", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .set("Origin", "http://attacker.com")
      .send({ recipe: validRecipe, confirmSave: true });
    expect(res.status).toBe(403);
  });

  it("preflight from allowed origin returns 204", async () => {
    const res = await request(app)
      .options("/v1/recipes")
      .set("Host", "localhost:3999")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("preflight with Private Network Access flag returns PNA header", async () => {
    const res = await request(app)
      .options("/v1/recipes")
      .set("Host", "localhost:3999")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Private-Network", "true");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-private-network"]).toBe("true");
  });

  it("preflight from unknown origin returns 403", async () => {
    const res = await request(app)
      .options("/v1/recipes")
      .set("Host", "localhost:3999")
      .set("Origin", "http://attacker.com")
      .set("Access-Control-Request-Method", "POST");
    expect(res.status).toBe(403);
  });

  it("never returns wildcard CORS", async () => {
    const res = await request(app)
      .get("/health")
      .set("Host", "localhost:3999")
      .set("Origin", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });
});

describe("POST /v1/recipes — Studio-only guard", () => {
  it("rejects machine !== xBloom Studio", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: { ...validRecipe, machine: "xBloom Original" }, confirmSave: true });
    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("MACHINE_NOT_SUPPORTED");
  });

  it("error message does not leak account email", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: { ...validRecipe, machine: "xBloom Original" }, confirmSave: true });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/@/);
    expect(body).not.toContain("hotmail");
  });
});

describe("POST /v1/recipes — confirmSave requirement", () => {
  it("rejects when neither dryRun nor confirmSave is true", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects when both dryRun and confirmSave are true", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true, confirmSave: true });
    expect(res.status).toBe(422);
  });
});

describe("POST /v1/recipes — dry-run never saves", () => {
  it("dryRun response says recipe was not saved", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.confirmed).toBe(false);
    expect(res.body.message).toMatch(/not saved/i);
  });

  it("confirmSave response shows confirmed:true", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, confirmSave: true });
    expect(res.status).toBe(200);
    expect(res.body.confirmed).toBe(true);
    expect(res.body.dryRun).toBe(false);
  });
});

describe("Idempotency", () => {
  it("second request with same key returns same jobId", async () => {
    const key = `idem-${randomUUID()}`;
    const r1 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, confirmSave: true, idempotencyKey: key });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, confirmSave: true, idempotencyKey: key });
    expect(r2.status).toBe(200);
    expect(r2.body.jobId).toBe(r1.body.jobId);
  });

  it("requests without idempotency key always create new jobs", async () => {
    const r1 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true });
    const r2 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true });
    expect(r1.body.jobId).not.toBe(r2.body.jobId);
  });
});

describe("Idempotency concurrency", () => {
  beforeEach(() => {
    vi.mocked(createRecipe).mockResolvedValue(undefined);
  });

  it("concurrent requests with same key coalesce to one job", async () => {
    const key = `coalesce-${randomUUID()}`;
    const [r1, r2] = await Promise.all([
      request(app)
        .post("/v1/recipes")
        .set("Host", "localhost:3999")
        .send({ recipe: validRecipe, dryRun: true, idempotencyKey: key }),
      request(app)
        .post("/v1/recipes")
        .set("Host", "localhost:3999")
        .send({ recipe: validRecipe, dryRun: true, idempotencyKey: key }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body.jobId).toBe(r2.body.jobId);
  });

  it("retry with same key after failure starts a new job", async () => {
    const key = `retry-${randomUUID()}`;

    vi.mocked(createRecipe).mockRejectedValueOnce(new Error("appium mock failure"));
    const r1 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true, idempotencyKey: key });
    expect(r1.status).toBe(500);
    expect(r1.body.ok).toBe(false);

    const r2 = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, dryRun: true, idempotencyKey: key });
    expect(r2.status).toBe(200);
    expect(r2.body.ok).toBe(true);
  });
});

describe("Error response structure", () => {
  it("error body has stable code and message fields", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: { ...validRecipe, machine: "other" }, confirmSave: true });
    expect(typeof res.body.error.code).toBe("string");
    expect(typeof res.body.error.message).toBe("string");
    expect(res.body.ok).toBe(false);
  });

  it("error response includes requestId", async () => {
    const res = await request(app)
      .post("/v1/recipes")
      .set("Host", "localhost:3999")
      .send({ recipe: validRecipe, confirmSave: true, dryRun: true });
    expect(typeof res.body.requestId).toBe("string");
  });
});
