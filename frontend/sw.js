/* Offline support: keeps the website's own files (pages, styles, scripts, images) so the app still opens with no
   signal. API calls are never cached here; Assist keeps its own copy of the guides and an outbox for reports. */
const CACHE = "lilikas-v1";
const SHELL = ["index.html", "overview.html", "map.html", "alerts.html", "preparedness.html", "location.html", "share.html",
  "alert-preferences.html", "route.html", "methodology.html", "login.html", "signup.html", "info.html",
  "assets/css/theme.css", "assets/css/app.css", "assets/css/pages.css", "assets/css/public.css",
  "assets/js/config.js", "assets/js/core.js", "assets/js/shell.js", "assets/js/public.js", "assets/js/assist.js", "assets/js/mapkit.js",
  "assets/js/pages/overview.js", "assets/js/pages/map.js", "assets/js/pages/alerts.js", "assets/js/pages/preparedness.js", "assets/js/pages/auth.js",
  "assets/img/favicon.svg", "assets/vendor/leaflet/leaflet.js", "assets/vendor/leaflet/leaflet.css", "manifest.webmanifest"];

self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;     // API and map tiles go straight to the network
  // network first (so edits show up right away), the saved copy only when there is no connection
  e.respondWith(caches.open(CACHE).then(c => fetch(e.request)
    .then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
    .catch(() => c.match(e.request, { ignoreSearch: true }))));
});
