/**
 * Bridge bearer-token validation.
 * The token is compared via a constant-time SHA-256 digest comparison.
 * The plaintext token is never logged.
 */
import { ForbiddenError } from "../errors.js";
import type { Env } from "../types.js";

export async function requireBridgeAuth(request: Request, env: Env): Promise<void> {
  if (!env.BRIDGE_TOKEN_HASH) {
    throw new ForbiddenError("Bridge not configured");
  }

  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    throw new ForbiddenError("Bridge authentication required");
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time string comparison
  if (!constantTimeStringEqual(tokenHash, env.BRIDGE_TOKEN_HASH)) {
    throw new ForbiddenError("Invalid bridge token");
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
