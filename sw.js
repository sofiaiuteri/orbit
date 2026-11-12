// Service worker: shows push notifications and opens Orbit when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data.json(); } catch { d = { body: e.data?.text() || "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Orbit", { body: d.body || "", icon: "/assets/icon-192.png", badge: "/assets/icon-192.png", tag: d.tag, data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(e.notification.data.url))));
});
