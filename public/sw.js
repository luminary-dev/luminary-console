// Console service worker — exists for two things only:
//  1. makes the installed app a real PWA (required for iOS push), and
//  2. shows Web Push notices and routes their taps back into the app.
// No offline caching on purpose: every console page is authed and dynamic,
// and the proxy already serves them with Cache-Control: no-store.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: "Luminary", body: event.data.text() };
  }
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/badge.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(data.title || "Luminary", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Reuse the installed app's window if one is open, else open a new one.
      for (const win of wins) {
        if ("focus" in win) {
          win.focus();
          if ("navigate" in win) win.navigate(url).catch(() => {});
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
