import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import type { PrecacheEntry } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (PrecacheEntry | string)[] };

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/auth\//, /^\/auth(?:\?|$)/],
  }),
);

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
