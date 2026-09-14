const CACHE_NAME = "zizo-media-v1";
const MEDIA_RE = /\/hls\/|\/stream\/|\/info\//;

self.addEventListener("install", event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);
    if (!MEDIA_RE.test(url.pathname)) {
        return;
    }

    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) {
            return cached;
        }

        const response = await fetch(request);
        if (response.ok && (url.pathname.includes("/hls/") || url.pathname.includes("/info/"))) {
            cache.put(request, response.clone());
        }
        return response;
    })());
});
