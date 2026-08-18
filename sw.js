/* ExamPro service worker — offline app-shell cache. */
const CACHE = "exampro-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./src/vendor/supabase.js",
  "./src/vendor/jspdf.umd.min.js",
  "./src/vendor/pdf.min.mjs",
  "./src/vendor/pdf.worker.min.mjs",
  "./src/app.js",
  "./src/omr-detect.js",
  "./src/guard.js",
  "./src/shell.js",
  "./src/pages.js",
  "./src/ingestion-center.js",
  "./src/ingestion-engine.js",
  "./src/ai-solutions.js",
  "./src/official-sources.js",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never cache Supabase API/auth/storage calls.
  if (url.hostname.endsWith("supabase.co")) return;
  // App assets: NETWORK-FIRST with cache fallback. Cache-first previously
  // served stale application code after deploys (users saw old UI text and
  // stale button states indefinitely). Network-first guarantees the newest
  // code while the cache still serves offline.
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req);
    })
  );
});
