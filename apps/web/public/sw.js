// Folio PWA service worker: installability only. This worker never caches
// anything beyond a fixed, explicit list of static app-shell assets. It
// never intercepts /api/* requests, receipt sources, bank data, P&L
// responses, authentication responses, or any other financial or session
// data - those always go straight to the network, uncached, unmodified.
const CACHE_NAME = "folio-shell-v2";
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
