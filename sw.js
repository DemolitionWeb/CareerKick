/* Service worker: l'app funziona anche offline e Chrome la può installare.
 * Strategia "stale-while-revalidate": risponde subito dalla cache e intanto scarica la versione nuova,
 * così dopo un aggiornamento dei giocatori basta riaprire l'app per vederli. */
// VERSION la scrive il deploy (deploy.yml) con il commit pubblicato: "dev" vale solo in locale.
// La stessa versione è nei link ?v= di index.html, così Cloudflare e i browser scaricano i file nuovi a ogni pubblicazione.
const VERSION = "dev";
const CACHE = "careerkick-" + VERSION;
const SHELL = [
  "./", "index.html", "css/style.css?v=" + VERSION, "js/i18n.js?v=" + VERSION, "js/data.js?v=" + VERSION, "js/app.js?v=" + VERSION,
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
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // /api/ (statistiche e dashboard) va sempre in rete: dalla cache la dashboard mostrerebbe dati vecchi
  if (url.pathname.startsWith("/api/")) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // la pagina si cerca senza parametri (?lang=, ?duel= sono la stessa pagina); CSS e JS invece con il loro ?v=,
      // altrimenti una versione nuova riceverebbe il file vecchio dalla cache
      const cached = await cache.match(req, { ignoreSearch: req.mode === "navigate" });
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
