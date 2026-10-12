// Service worker: lets the app open without a connection so field staff can keep recording
// inspections and verification results (they are queued on the device and sent later).
//  - the app shell and built files are cached
//  - /api/* is never cached: data is private, and always comes fresh from the server
// v2: v1 also kept, cache-first, whatever came back for a missing photo (the app page) and showed it forever;
// changing the name makes every browser drop that cache.
// v3: the City emblem replaced the old icon.
const CACHE = 'jimma-ams-shell-v3';
const SHELL = ['/', '/brand/favicon-32.png', '/brand/logo-256.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // page loads: the network first (so a new version is picked up), the cached shell when offline
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }

  // A page (HTML) is never kept under a file's address: it is what the server answers for a file that is missing.
  const keep = (res) => {
    if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
    }
    return res;
  };

  // built files have content hashes in their names (a new version is a new name): cache first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(keep)));
    return;
  }

  // everything else (the front page's photos, icons ...) keeps its name when replaced: the network first, so a new
  // file shows at once, and the copy on this device when offline
  event.respondWith(fetch(request).then(keep).catch(() => caches.match(request)));
});
