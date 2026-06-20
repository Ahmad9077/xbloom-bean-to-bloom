import { enforceSameOrigin, requireAuth } from "../auth/middleware.js";
import { dummyVerify, verifyPassword } from "../auth/password.js";
import {
  buildExpiredCookie,
  buildSessionCookie,
  extractSessionToken,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "../auth/session.js";
import {
  LOGIN_MAX_ATTEMPTS,
  clearLoginAttempts,
  countRecentLoginAttempts,
  createSession,
  deleteSession,
  findUserByNormalized,
  pruneLoginAttempts,
  recordLoginAttempt,
} from "../db.js";
import { ClientError, RateLimitError, UnauthorizedError } from "../errors.js";
import { parseUsername } from "../sanitize.js";
import type { Env } from "../types.js";

/**
 * POST /api/auth/login  { username, password }
 * Returns: { ok, user: { id, username, role } }
 * Sets __Host-xbloom_session cookie on success.
 */
export async function handleLogin(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  enforceSameOrigin(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ClientError("Expected JSON body");
  }

  if (typeof body !== "object" || body === null) throw new ClientError("Invalid request body");
  const obj = body as Record<string, unknown>;

  const rawUsername = typeof obj.username === "string" ? obj.username : "";
  const rawPassword = typeof obj.password === "string" ? obj.password : "";

  if (!rawUsername) throw new ClientError("Username is required");
  if (!rawPassword) throw new ClientError("Password is required");

  let usernameNormalized: string;
  let usernameValid = true;
  try {
    const parsed = parseUsername(rawUsername);
    usernameNormalized = parsed.normalized;
  } catch {
    usernameNormalized = "__invalid_username__";
    usernameValid = false;
  }

  // Rate limit: hash of normalized username + partial IP (not logged raw)
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const keyMaterial = `${usernameNormalized}:${ip}`;
  const keyDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial));
  const keyHash = Array.from(new Uint8Array(keyDigest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Prune old attempts inline (best-effort)
  await pruneLoginAttempts(env.DB).catch(() => {});

  const attempts = await countRecentLoginAttempts(env.DB, keyHash);
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    throw new RateLimitError("Too many failed login attempts. Try again in 15 minutes.");
  }

  if (!usernameValid) {
    await dummyVerify();
    await recordLoginAttempt(env.DB, keyHash);
    throw new UnauthorizedError("Invalid username or password");
  }

  const user = await findUserByNormalized(env.DB, usernameNormalized);

  if (!user) {
    await dummyVerify();
    await recordLoginAttempt(env.DB, keyHash);
    throw new UnauthorizedError("Invalid username or password");
  }

  const ok = await verifyPassword(rawPassword, user.password_hash);
  if (!ok || !user.enabled) {
    await recordLoginAttempt(env.DB, keyHash);
    throw new UnauthorizedError("Invalid username or password");
  }

  // Success: create session
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);
  await createSession(env.DB, {
    tokenHash,
    userId: user.id,
    authVersion: user.auth_version,
    expiresAt: sessionExpiresAt(),
  });
  await clearLoginAttempts(env.DB, keyHash);

  const resBody = JSON.stringify({
    ok: true,
    requestId,
    user: { id: user.id, username: user.username_display, role: user.role },
  });

  return new Response(resBody, {
    status: 200,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Set-Cookie": buildSessionCookie(token),
    },
  });
}

/**
 * POST /api/auth/logout
 * Deletes the session row and expires the cookie.
 */
export async function handleLogout(
  request: Request,
  env: Env,
  requestId: string,
): Promise<Response> {
  enforceSameOrigin(request);
  const cookieHeader = request.headers.get("Cookie");
  const token = extractSessionToken(cookieHeader);

  if (token) {
    const tokenHash = await hashSessionToken(token);
    await deleteSession(env.DB, tokenHash).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, requestId }), {
    status: 200,
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "Set-Cookie": buildExpiredCookie(),
    },
  });
}

/**
 * GET /api/auth/me
 * Returns the current user or 401.
 */
export async function handleMe(request: Request, env: Env, requestId: string): Promise<Response> {
  const ctx = await requireAuth(request, env);
  return new Response(
    JSON.stringify({
      ok: true,
      requestId,
      user: { id: ctx.userId, username: ctx.username, role: ctx.role },
    }),
    { status: 200, headers: { "Content-Type": "application/json;charset=UTF-8" } },
  );
}
