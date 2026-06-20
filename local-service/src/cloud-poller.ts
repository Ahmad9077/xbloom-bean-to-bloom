import { toSafeMessage } from "./errors.js";
import { log } from "./logger.js";
import { SerialQueue } from "./queue.js";
import { recommendRecipe } from "./recommender.js";
import { runRecipeAutomation } from "./runner.js";
import type { Bean, BrewMode, Config, Recipe } from "./types.js";
import { validateRequest } from "./validation.js";

interface CloudJob {
  id: string;
  recipeId: string;
  recipe: Recipe;
}

interface NextResponse {
  ok: boolean;
  job: CloudJob | null;
}

interface RecommendationJob {
  id: string;
  username: string;
  beanName: string;
  bean: Bean;
  brewMode: BrewMode;
}

const REQUEST_TIMEOUT_MS = 15_000;

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

async function processRecommendation(config: Config): Promise<boolean> {
  const response = await cloudFetch(config, "/api/bridge/recommendations/next");
  if (!response.ok) throw new Error(`Recommendation queue returned HTTP ${response.status}`);
  const payload = (await response.json()) as { ok: boolean; job: RecommendationJob | null };
  if (!payload.ok || !payload.job) return false;
  const job = payload.job;
  log.info("AI recommendation job claimed", { stage: "recommendation_claimed", jobId: job.id });
  try {
    const recipe = await recommendRecipe({
      codexBinary: config.codexBinary,
      codexWorkDir: config.codexWorkDir,
      username: job.username,
      beanName: job.beanName,
      bean: job.bean,
      brewMode: job.brewMode,
    });
    const done = await cloudFetch(
      config,
      `/api/bridge/recommendations/${encodeURIComponent(job.id)}/complete`,
      { method: "POST", body: JSON.stringify({ status: "completed", recipe }) },
    );
    if (!done.ok) throw new Error(`Recommendation completion returned HTTP ${done.status}`);
    log.info("AI recommendation completed", { stage: "recommendation_completed", jobId: job.id });
  } catch (error) {
    const message = toSafeMessage(error);
    log.error("AI recommendation failed", { stage: "recommendation_failed", jobId: job.id });
    await cloudFetch(config, `/api/bridge/recommendations/${encodeURIComponent(job.id)}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "failed", safeError: message.slice(0, 500) }),
    }).catch(() => {});
  }
  return true;
}

export function startCloudPoller(config: Config): () => void {
  if (!config.cloudWorkerUrl || !config.bridgeToken) {
    log.info("Cloud bridge poller disabled", { stage: "cloud_poller_disabled" });
    return () => {};
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let busy = false;
  const queue = new SerialQueue(1);

  const schedule = () => {
    if (!stopped) timer = setTimeout(poll, config.bridgePollIntervalMs ?? 5000);
  };

  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (await processRecommendation(config)) return;
      const response = await cloudFetch(config, "/api/bridge/jobs/next");
      if (!response.ok) throw new Error(`Cloud queue returned HTTP ${response.status}`);
      const payload = (await response.json()) as NextResponse;
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
          }),
        );
        await complete(config, job.id, "completed", undefined, result.shareLink);
        log.info("Cloud bridge job completed", { stage: "cloud_job_completed", jobId: job.id });
      } catch (error) {
        const message = toSafeMessage(error);
        log.error("Cloud bridge job failed", { stage: "cloud_job_failed", jobId: job.id });
        await complete(config, job.id, "failed", message).catch(() => {
          log.error("Could not report cloud bridge failure", {
            stage: "cloud_job_report_failed",
            jobId: job.id,
          });
        });
      }
    } catch (error) {
      log.warn("Cloud bridge poll failed", {
        stage: "cloud_poll_error",
        errorType: error instanceof Error ? error.name : "unknown",
      });
    } finally {
      busy = false;
      schedule();
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
