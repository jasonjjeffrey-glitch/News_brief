/* Offline support: app files cached; news fetched fresh when online. */
const CACHE = "daily-ideas-v1";
const FILES = ["./", "index.html", "style.css", "app.js", "books.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon-180.png", "news.json"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  // network first (so updates and news arrive), fall back to cache offline
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(u.pathname.endsWith("news.json") ? "news.json" : e.request, copy)); return r; })
    .catch(() => caches.match(u.pathname.endsWith("news.json") ? "news.json" : e.request).then(m => m || caches.match("index.html"))));
});
