// Loaded into the Workbox-generated service worker via importScripts (see
// vite.config.ts workbox.importScripts). Workbox's generateSW mode writes its
// own sw.js at build time and does not run any hand-authored service worker
// file placed in public/, so push notification handling has to be injected
// this way rather than living in a standalone sw.js.
self.addEventListener("push", (event) => {
  const data = event.data
    ? event.data.json().catch(() => ({ title: event.data.text() }))
    : Promise.resolve({ title: "Truepost", body: "" });
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
