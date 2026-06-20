import { deleteSession, findSession, findUserById } from "../db.js";
import { ForbiddenError, UnauthorizedError } from "../errors.js";
import type { AuthContext, Env } from "../types.js";
import { extractSessionToken, hashSessionToken } from "./session.js";

/**
 * Validate the session cookie and return an AuthContext on success.
 * Deletes the session row and throws UnauthorizedError on any failure:
 * - Missing or malformed token
 * - Session not found in DB
 * - Session expired
 * - auth_version mismatch (password/role/enabled change invalidated the session)
 * - User not found or disabled
 */
export async function requireAuth(request: Request, env: Env): Promise<AuthContext> {
  const cookieHeader = request.headers.get("Cookie");
  const token = extractSessionToken(cookieHeader);
  if (!token) {
    throw new UnauthorizedError("Authentication required");
  }

  const tokenHash = await hashSessionToken(token);
  const session = await findSession(env.DB, tokenHash);

  if (!session) {
    throw new UnauthorizedError("Session not found or expired");
  }

  if (session.expires_at < Date.now()) {
    await deleteSession(env.DB, tokenHash);
    throw new UnauthorizedError("Session expired");
  }

  const user = await findUserById(env.DB, session.user_id);
  if (!user || !user.enabled) {
    await deleteSession(env.DB, tokenHash);
    throw new UnauthorizedError("Account is disabled or not found");
  }

  if (session.auth_version !== user.auth_version) {
    await deleteSession(env.DB, tokenHash);
    throw new UnauthorizedError("Session invalidated; please log in again");
  }

  return {
    userId: user.id,
    username: user.username_display,
    role: user.role,
    authVersion: user.auth_version,
  };
}

/**
 * Validate the session and assert admin role.
 * Throws UnauthorizedError if not authenticated, ForbiddenError if not admin.
 */
export async function requireAdmin(request: Request, env: Env): Promise<AuthContext> {
  const ctx = await requireAuth(request, env);
  if (ctx.role !== "admin") {
    throw new ForbiddenError("Admin access required");
  }
  return ctx;
}

/**
 * Enforce same-origin for mutation requests when an Origin header is present.
 * Non-browser requests (no Origin header) pass through — e.g. the Mac bridge service.
 */
export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  const requestOrigin = new URL(request.url).origin;
  if (origin !== requestOrigin) {
    throw new ForbiddenError("Cross-origin requests not allowed");
  }
}
