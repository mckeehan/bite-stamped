// Keeps the app itself available offline. Data never passes through here:
// it lives in IndexedDB, and the sync API always goes to the network.
// App files are served from the cache and refreshed in the background. A new
// release installs a fresh copy of every file and takes over right away; the
// page then reloads into it (app.js).

// Must match js/version.js (a test checks). It is written out here, not
// imported, because browsers decide whether there is an update by comparing
// this file's bytes, and Safari ignores changes in imported scripts.
const VERSION = 'v2.7.1';
const CACHE = `bite-stamped-${VERSION}`;
// The sync API sits next to this file (e.g. /bites/api/ when served below /bites).
const API_PATH = new URL('api/', self.registration.scope).pathname;
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/repo.js',
  'js/store.js',
  'js/model.js',
  'js/yaml.js',
  'js/zip.js',
  'js/images.js',
  'js/places.js',
  'js/md.js',
  'js/sync.js',
  'js/version.js',
  'js/map.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/powered-by-foursquare.svg',
  'icons/powered-by-foursquare-dark.svg',
];

self.addEventListener('install', (event) => {
  // Bypass the HTTP cache, so the new version gets new files.
  const requests = FILES.map((f) => new Request(f, { cache: 'reload' }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(requests)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bite-stamped-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith(API_PATH)) return;

  const key = req.mode === 'navigate' ? './' : req;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        event.waitUntil(fresh);
        return cached;
      }
      return fresh;
    }),
  );
});
