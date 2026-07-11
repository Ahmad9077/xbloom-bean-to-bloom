import { toErrorCode, toLocalDiagnostic, toSafeMessage } from "./errors.js";
import { log } from "./logger.js";
import { SerialQueue } from "./queue.js";
import { runRecipeAutomation } from "./runner.js";
import type { Config, Recipe } from "./types.js";
import { validateRequest } from "./validation.js";

interface CloudJob {
  id: string;
  recipeId: string;
  recipe: Recipe;
  saveStarted: boolean;
  recipeSaved: boolean;
}

interface NextResponse {
  ok: boolean;
  job: CloudJob | null;
}

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_POLL_BACKOFF_MS = 60_000;

export function computePollDelayMs(baseDelayMs: number, consecutiveFailures: number): number {
  const base = Math.max(1000, baseDelayMs);
  if (consecutiveFailures <= 0) return base;
  return Math.min(base * 2 ** Math.min(consecutiveFailures - 1, 6), MAX_POLL_BACKOFF_MS);
}

export function requireShareLink(shareLink: string | undefined): string {
  if (!shareLink) {
    throw new Error("The recipe was saved, but xBloom did not return a share link");
  }
  return shareLink;
}

async function cloudFetch(config: Config, path: string, init?: RequestInit): Promise<Response> {
  if (!config.cloudWorkerUrl || !config.bridgeToken)
    throw new Error("Cloud bridge is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${config.cloudWorkerUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.bridgeToken}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function complete(
  config: Config,
  jobId: string,
  status: "completed" | "failed",
  safeError?: string,
  shareLink?: string,
): Promise<void> {
  const response = await cloudFetch(
    config,
    `/api/bridge/jobs/${encodeURIComponent(jobId)}/complete`,
    {
      method: "POST",
      body: JSON.stringify({
        status,
        ...(safeError ? { safeError: safeError.slice(0, 500) } : {}),
        ...(shareLink ? { shareLink } : {}),
      }),
    },
  );
  if (!response.ok) throw new Error(`Cloud completion returned HTTP ${response.status}`);
}

async function checkpoint(
  config: Config,
  jobId: string,
  value: "started" | "saved",
): Promise<void> {
  const response = await cloudFetch(
    config,
    `/api/bridge/jobs/${encodeURIComponent(jobId)}/checkpoint`,
    { method: "POST", body: JSON.stringify({ checkpoint: value }) },
  );
  if (!response.ok) throw new Error(`Cloud checkpoint returned HTTP ${response.status}`);
}

export function startCloudPoller(config: Config): () => void {
  if (!config.cloudWorkerUrl || !config.bridgeToken) {
    log.info("Cloud bridge poller disabled", { stage: "cloud_poller_disabled" });
    return () => {};
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  let consecutiveFailures = 0;
  const queue = new SerialQueue(1);

  const basePollIntervalMs = config.bridgePollIntervalMs ?? 5000;
  const schedule = (delayMs = basePollIntervalMs) => {
    if (!stopped) timer = setTimeout(poll, delayMs);
  };

  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const response = await cloudFetch(config, "/api/bridge/jobs/next");
      if (!response.ok) throw new Error(`Cloud queue returned HTTP ${response.status}`);
      const payload = (await response.json()) as NextResponse;
      if (consecutiveFailures > 0) {
        log.info("Cloud bridge polling recovered", {
          stage: "cloud_poll_recovered",
          previousFailures: consecutiveFailures,
        });
      }
      consecutiveFailures = 0;
      const job = payload.job;
      if (!payload.ok || !job) return;

      log.info("Cloud bridge job claimed", {
        stage: "cloud_job_claimed",
        jobId: job.id,
        recipeId: job.recipeId,
      });

      try {
        const validated = validateRequest({ recipe: job.recipe, confirmSave: true });
        const result = await queue.run(() =>
          runRecipeAutomation(config, validated.recipe, job.id, {
            dryRun: false,
            confirmSave: true,
            resumeSavedRecipe: job.saveStarted || job.recipeSaved,
            onBeforeSave: () => checkpoint(config, job.id, "started"),
            onRecipeSaved: () => checkpoint(config, job.id, "saved"),
          }),
        );
        await complete(config, job.id, "completed", undefined, requireShareLink(result.shareLink));
        log.info("Cloud bridge job completed", { stage: "cloud_job_completed", jobId: job.id });
      } catch (error) {
        const message = toSafeMessage(error);
        log.error("Cloud bridge job failed", {
          stage: "cloud_job_failed",
          jobId: job.id,
          errorCode: toErrorCode(error),
          errorType: error instanceof Error ? error.name : "unknown",
          diagnostic: toLocalDiagnostic(error),
        });
        await complete(config, job.id, "failed", message).catch(() => {
          log.error("Could not report cloud bridge failure", {
            stage: "cloud_job_report_failed",
            jobId: job.id,
          });
        });
      }
    } catch (error) {
      consecutiveFailures += 1;
      // Log the first failure and powers of two, avoiding unbounded 5-second
      // log growth during a prolonged DNS/TLS/provider outage.
      if (consecutiveFailures === 1 || (consecutiveFailures & (consecutiveFailures - 1)) === 0) {
        log.warn("Cloud bridge poll failed", {
          stage: "cloud_poll_error",
          errorType: error instanceof Error ? error.name : "unknown",
          consecutiveFailures,
          retryInMs: computePollDelayMs(basePollIntervalMs, consecutiveFailures),
        });
      }
    } finally {
      busy = false;
      schedule(computePollDelayMs(basePollIntervalMs, consecutiveFailures));
    }
  };

  log.info("Cloud bridge poller started", {
    stage: "cloud_poller_started",
    workerOrigin: new URL(config.cloudWorkerUrl).origin,
  });
  void poll();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
