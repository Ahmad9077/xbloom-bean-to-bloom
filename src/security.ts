/**
 * Attach security headers to a Headers object.
 * SPA routes and API routes use different CSP values.
 */

const API_CSP = "default-src 'none'";
const SPA_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'";

export function applySecurityHeaders(headers: Headers, isSpa = false): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Content-Security-Policy", isSpa ? SPA_CSP : API_CSP);
  headers.set("X-XSS-Protection", "0");
  headers.set(
    "Permissions-Policy",
    isSpa
      ? "camera=(self), microphone=(), geolocation=(), payment=(), usb=()"
      : "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
}
