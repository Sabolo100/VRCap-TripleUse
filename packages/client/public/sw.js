/*
 * Service worker — installability and a shell that opens offline.
 *
 * Deliberately conservative. A service worker that caches too eagerly is worse
 * than none: it can pin a broken build in front of every user with no way to
 * clear it. So:
 *
 *   navigations   network first, cache as a fallback. A new deploy is picked
 *                 up on the next load, never served stale while online.
 *   /assets/*     cache first. Vite fingerprints these, so a given URL's
 *                 content can never change.
 *   everything    else - API, WebSocket, anything cross-origin - is not
 *                 touched at all. The app already has its own offline queue
 *                 for runs, and a cached API response would be a lie.
 */

const VERSION = 'vrcap-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The API and the realtime channel must never be served from a cache.
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/ws')) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error()))
    );
    return;
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
        // Only a good response is worth keeping; caching a 404 is how a
        // deploy becomes permanently broken for someone.
        if (res.ok) {
          const copy = res.clone();
          caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
  }
});
