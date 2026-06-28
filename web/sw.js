/* ACTIG PWA service worker — caches the app shell so it launches offline.
   (Three.js / MediaPipe load from CDN and need a network the first time.) */
const CACHE = "actig-v1";
const SHELL = [
  "./", "./index.html", "./styles.css", "./app.js", "./studio.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API calls; always go to network.
  if (url.hostname.includes("anthropic.com")) return;
  // Cache-first for our own shell, network fallback otherwise.
  if (url.origin === location.origin) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
