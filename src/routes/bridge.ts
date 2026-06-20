import { requireBridgeAuth } from "../auth/bridge-token.js";
import { enforceSameOrigin, requireAuth } from "../auth/middleware.js";
import {
  claimNextBridgeJob,
  completeBridgeJob,
  createBridgeJobIfAbsent,
  findRecipeById,
  getBridgeJobById,
  getBridgeJobByRecipe,
} from "../db.js";
import type { BridgeJobRow } from "../db.js";
import { ClientError, NotFoundError } from "../errors.js";
import type { Env } from "../types.js";

// ---------------------------------------------------------------------------
// POST /api/recipes/:id/bridge-jobs  (owner only, idempotent by recipe_id)
// ---------------------------------------------------------------------------

export async function handleCreateBridgeJob(
  request: Request,
  env: Env,
  requestId: string,
  recipeId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  const ctx = await requireAuth(request, env);

  const recipe = await findRecipeById(env.DB, recipeId);
  if (!recipe || recipe.owner_id !== ctx.userId) {
    throw new NotFoundError("Recipe not found");
  }

  let retryFailed = false;
  if (request.headers.get("Content-Type")?.includes("application/json")) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ClientError("Expected JSON body");
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ClientError("Invalid body");
    }
    const retry = (body as Record<string, unknown>).retry;
    if (retry !== undefined && typeof retry !== "boolean") {
      throw new ClientError('"retry" must be a boolean');
    }
    retryFailed = retry === true;
  }

  const job = await createBridgeJobIfAbsent(
    env.DB,
    {
      id: crypto.randomUUID(),
      recipeId,
      ownerId: ctx.userId,
    },
    retryFailed,
  );

  return new Response(JSON.stringify({ ok: true, requestId, job: serializeJob(job) }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/recipes/:id/bridge-jobs  (owner only)
// ---------------------------------------------------------------------------

export async function handleGetBridgeJobStatus(
  request: Request,
  env: Env,
  requestId: string,
  recipeId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);

  const recipe = await findRecipeById(env.DB, recipeId);
  if (!recipe || recipe.owner_id !== ctx.userId) {
    throw new NotFoundError("Recipe not found");
  }

  const job = await getBridgeJobByRecipe(env.DB, recipeId);
  if (!job) throw new NotFoundError("No bridge job for this recipe");

  return new Response(JSON.stringify({ ok: true, requestId, job: serializeJob(job) }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/bridge/jobs/next  (bridge bearer auth)
// ---------------------------------------------------------------------------

export async function handleBridgeNextJob(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  await requireBridgeAuth(request, env);

  const job = await claimNextBridgeJob(env.DB);
  if (!job) {
    return new Response(JSON.stringify({ ok: true, requestId, job: null }), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  }

  const recipeRow = await findRecipeById(env.DB, job.recipe_id);
  if (!recipeRow) {
    await completeBridgeJob(env.DB, job.id, "failed", "Recipe not found");
    return new Response(JSON.stringify({ ok: true, requestId, job: null }), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  }

  let recipeData: unknown;
  try {
    recipeData = JSON.parse(recipeRow.recipe_json);
  } catch {
    await completeBridgeJob(env.DB, job.id, "failed", "Recipe JSON invalid");
    return new Response(JSON.stringify({ ok: true, requestId, job: null }), {
      status: 200,
      headers: { "Content-Type": "application/json;charset=UTF-8" },
    });
  }

  return new Response(
    JSON.stringify({ ok: true, requestId, job: { ...serializeJob(job), recipe: recipeData } }),
    { status: 200, headers: { "Content-Type": "application/json;charset=UTF-8" } },
  );
}

// ---------------------------------------------------------------------------
// POST /api/bridge/jobs/:id/complete  (bridge bearer auth)
// Body: { status: "completed" | "failed", safeError?: string }
// ---------------------------------------------------------------------------

export async function handleBridgeCompleteJob(
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
  if (typeof body !== "object" || body === null) throw new ClientError("Invalid body");
  const obj = body as Record<string, unknown>;

  const status = obj.status;
  if (status !== "completed" && status !== "failed") {
    throw new ClientError('status must be "completed" or "failed"');
  }

  const rawError = typeof obj.safeError === "string" ? obj.safeError : null;
  const safeError = rawError ? rawError.slice(0, 500) : null;
  const shareLink = status === "completed" ? parseShareLink(obj.shareLink) : null;

  const job = await getBridgeJobById(env.DB, jobId);
  if (!job || job.status !== "claimed") {
    throw new NotFoundError("Job not found or not in claimed state");
  }

  await completeBridgeJob(env.DB, jobId, status, safeError, shareLink);

  return new Response(JSON.stringify({ ok: true, requestId }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function serializeJob(job: BridgeJobRow) {
  return {
    id: job.id,
    recipeId: job.recipe_id,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
    safeError: job.safe_error,
    shareLink: job.share_link,
  };
}

function parseShareLink(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) throw new ClientError("Invalid share link");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ClientError("Invalid share link");
  }
  if (url.protocol !== "https:" || url.hostname !== "share-h5.xbloom.com") {
    throw new ClientError("Invalid xBloom share link");
  }
  return url.toString();
}
