/**
 * Parse the ALLOWED_ORIGINS env var into a set of exact-match origin strings.
 * Returns an empty set when the variable is absent or blank (deny-by-default).
 */
export function parseAllowedOrigins(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Build CORS response headers for a given request origin.
 * Returns an empty Headers when the origin is not in the allow-list,
 * causing the browser to block the cross-origin request.
 * Never reflects arbitrary origins.
 */
export function buildCorsHeaders(
  requestOrigin: string | null,
  allowedOrigins: Set<string>,
): Headers {
  const h = new Headers();
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    h.set("Access-Control-Allow-Origin", requestOrigin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    h.set("Access-Control-Allow-Headers", "Content-Type");
    h.set("Access-Control-Max-Age", "86400");
  }
  return h;
}

/**
 * Handle an OPTIONS preflight. Returns 204 with appropriate CORS headers
 * (which will be empty for disallowed origins — browser will block).
 */
export function handlePreflight(
  requestOrigin: string | null,
  allowedOrigins: Set<string>,
): Response {
  const corsHeaders = buildCorsHeaders(requestOrigin, allowedOrigins);
  return new Response(null, { status: 204, headers: corsHeaders });
}
