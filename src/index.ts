import { requireAuth } from "./auth/middleware.js";
import { buildCorsHeaders, handlePreflight, parseAllowedOrigins } from "./cors.js";
import {
  AppError,
  InternalError,
  MethodNotAllowedError,
  NotFoundError,
  UnauthorizedError,
} from "./errors.js";
import { applySecurityHeaders } from "./security.js";
import type { Env, HealthResponse, ResponseEnvelope } from "./types.js";

import {
  deleteExpiredSessions,
  pruneLoginAttempts,
  pruneOldBridgeJobs,
  pruneOldRecommendationJobs,
  pruneRecipeAttempts,
} from "./db.js";
import {
  handleCreateUser,
  handleDeleteUser,
  handleListUsers,
  handlePatchUser,
} from "./routes/admin.js";
// Route handlers
import { handleLogin, handleLogout, handleMe } from "./routes/auth.js";
import {
  handleBridgeCompleteJob,
  handleBridgeNextJob,
  handleCreateBridgeJob,
  handleGetBridgeJobStatus,
} from "./routes/bridge.js";
import { handleFromImages, handleGetRecipe, handleListRecipes } from "./routes/recipes.js";
import {
  handleGetRecommendation,
  handleRecommendationComplete,
  handleRecommendationNext,
} from "./routes/recommendations.js";

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function jsonResponse(
  body: ResponseEnvelope | HealthResponse | Record<string, unknown>,
  status: number,
  extraHeaders: Headers = new Headers(),
): Response {
  const headers = new Headers(extraHeaders);
  headers.set("Content-Type", "application/json;charset=UTF-8");
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function secureApiResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  applySecurityHeaders(headers);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ---------------------------------------------------------------------------
// SPA route protection
// Protected SPA routes redirect unauthenticated users to /login.
// ---------------------------------------------------------------------------

const PROTECTED_SPA_PREFIXES = ["/history", "/recipes", "/admin"];
const PUBLIC_PATHS = new Set(["/login", "/health"]);

function isProtectedSpaRoute(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return false;
  if (pathname.startsWith("/api/") || pathname.startsWith("/v1/")) return false;
  // Static assets (has a file extension)
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return false;
  if (pathname === "/") return true;
  for (const prefix of PROTECTED_SPA_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
    const origin = request.headers.get("Origin");
    const corsHeaders = buildCorsHeaders(origin, allowedOrigins);

    if (method === "OPTIONS") {
      return handlePreflight(origin, allowedOrigins);
    }

    try {
      // -----------------------------------------------------------------------
      // Health check (public)
      // -----------------------------------------------------------------------
      if (pathname === "/health") {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        const body: HealthResponse = { ok: true, requestId, status: "ok" };
        return jsonResponse(body, 200, corsHeaders);
      }

      // -----------------------------------------------------------------------
      // Auth routes (public endpoints)
      // -----------------------------------------------------------------------
      if (pathname === "/api/auth/login") {
        if (method !== "POST") throw new MethodNotAllowedError("Use POST");
        return secureApiResponse(await handleLogin(request, env, requestId));
      }

      if (pathname === "/api/auth/logout") {
        if (method !== "POST") throw new MethodNotAllowedError("Use POST");
        return secureApiResponse(await handleLogout(request, env, requestId));
      }

      if (pathname === "/api/auth/me") {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(await handleMe(request, env, requestId));
      }

      // -----------------------------------------------------------------------
      // Recipe routes (authenticated)
      // -----------------------------------------------------------------------
      if (pathname === "/api/recipes/from-images") {
        if (method !== "POST") throw new MethodNotAllowedError("Use POST");
        return secureApiResponse(await handleFromImages(request, env, requestId));
      }

      if (pathname === "/api/recipes") {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(await handleListRecipes(request, env, requestId));
      }

      const recommendationMatch = pathname.match(/^\/api\/recommendations\/([^/]+)$/);
      if (recommendationMatch) {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(
          await handleGetRecommendation(request, env, requestId, recommendationMatch[1] as string),
        );
      }

      // /api/recipes/:id and /api/recipes/:id/bridge-jobs
      const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)(\/bridge-jobs)?$/);
      if (recipeMatch) {
        const recipeId = recipeMatch[1] as string;
        const isBridgeJobs = Boolean(recipeMatch[2]);

        if (isBridgeJobs) {
          if (method === "POST")
            return secureApiResponse(
              await handleCreateBridgeJob(request, env, requestId, recipeId),
            );
          if (method === "GET")
            return secureApiResponse(
              await handleGetBridgeJobStatus(request, env, requestId, recipeId),
            );
          throw new MethodNotAllowedError("Use GET or POST");
        }
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(await handleGetRecipe(request, env, requestId, recipeId));
      }

      // -----------------------------------------------------------------------
      // Admin routes
      // -----------------------------------------------------------------------
      if (pathname === "/api/admin/users") {
        if (method === "GET")
          return secureApiResponse(await handleListUsers(request, env, requestId));
        if (method === "POST")
          return secureApiResponse(await handleCreateUser(request, env, requestId));
        throw new MethodNotAllowedError("Use GET or POST");
      }

      const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserMatch) {
        const userId = adminUserMatch[1] as string;
        if (method === "PATCH")
          return secureApiResponse(await handlePatchUser(request, env, requestId, userId));
        if (method === "DELETE")
          return secureApiResponse(await handleDeleteUser(request, env, requestId, userId));
        throw new MethodNotAllowedError("Use PATCH or DELETE");
      }

      // -----------------------------------------------------------------------
      // Bridge Mac-service endpoints
      // -----------------------------------------------------------------------
      if (pathname === "/api/bridge/jobs/next") {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(await handleBridgeNextJob(request, env, requestId));
      }

      if (pathname === "/api/bridge/recommendations/next") {
        if (method !== "GET") throw new MethodNotAllowedError("Use GET");
        return secureApiResponse(await handleRecommendationNext(request, env, requestId));
      }

      const recommendationCompleteMatch = pathname.match(
        /^\/api\/bridge\/recommendations\/([^/]+)\/complete$/,
      );
      if (recommendationCompleteMatch) {
        if (method !== "POST") throw new MethodNotAllowedError("Use POST");
        return secureApiResponse(
          await handleRecommendationComplete(
            request,
            env,
            requestId,
            recommendationCompleteMatch[1] as string,
          ),
        );
      }

      const bridgeCompleteMatch = pathname.match(/^\/api\/bridge\/jobs\/([^/]+)\/complete$/);
      if (bridgeCompleteMatch) {
        const jobId = bridgeCompleteMatch[1] as string;
        if (method !== "POST") throw new MethodNotAllowedError("Use POST");
        return secureApiResponse(await handleBridgeCompleteJob(request, env, requestId, jobId));
      }

      // -----------------------------------------------------------------------
      // Legacy endpoint — unauthenticated generation is no longer supported
      // -----------------------------------------------------------------------
      if (pathname === "/v1/recipes/from-image") {
        return jsonResponse(
          {
            ok: false,
            requestId,
            error: {
              code: "UNAUTHORIZED",
              message:
                "This endpoint requires authentication. Use POST /api/recipes/from-images with a valid session.",
            },
          },
          401,
          corsHeaders,
        );
      }

      // -----------------------------------------------------------------------
      // SPA: protected route → redirect to /login if no session cookie
      // -----------------------------------------------------------------------
      if (isProtectedSpaRoute(pathname) && env.ASSETS) {
        try {
          await requireAuth(request, env);
        } catch (error) {
          if (!(error instanceof UnauthorizedError)) throw error;
          return Response.redirect(new URL("/login", request.url).toString(), 302);
        }
      }

      // -----------------------------------------------------------------------
      // Static asset fallback (Workers Static Assets)
      // -----------------------------------------------------------------------
      if (env.ASSETS) {
        const assetResponse = await env.ASSETS.fetch(request);
        const headers = new Headers(assetResponse.headers);
        applySecurityHeaders(headers, true);
        return new Response(assetResponse.body, {
          status: assetResponse.status,
          headers,
        });
      }

      throw new NotFoundError("Route not found");
    } catch (err) {
      if (err instanceof AppError) {
        const isInternal = err instanceof InternalError;
        if (isInternal) {
          console.error(`[xbloom] Internal error; requestId=${requestId} code=${err.code}`);
        }
        const message = isInternal ? "Internal error" : err.message;
        return jsonResponse(
          { ok: false, requestId, error: { code: err.code, message } },
          err.httpStatus,
          corsHeaders,
        );
      }

      console.error(
        `[xbloom] Unhandled error; requestId=${requestId} category=unexpected name=${
          err instanceof Error ? err.name : "unknown"
        } message=${err instanceof Error ? err.message.slice(0, 300) : "non-error"}`,
      );
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

  // ---------------------------------------------------------------------------
  // Scheduled handler: prune expired rows
  // ---------------------------------------------------------------------------
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    try {
      await Promise.allSettled([
        deleteExpiredSessions(env.DB),
        pruneLoginAttempts(env.DB),
        pruneRecipeAttempts(env.DB),
        pruneOldBridgeJobs(env.DB),
        pruneOldRecommendationJobs(env.DB),
      ]);
    } catch (err) {
      console.error(
        "[xbloom] Scheduled handler error:",
        err instanceof Error ? err.message : "unknown",
      );
    }
  },
};
