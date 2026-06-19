import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { captureFailureScreenshot, createRecipe } from "./automation.js";
import { loadConfig } from "./config.js";
import { closeDriver, createDriver } from "./driver.js";
import { ErrorCode, ServiceError, toErrorCode, toSafeMessage, toStatusCode } from "./errors.js";
import { IdempotencyStore } from "./idempotency.js";
import { log } from "./logger.js";
import { SerialQueue } from "./queue.js";
import type { JobResult } from "./types.js";
import { validateRequest } from "./validation.js";

const config = loadConfig();
const queue = new SerialQueue(10);
const idempotency = new IdempotencyStore(config.idempotencyTtlMs);

// Prune stale idempotency entries every 10 minutes
setInterval(() => idempotency.prune(), 10 * 60 * 1000).unref();

// ─── CORS / Security middleware ───────────────────────────────────────────────

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Validate Host header
  const host = req.headers.host ?? "";
  if (!config.allowedHosts.has(host)) {
    res.status(421).json({ ok: false, error: { code: "INVALID_HOST", message: "Invalid Host" } });
    return;
  }

  const origin = req.headers.origin;
  const isPreflight = req.method === "OPTIONS";

  if (origin !== undefined) {
    if (!config.allowedOrigins.has(origin)) {
      if (isPreflight) {
        res.status(403).end();
        return;
      }
      res.status(403).json({
        ok: false,
        error: { code: "CORS_FORBIDDEN", message: "Origin not allowed" },
      });
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Idempotency-Key");
    res.setHeader("Access-Control-Max-Age", "600");

    // Private Network Access preflight support (RFC: https://wicg.github.io/private-network-access/)
    if (isPreflight && req.headers["access-control-request-private-network"] === "true") {
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }

  if (isPreflight) {
    res.status(204).end();
    return;
  }

  next();
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(corsMiddleware);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    requestId: randomUUID(),
    status: "ready",
    queueDepth: queue.depth,
  });
});

app.post("/v1/recipes", async (req: Request, res: Response) => {
  const requestId = randomUUID();
  log.info("POST /v1/recipes", { requestId, stage: "request_received" });

  // Parse and validate
  let parsed: ReturnType<typeof validateRequest>;
  try {
    parsed = validateRequest(req.body);
  } catch (err) {
    const code = toErrorCode(err);
    const message = toSafeMessage(err);
    const status = toStatusCode(err);
    log.warn("Validation failed", { requestId, code, message });
    res.status(status).json({ ok: false, requestId, error: { code, message } });
    return;
  }

  const { recipe, dryRun, confirmSave, idempotencyKey } = parsed;

  // Idempotency: check completed result first, then in-flight coalescing
  if (idempotencyKey) {
    const cached = idempotency.get(idempotencyKey);
    if (cached) {
      log.info("Idempotent replay", { requestId, stage: "idempotent" });
      res.status(200).json({ ...cached, requestId });
      return;
    }

    const pending = idempotency.getPending(idempotencyKey);
    if (pending) {
      log.info("Coalescing concurrent idempotent request", {
        requestId,
        stage: "idempotent_coalesce",
      });
      try {
        const result = await pending;
        res.status(200).json({ ...result, requestId });
      } catch (err) {
        const code = toErrorCode(err);
        const message = toSafeMessage(err);
        const status = toStatusCode(err);
        res.status(status).json({ ok: false, requestId, error: { code, message } });
      }
      return;
    }
  }

  const jobId = randomUUID();
  log.info("Queuing job", { requestId, jobId, dryRun, confirmSave });

  const jobPromise = queue.run(async (): Promise<JobResult> => {
    let driver: Awaited<ReturnType<typeof createDriver>> | undefined;
    try {
      driver = await createDriver({
        appiumUrl: config.appiumUrl,
        elementTimeoutMs: config.elementTimeoutMs,
        skipVersionCheck: config.skipVersionCheck,
        expectedAppVersion: config.expectedAppVersion,
        jobId,
      });

      await createRecipe(
        driver,
        recipe,
        {
          dryRun: dryRun === true,
          confirmSave: confirmSave === true,
          maxRetries: config.sliderMaxRetries,
          screenshotDir: config.screenshotDir,
        },
        jobId,
      );

      return {
        ok: true,
        jobId,
        requestId,
        dryRun: dryRun === true,
        confirmed: confirmSave === true,
        recipeName: recipe.name,
        message: dryRun ? "Dry-run complete — recipe was not saved" : "Recipe saved successfully",
      };
    } catch (err) {
      if (driver) {
        await captureFailureScreenshot(driver, config.screenshotDir, jobId);
      }
      throw err;
    } finally {
      if (driver) await closeDriver(driver, jobId);
    }
  });

  // Register in-flight promise for concurrent key coalescing (do not log the key value)
  if (idempotencyKey) {
    idempotency.setPending(idempotencyKey, jobPromise);
  }

  let result: JobResult;
  try {
    result = await jobPromise;
  } catch (err) {
    const code = toErrorCode(err);
    const message = toSafeMessage(err);
    const status = toStatusCode(err);
    log.error("Job failed", { requestId, jobId, code, stage: "job_error" });
    res.status(status).json({ ok: false, requestId, error: { code, message } });
    return;
  }

  // Cache completed result
  if (idempotencyKey) {
    idempotency.set(idempotencyKey, result);
  }

  res.status(200).json(result);
});

// ─── Start ────────────────────────────────────────────────────────────────────

export function startServer(): void {
  app.listen(config.port, "127.0.0.1", () => {
    log.info("xBloom local service started", {
      stage: "startup",
      port: config.port,
      address: `http://127.0.0.1:${config.port}`,
    });
  });
}

// Only bind the port when not running under Vitest
if (!process.env.VITEST) startServer();

export { app };
