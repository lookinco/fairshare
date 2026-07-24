// FairShare service worker — cache the shell so it opens offline.
const CACHE = "fairshare-v6";
const ASSETS = ["./", "index.html", "app.js", "split.mjs", "manifest.webmanifest", "icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return; // never cache the receipt POST
  e.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
