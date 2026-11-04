/* Static app-shell worker. Meeting data and API responses never enter these caches. */
const VERSION = __CACHE_VERSION__;
const BASE = __BASE_PATH__;
const ASSETS = __PRECACHE_ASSETS__;
const PREFIX = "meeting-memo-byok:" + BASE + ":";
const CACHE = PREFIX + VERSION;
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Keep one previous app cache for old tabs; never delete another application's caches.
      const keys = (await caches.keys()).filter(
        (key) => key.startsWith(PREFIX) && key !== CACHE,
      );
      await Promise.all(keys.slice(0, -1).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE) ||
    url.pathname.endsWith("/sw.js")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) throw new Error("Navigation unavailable");
          return response;
        })
        .catch(() => caches.match(BASE + "index.html", { cacheName: CACHE })),
    );
    return;
  }
  if (!ASSETS.includes(url.pathname)) {
    if (!url.pathname.startsWith(BASE + "assets/")) return;
    event.respondWith(
      (async () => {
        for (const key of (await caches.keys()).filter((key) =>
          key.startsWith(PREFIX),
        )) {
          const cached = await caches.match(url.pathname, { cacheName: key });
          if (cached) return cached;
        }
        return fetch(request);
      })(),
    );
    return;
  }
  event.respondWith(
    (async () => {
      const cached = await caches.match(url.pathname, { cacheName: CACHE });
      if (cached) return cached;
      return fetch(request);
    })(),
  );
});
