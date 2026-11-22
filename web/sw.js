// Fast, offline-friendly loading.
//  - App files (this site): always checked with the server first (quick 304s), so an update never
//    mixes old and new files. A cached copy is used only when offline.
//  - Fonts, the logo, product photos and face models: cached after first use and served instantly.
//  - The Apps Script API, Google sign-in and Telegram are never cached.
const CACHE = 'saatvikei-v5';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));

const NEVER = ['script.google.com', 'script.googleusercontent.com', 'accounts.google.com', 'oauth2.googleapis.com', 'api.telegram.org'];
const CACHE_FIRST = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com', 'saatvikei.com', 'cdn.shopify.com'];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER.some((h) => url.hostname.endsWith(h))) return;

  if (CACHE_FIRST.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req)));
});
