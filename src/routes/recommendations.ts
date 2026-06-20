import { requireBridgeAuth } from "../auth/bridge-token.js";
import { requireAuth } from "../auth/middleware.js";
import {
  claimNextRecommendationJob,
  completeRecommendationJob,
  failRecommendationJob,
  getRecommendationJobById,
} from "../db.js";
import { ClientError, NotFoundError } from "../errors.js";
import { validateRecipeInvariants } from "../recipe.js";
import type { BeanMetadata, Env, Recipe } from "../types.js";

const EN_DASH = "–";

export async function handleGetRecommendation(
  request: Request,
  env: Env,
  requestId: string,
  jobId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);
  const job = await getRecommendationJobById(env.DB, jobId);
  if (!job || job.owner_id !== ctx.userId) throw new NotFoundError("Recommendation not found");
  return json({
    ok: true,
    requestId,
    job: {
      id: job.id,
      status: job.status,
      recipeId: job.recipe_id,
      safeError: job.safe_error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
  });
}

export async function handleRecommendationNext(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  await requireBridgeAuth(request, env);
  const job = await claimNextRecommendationJob(env.DB);
  if (!job) return json({ ok: true, requestId, job: null });
  return json({
    ok: true,
    requestId,
    job: {
      id: job.id,
      username: job.username_display,
      beanName: job.bean_name,
      bean: JSON.parse(job.bean_json),
      brewMode: job.brew_mode,
    },
  });
}

export async function handleRecommendationComplete(
  request: Request,
  env: Env,
  requestId: string,
  jobId: string,
): Promise<Response> {
  await requireBridgeAuth(request, env);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ClientError("Expected JSON body");
  }
  if (!body || typeof body !== "object") throw new ClientError("Invalid body");
  const obj = body as Record<string, unknown>;
  const job = await getRecommendationJobById(env.DB, jobId);
  if (!job || job.status !== "claimed") {
    throw new NotFoundError("Recommendation not found or not in claimed state");
  }
  if (obj.status === "failed") {
    const safeError =
      typeof obj.safeError === "string"
        ? obj.safeError.slice(0, 500)
        : "The AI recommendation could not be generated.";
    await failRecommendationJob(env.DB, jobId, safeError);
    return json({ ok: true, requestId });
  }
  if (obj.status !== "completed" || !obj.recipe || typeof obj.recipe !== "object") {
    throw new ClientError('status must be "completed" or "failed"');
  }

  let bean: BeanMetadata;
  try {
    bean = JSON.parse(job.bean_json) as BeanMetadata;
  } catch {
    throw new ClientError("Stored bean metadata is invalid");
  }
  const fullName = `${job.username_display} ${EN_DASH} ${job.bean_name}`;
  // Identity and extracted metadata are trusted only from the authenticated queue record.
  const recipe = {
    ...(obj.recipe as Record<string, unknown>),
    name: fullName,
    machine: "xBloom Studio",
    dripper: "Omni",
    brewMode: job.brew_mode,
    bean,
  } as Recipe;
  validateRecipeInvariants(recipe);
  const recipeId = crypto.randomUUID();
  await completeRecommendationJob(env.DB, job, {
    id: recipeId,
    fullName,
    beanName: job.bean_name,
    recipeJson: JSON.stringify(recipe),
  });
  return json({ ok: true, requestId, recipeId });
}

function json(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}
