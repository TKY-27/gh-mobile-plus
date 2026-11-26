import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

const RUNTIME_ASSET_CACHE = "ghm-assets-v1";
const RUNTIME_CACHE_PREFIX = "ghm-assets-";
const MAX_RUNTIME_ASSET_ENTRIES = 80;

async function trimRuntimeCache(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - MAX_RUNTIME_ASSET_ENTRIES;
  for (let index = 0; index < excess; index++) {
    const key = keys[index];
    if (key) await cache.delete(key);
  }
}

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/auth\//, /^\/auth(?:\?|$)/],
  }),
);
registerRoute(
  ({ request, url }) =>
    request.method === "GET" &&
    url.origin === self.location.origin &&
    url.pathname.startsWith("/assets/"),
  async ({ request }) => {
    const cache = await caches.open(RUNTIME_ASSET_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      try {
        await cache.put(request, response.clone());
        await trimRuntimeCache(cache);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "QuotaExceededError")) {
          reportError(error);
        }
      }
    }
    return response;
  },
);

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(RUNTIME_CACHE_PREFIX) && name !== RUNTIME_ASSET_CACHE)
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

self.addEventListener("message", (event) => {
  const message: unknown = event.data;
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "SKIP_WAITING"
  ) {
    event.waitUntil(self.skipWaiting());
  }
});
