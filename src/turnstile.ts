import { ClientError, TurnstileError, UpstreamError } from "./errors.js";
import type { TurnstileVerifyResponse } from "./types.js";

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token server-side.
 * Throws TurnstileError on verification failure, ClientError when token is missing,
 * or UpstreamError when the Turnstile API itself fails.
 *
 * `fetchFn` is injected for testability; defaults to global fetch.
 */
export async function verifyTurnstile(
  token: string | null,
  secretKey: string,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (!token || token.trim() === "") {
    throw new ClientError(
      'Turnstile token required. Include "cf-turnstile-response" in the form data.',
    );
  }

  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });

  let res: Response;
  try {
    res = await fetchFn(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
    });
  } catch {
    throw new UpstreamError("Turnstile API unreachable");
  }

  if (!res.ok) {
    throw new UpstreamError(`Turnstile API returned HTTP ${res.status}`);
  }

  let result: TurnstileVerifyResponse;
  try {
    result = (await res.json()) as TurnstileVerifyResponse;
  } catch {
    throw new UpstreamError("Turnstile API response was not valid JSON");
  }

  if (!result.success) {
    throw new TurnstileError("Turnstile verification failed");
  }
}
