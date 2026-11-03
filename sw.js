/* Service worker: l'app funziona anche offline e Chrome la può installare.
 * Strategia "stale-while-revalidate": risponde subito dalla cache e intanto scarica la versione nuova,
 * così dopo un aggiornamento dei giocatori basta riaprire l'app per vederli. */
const CACHE = "careerkick-v2"; // cambiarlo quando cambia la logica dell'app, così i nuovi file arrivano al primo avvio
const SHELL = [
  "./", "index.html", "css/style.css", "js/i18n.js", "js/data.js", "js/app.js",
  "manifest.webmanifest", "icon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
