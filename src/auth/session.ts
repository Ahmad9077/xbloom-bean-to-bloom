/**
 * Session token management.
 *
 * A session token is 32 random bytes encoded as a 64-char lowercase hex string.
 * Only the SHA-256 hex digest is stored in D1; the plaintext token lives only
 * in the cookie and is never written to any log or storage.
 *
 * Cookie: __Host-xbloom_session; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age 604800
 */

export const COOKIE_NAME = "__Host-xbloom_session";
const SESSION_MAX_AGE_SEC = 604_800; // 7 days

export function generateSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

export function buildExpiredCookie(): string {
  return `${COOKIE_NAME}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/** Parse the session token from a Cookie header. Returns null if absent. */
export function extractSessionToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name?.trim() === COOKIE_NAME) {
      const token = rest.join("=").trim();
      return /^[a-f0-9]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}

export function sessionExpiresAt(): number {
  return Date.now() + SESSION_MAX_AGE_SEC * 1000;
}
