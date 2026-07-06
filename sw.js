/* RefertoAI — © 2026 Goffredo Ferrarese. Tutti i diritti riservati. Vedi file LICENSE. */
// sw.js — service worker: cache della shell dell'app (network-first con fallback cache).
// Le chiamate all'API Claude NON passano mai da qui (dominio diverso, sempre rete).

const CACHE = 'refertoai-v2';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './js/app.js',
  './js/api.js',
  './js/prompts.js',
  './js/storage.js',
  './js/wizard.js',
  './js/ui.js',
  './js/db.js',
  './js/extract.js',
  './js/sync.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Solo risorse della shell, stessa origine, GET.
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(event.request, copy));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
