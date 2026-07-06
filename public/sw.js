// Recirculate service worker — Web Push only (no offline caching, so the app
// always loads fresh).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title || "Recirculate", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url || "/" },
    })
  );
});

// Take control immediately — navigate() only works on controlled clients.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        try {
          await w.focus();
          await w.navigate(url);
          return;
        } catch {
          // uncontrolled client — fall through to opening a fresh window
        }
      }
      await clients.openWindow(url);
    })()
  );
});
