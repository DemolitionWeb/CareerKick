/* Service worker: l'app funziona anche offline e Chrome la può installare.
 * La pagina (index.html) arriva prima dalla rete e solo senza connessione dalla cache: così dopo un deploy
 * si vede subito la versione nuova, che con i suoi link ?v= porta con sé i CSS e JS nuovi.
 * CSS, JS e immagini usano "stale-while-revalidate": rispondono subito dalla cache e intanto si aggiornano. */
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
  if (req.mode === "navigate") {
    // la pagina si salva sempre sotto l'indirizzo senza parametri (?lang=, ?duel= sono la stessa pagina).
    // Prima la si cercava con ignoreSearch, che restituiva la copia salvata all'installazione e mai quelle
    // aggiornate (salvate con il loro ?lang=): chi apriva /?lang=it restava sulla versione vecchia.
    const key = url.origin + url.pathname;
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
          return res;
        })
        .catch(async () => (await caches.match(key)) || caches.match("index.html"))
    );
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // CSS e JS si cercano con il loro ?v=: una versione nuova non deve ricevere il file vecchio dalla cache
      const cached = await cache.match(req);
      const fresh = fetch(req)
        .then((res) => { if (res.ok) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
