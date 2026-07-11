/**
 * LEGACY TEST ROUTE / NOT PRODUCTION SOURCE OF TRUTH.
 *
 * wrangler.toml deploys the root Worker entrypoint:
 *   main = "index.js"
 *
 * Keep this file only for the existing TypeScript route tests. Production
 * recipe behavior lives in /index.js.
 */

import { requireAuth } from "../auth/middleware.js";
import {
  RECIPE_MAX_ATTEMPTS,
  countRecentRecipeAttempts,
  findRecipeById,
  listRecipesByOwner,
  recordRecipeAttempt,
  storeRecipe,
} from "../db.js";
import { ClientError, NotFoundError, RateLimitError } from "../errors.js";
import { extractImagesFromFormData } from "../image.js";
import { generateRecipe, validateRecipeInvariants } from "../recipe.js";
import { sanitizeModelString } from "../sanitize.js";
import { verifyTurnstile } from "../turnstile.js";
import type { BeanMetadata, Env } from "../types.js";
import { extractBeanMetadata } from "../vision.js";

const EN_DASH = "–";
const RECIPE_PATH_PREFIX = "/recipes/";

export async function handleFromImages(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);

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
  const strength = parseBrewStrength(formData);

  if (env.TURNSTILE_SECRET_KEY) {
    const token = formData.get("cf-turnstile-response");
    await verifyTurnstile(typeof token === "string" ? token : null, env.TURNSTILE_SECRET_KEY);
  }

  const images = await extractImagesFromFormData(formData);
  await recordRecipeAttempt(env.DB, ctx.userId);

  const bean = await extractBeanMetadata(images, env);
  const safeBeanName = sanitizeModelString(bean.beanName, 100).trim() || "Unknown Bean";
  const sanitizedBean: BeanMetadata = {
    beanName: safeBeanName,
    coffeeType: sanitizeModelString(bean.coffeeType, 100),
    variety: sanitizeModelString(bean.variety, 100),
    origin: sanitizeModelString(bean.origin, 100),
    processingMethod: sanitizeModelString(bean.processingMethod, 100),
    roastLevel: bean.roastLevel,
    flavors: bean.flavors
      .map((value) => sanitizeModelString(value, 50))
      .filter(Boolean)
      .slice(0, 20),
    description: sanitizeModelString(bean.description, 200),
  };

  const recipeName = `${ctx.username} ${EN_DASH} ${safeBeanName}`;
  const recipe = {
    ...generateRecipe(sanitizedBean, "Other", brewMode),
    name: recipeName,
    strength,
  };
  validateRecipeInvariants(recipe);

  const recipeId = crypto.randomUUID();
  await storeRecipe(env.DB, {
    id: recipeId,
    ownerId: ctx.userId,
    fullName: recipeName,
    beanName: safeBeanName,
    recipeJson: JSON.stringify(recipe),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      requestId,
      id: recipeId,
      link: `${RECIPE_PATH_PREFIX}${recipeId}`,
      recipe,
    }),
    { status: 201, headers: { "Content-Type": "application/json;charset=UTF-8" } },
  );
}

export async function handleListRecipes(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);
  const rows = await listRecipesByOwner(env.DB, ctx.userId);

  const items = rows.map((recipe) => ({
    id: recipe.id,
    fullName: recipe.full_name,
    beanName: recipe.bean_name,
    createdAt: recipe.created_at,
    link: `${RECIPE_PATH_PREFIX}${recipe.id}`,
  }));

  return new Response(JSON.stringify({ ok: true, requestId, recipes: items }), {
    status: 200,
    headers: { "Content-Type": "application/json;charset=UTF-8" },
  });
}

export async function handleGetRecipe(
  request: Request,
  env: Env,
  requestId: string,
  recipeId: string,
): Promise<Response> {
  const ctx = await requireAuth(request, env);
  const row = await findRecipeById(env.DB, recipeId);

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

function parseBrewMode(formData: FormData): "cold" | "hot" {
  const raw = formData.get("brewMode");
  if (raw === null) return "cold";
  if (typeof raw !== "string") throw new ClientError('"brewMode" must be a text value');
  if (raw === "cold" || raw === "hot") return raw;
  throw new ClientError(`Invalid brewMode "${raw}"; must be "cold" or "hot"`);
}

function parseBrewStrength(formData: FormData): "strong" | "soft" {
  const raw = formData.get("strength");
  if (raw === null || raw === undefined || raw === "") {
    throw new ClientError('Brew strength is required. Choose "strong" or "soft".');
  }
  if (typeof raw !== "string") throw new ClientError('"strength" must be a text value');
  if (raw === "strong" || raw === "soft") return raw;
  throw new ClientError(`Invalid strength "${raw}"; must be "strong" or "soft"`);
}
