/**
 * Attach baseline security headers to an existing Headers object.
 * Call this on every response before returning.
 */
export function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  // API returns only JSON — no scripts, styles, or external resources needed
  headers.set("Content-Security-Policy", "default-src 'none'");
}
