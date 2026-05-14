import { ExpirationPlugin } from "workbox-expiration";
/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  ({ url }: { url: URL }) =>
    /\/v1\/(auth\/[^/]+|portfolio|me|leaderboard|lessons|push)/.test(url.pathname) &&
    !url.pathname.includes("/auth/device") &&
    !url.pathname.includes("/auth/refresh"),
  new NetworkFirst({
    cacheName: "api-read",
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 })],
  }),
);

registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === "image" || request.destination === "font",
  new CacheFirst({
    cacheName: "static-assets",
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  }),
);

registerRoute(
  ({ url }: { url: URL }) => /https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/.test(url.href),
  new CacheFirst({
    cacheName: "google-fonts",
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 365 * 24 * 60 * 60 })],
  }),
);

self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  const data = event.data.json() as {
    title: string;
    body: string;
    tag: string;
    url?: string;
  };

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const url = (event.notification.data as { url: string }).url;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) {
          return (client as WindowClient).focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
