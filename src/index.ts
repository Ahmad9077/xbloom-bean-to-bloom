import { buildCorsHeaders, handlePreflight, parseAllowedOrigins } from "./cors.js";
import { AppError, ClientError, InternalError } from "./errors.js";
import { extractImageFromFormData } from "./image.js";
import { generateRecipe, validateRecipeInvariants } from "./recipe.js";
import { applySecurityHeaders } from "./security.js";
import { verifyTurnstile } from "./turnstile.js";
import type { BrewMode, Env, HealthResponse, ResponseEnvelope } from "./types.js";
import { extractBeanMetadata } from "./vision.js";

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function jsonResponse(
  body: ResponseEnvelope | HealthResponse,
  status: number,
  extraHeaders: Headers = new Headers(),
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json;charset=UTF-8");
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

// ---------------------------------------------------------------------------
// brewMode parsing
// ---------------------------------------------------------------------------

/**
 * Parse the brewMode field from an already-parsed FormData.
 * Absent → defaults to "cold" (product default).
 * "cold" | "hot" → accepted.
 * Any other value → throws ClientError (typed 400).
 */
function parseBrewMode(formData: FormData): BrewMode {
  const raw = formData.get("brewMode");
  if (raw === null) return "cold";
  if (typeof raw !== "string") {
    throw new ClientError('Form field "brewMode" must be a text value');
  }
  if (raw === "cold" || raw === "hot") return raw;
  throw new ClientError(`Invalid brewMode "${raw}"; must be "cold" or "hot"`);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleHealth(requestId: string, corsHeaders: Headers): Response {
  const body: HealthResponse = { ok: true, requestId, status: "ok" };
  return jsonResponse(body, 200, corsHeaders);
}

async function handleFromImage(
  request: Request,
  env: Env,
  requestId: string,
  corsHeaders: Headers,
): Promise<Response> {
  // Parse form data once — reading it twice would drain the body stream.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ClientError("Could not parse multipart/form-data body");
  }

  // Parse brewMode before image extraction (product requirement).
  const brewMode = parseBrewMode(formData);

  // Turnstile verification (when TURNSTILE_SECRET_KEY is configured).
  if (env.TURNSTILE_SECRET_KEY) {
    const token = formData.get("cf-turnstile-response");
    await verifyTurnstile(typeof token === "string" ? token : null, env.TURNSTILE_SECRET_KEY);
  }

  const { bytes, mimeType } = await extractImageFromFormData(formData);
  const bean = await extractBeanMetadata(bytes, mimeType, env);
  const recipe = generateRecipe(bean, "Omni", brewMode);
  validateRecipeInvariants(recipe);

  return jsonResponse({ ok: true, requestId, recipe }, 200, corsHeaders);
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    // OPTIONS preflight
    if (method === "OPTIONS") {
      return handlePreflight(origin, allowedOrigins);
    }

    try {
      if (url.pathname === "/health") {
        if (method !== "GET") {
          return jsonResponse(
            { ok: false, requestId, error: { code: "METHOD_NOT_ALLOWED", message: "Use GET" } },
            405,
            corsHeaders,
          );
        }
        return handleHealth(requestId, corsHeaders);
      }

      if (url.pathname === "/v1/recipes/from-image") {
        if (method !== "POST") {
          return jsonResponse(
            {
              ok: false,
              requestId,
              error: { code: "METHOD_NOT_ALLOWED", message: "Use POST" },
            },
            405,
            corsHeaders,
          );
        }
        return await handleFromImage(request, env, requestId, corsHeaders);
      }

      return jsonResponse(
        { ok: false, requestId, error: { code: "NOT_FOUND", message: "Route not found" } },
        404,
        corsHeaders,
      );
    } catch (err) {
      if (err instanceof AppError) {
        const message = err instanceof InternalError ? "Internal validation failed" : err.message;
        return jsonResponse(
          {
            ok: false,
            requestId,
            error: { code: err.code, message },
          },
          err.httpStatus,
          corsHeaders,
        );
      }

      // Unexpected errors — log only a request ID and fixed category; no user data or exception text
      console.error(`[xbloom-worker] Unhandled error; requestId=${requestId} category=unexpected`);
      return jsonResponse(
        {
          ok: false,
          requestId,
          error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
        },
        500,
        corsHeaders,
      );
    }
  },
};
