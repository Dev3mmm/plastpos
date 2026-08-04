// Caches the app shell only - all real data always comes fresh from the
// local server (/api/*), never from this cache, so stock/sales figures
// can never go stale from a service-worker cache bug.
const CACHE = 'plastpos-shell-v1';
const SHELL_FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/api.js',
  'js/app.js',
  'manifest.json',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache API calls
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
