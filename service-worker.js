const CACHE = 'dt-music-scores-shell-v4-20260930';
const LEGACY_CACHE = 'dt-music-scores-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      } catch (_) {
        // A missing optional shell asset should not prevent the worker installing.
      }
    }));

    // One-time migration from the old cache-first worker. This lets the fixed
    // worker take control without leaving users permanently stuck on v1.
    const keys = await caches.keys();
    if (keys.includes(LEGACY_CACHE)) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.startsWith('dt-music-scores-') && key !== CACHE)
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // Always ask the network for the newest hosted file. The cache is only the
    // offline fallback, not the primary source.
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (request.mode === 'navigate') {
        await cache.put('./index.html', response.clone());
      }
    }
    return response;
  } catch (_) {
    return (
      await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : undefined) ||
      Response.error()
    );
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(event.request));
});
