const CACHE_NAME = "folio-shell-v3";
const APP_SHELL = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json().catch(() => ({ title: event.data.text() })) : Promise.resolve({ title: "Truepost", body: "" });
  event.waitUntil(
    Promise.resolve(data).then((d) =>
      self.registration.showNotification(d.title || "Truepost", {
        body: d.body || "",
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        data: d,
      }),
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "folio-offline-queue") {
    event.waitUntil(
      clients.matchAll().then((cs) => cs.forEach((c) => c.postMessage({ type: "folio-sync" }))),
    );
  }
});
