export const LEGACY_PUBLIC_HOST = "xbloom-recipe-worker.bean-to-bloom.workers.dev";
export const DEFAULT_CANONICAL_ORIGIN = "https://brew.bean-to-bloom.workers.dev";

function isPublicPagePath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/history" ||
    pathname === "/recipes" ||
    pathname.startsWith("/recipes/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

function canonicalOrigin(configuredOrigin?: string): string {
  if (!configuredOrigin?.trim()) return DEFAULT_CANONICAL_ORIGIN;

  try {
    const parsed = new URL(configuredOrigin.trim());
    const isOriginOnly =
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === "";
    if (isOriginOnly && parsed.hostname !== LEGACY_PUBLIC_HOST) return parsed.origin;
  } catch {
    // A bad deployment value must never turn the legacy host into an open redirect.
  }

  return DEFAULT_CANONICAL_ORIGIN;
}

/**
 * Redirect only browser-facing application pages from the legacy workers.dev
 * hostname. APIs and static files stay live there for existing bridge clients
 * and already-open browser sessions.
 */
export function redirectLegacyPage(request: Request, configuredOrigin?: string): Response | null {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return null;

  const source = new URL(request.url);
  if (source.hostname !== LEGACY_PUBLIC_HOST || !isPublicPagePath(source.pathname)) return null;

  const destination = new URL(
    `${source.pathname}${source.search}`,
    canonicalOrigin(configuredOrigin),
  );
  return new Response(null, {
    status: 308,
    headers: {
      Location: destination.toString(),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
