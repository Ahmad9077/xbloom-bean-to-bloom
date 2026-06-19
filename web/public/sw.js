// Service worker: caches the static shell for offline access.
// Derives the shell URL from the registration scope so it works at any
// GitHub Pages subpath (e.g. /repo-name/) without hardcoding "/".
//
// NEVER caches:
//   • non-GET requests  (API POSTs, user image uploads)
//   • Workers API calls (*.workers.dev)
//   • local bridge      (127.0.0.1 or localhost)

const CACHE = "xbloom-shell-v1";

// self.registration.scope is the fully-qualified URL of the SW scope,
// e.g. "https://user.github.io/repo/" or "http://localhost:5173/".
// We cache the scope root as the shell entry point.
const SHELL_URL = self.registration.scope;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.add(new Request(SHELL_URL, { cache: "reload" })),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;

  // Never intercept non-GET requests (POSTs, uploads, etc.).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache Worker API or local bridge calls.
  if (url.hostname.endsWith("workers.dev")) return;
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return;

  // For navigation requests: serve cached shell, fall back to network.
  if (request.mode === "navigate") {
    e.respondWith(
      caches
        .match(SHELL_URL)
        .then((cached) => cached ?? fetch(request)),
    );
    return;
  }

  // Static assets: cache-first, fill from network.
  e.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  );
});
