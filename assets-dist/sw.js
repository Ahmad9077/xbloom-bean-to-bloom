// Service worker: caches only immutable hashed static assets (JS/CSS bundles).
//
// NEVER caches:
//   • HTML / navigation requests (auth state must be server-verified)
//   • /api/* responses (private, dynamic)
//   • Non-GET requests
//
// This keeps PWA behaviour safe for authenticated private content:
// every page load hits the network so the server can enforce auth and redirect.

const CACHE = "xbloom-assets-v2";

// Only cache assets with content-hashed filenames (produced by Vite build).
function isCacheableAsset(url) {
  const path = new URL(url).pathname;
  return path.startsWith("/assets/") && (path.endsWith(".js") || path.endsWith(".css"));
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;

  // Only handle GET.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never intercept API calls.
  if (url.pathname.startsWith("/api/")) return;

  // Never intercept navigation (HTML) — let the server handle auth redirects.
  if (request.mode === "navigate") return;

  // Cache-first for hashed static assets only.
  if (isCacheableAsset(request.url)) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE).then((c) => c.put(request, clone));
            }
            return res;
          }),
      ),
    );
  }
});
