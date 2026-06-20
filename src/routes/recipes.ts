import { enforceSameOrigin, requireAuth } from "../auth/middleware.js";
import {
  RECIPE_MAX_ATTEMPTS,
  countRecentRecipeAttempts,
  findRecipeById,
  listRecipesByOwner,
  recordRecipeAttempt,
  storeRecipe,
} from "../db.js";
import { ClientError, NotFoundError, PayloadTooLargeError, RateLimitError } from "../errors.js";
import { extractImagesFromFormData } from "../image.js";
import { analyzeAndRecommend } from "../openai.js";
import { validateRecipeInvariants } from "../recipe.js";
import { sanitizeModelString } from "../sanitize.js";
import { verifyTurnstile } from "../turnstile.js";
import type { BeanMetadata, Env, Recipe } from "../types.js";
import { validateBeanMetadata } from "../vision.js";

const EN_DASH = "–";
const RECIPE_PATH_PREFIX = "/recipes/";

// ---------------------------------------------------------------------------
// POST /api/recipes/from-images
// ---------------------------------------------------------------------------

export async function handleFromImages(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  const ctx = await requireAuth(request, env);

  // Check generation rate limit
  const attemptCount = await countRecentRecipeAttempts(env.DB, ctx.userId);
  if (attemptCount >= RECIPE_MAX_ATTEMPTS) {
    throw new RateLimitError("Recipe generation limit reached. Try again later.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ClientError("Could not parse multipart/form-data body");
  }

  const brewMode = parseBrewMode(formData);

  if (env.TURNSTILE_SECRET_KEY) {
    const token = formData.get("cf-turnstile-response");
    await verifyTurnstile(typeof token === "string" ? token : null, env.TURNSTILE_SECRET_KEY);
  }

  const images = await extractImagesFromFormData(formData);

  // Record attempt BEFORE calling AI (counts whether or not AI succeeds)
  await recordRecipeAttempt(env.DB, ctx.userId);

  const result = await analyzeAndRecommend(images, brewMode, env);
  const bean = validateBeanMetadata(result.bean);

  // Sanitize model-sourced strings
  const safeBeanName = sanitizeModelString(bean.beanName, 100).trim() || "Unknown Bean";
  const sanitizedBean: BeanMetadata = {
    beanName: safeBeanName,
    coffeeType: sanitizeModelString(bean.coffeeType, 100),
    variety: sanitizeModelString(bean.variety, 100),
    origin: sanitizeModelString(bean.origin, 100),
    processingMethod: sanitizeModelString(bean.processingMethod, 100),
    roastLevel: bean.roastLevel,
    flavors: bean.flavors
      .map((v) => sanitizeModelString(v, 50))
      .filter(Boolean)
      .slice(0, 20),
    description: sanitizeModelString(bean.description, 200),
  };

  const recipeName = `${ctx.username} ${EN_DASH} ${safeBeanName}`;
  const { icedServing, ...recipeCore } = result.recipe;
  const recipe: Recipe = {
    ...recipeCore,
    name: recipeName,
    machine: "xBloom Studio",
    dripper: "Omni",
    brewMode,
    bean: sanitizedBean,
    ...(icedServing === null ? {} : { icedServing }),
  };
  validateRecipeInvariants(recipe);

  // Only extracted text and validated recipe data are persisted. Image bytes remain
  // request-scoped and become unreachable immediately after this handler returns.
  const recipeId = crypto.randomUUID();
  await storeRecipe(env.DB, {
    id: recipeId,
    ownerId: ctx.userId,
    fullName: recipeName,
    beanName: safeBeanName,
    recipeJson: JSON.stringify(recipe),
  });

  const body = JSON.stringify({
    ok: true,
    requestId,
    id: recipeId,
    link: `${RECIPE_PATH_PREFIX}${recipeId}`,
    recipe,
  });

  return new Response(body, {
    status: 201,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/recipes — history for current user
// ---------------------------------------------------------------------------

export async function handleListRecipes(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);
  const rows = await listRecipesByOwner(env.DB, ctx.userId);

  const items = rows.map((r) => ({
    id: r.id,
    fullName: r.full_name,
    beanName: r.bean_name,
    createdAt: r.created_at,
    link: `${RECIPE_PATH_PREFIX}${r.id}`,
  }));

  return new Response(JSON.stringify({ ok: true, requestId, recipes: items }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// GET /api/recipes/:id — single recipe (owner only)
// ---------------------------------------------------------------------------

export async function handleGetRecipe(
  request: Request,
  env: Env,
  requestId: string,
  recipeId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);
  const row = await findRecipeById(env.DB, recipeId);

  // Indistinguishable 404 for missing or not-owned
  if (!row || row.owner_id !== ctx.userId) {
    throw new NotFoundError("Recipe not found");
  }

  let recipe: unknown;
  try {
    recipe = JSON.parse(row.recipe_json);
  } catch {
    throw new NotFoundError("Recipe not found");
  }

  return new Response(JSON.stringify({ ok: true, requestId, id: row.id, recipe }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBrewMode(formData: FormData): "cold" | "hot" {
  const raw = formData.get("brewMode");
  if (raw === null) return "cold";
  if (typeof raw !== "string") throw new ClientError('"brewMode" must be a text value');
  if (raw === "cold" || raw === "hot") return raw;
  throw new ClientError(`Invalid brewMode "${raw}"; must be "cold" or "hot"`);
}
