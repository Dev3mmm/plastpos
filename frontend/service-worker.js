// Caches the app shell only - all real data always comes fresh from the
// local server (/api/*), never from this cache. The server is always on
// the same LAN (that's the whole point of this app), so shell files use
// network-first: always fetch the latest code when the LAN is reachable,
// and only fall back to the cached copy if that one request fails. This
// matters because a cache-first strategy would silently keep serving an
// old version of the app after every update, with no way to notice.
const CACHE = 'plastpos-shell-v2';
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
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return; // never cache these
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
