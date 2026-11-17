const CACHE = "cash-pwa-v2"; // поднимите версию, чтобы сбросить старый кэш
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  // API не кэшируем
  if (
    e.request.url.includes("cbr-xml-daily.ru") ||
    e.request.url.includes("open.er-api.com") ||
    e.request.url.includes("jsdelivr.net")
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((r) => {
      return (
        r ||
        fetch(e.request).catch(() => {
          // Если это навигация и сети нет — вернём index.html
          if (e.request.mode === "navigate") {
            return caches.match("./index.html");
          }
        })
      );
    }),
  );
});
