const CACHE = 'dt-music-scores-shell-v10-20261003';
const TABLET_FIX = './pdfjs-tablet-fix.js';
const PLAYER_TOPBAR = './player-topbar.js';
const LIBRARY_ENHANCE = './library-move-single-player.js';
const RUNTIME_FIX = './runtime-fix.js';

// Keep install fast: cache only local app-shell files here.
// Large CDN libraries are cached on demand by the fetch handler instead.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  TABLET_FIX,
  PLAYER_TOPBAR,
  LIBRARY_ENHANCE,
  RUNTIME_FIX
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      } catch (_) {
        // A missing optional asset should never block an app update.
      }
    }));
    // Always activate the newest worker instead of leaving it stuck in "waiting".
    await self.skipWaiting();
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

async function injectEnhancements(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  let html = await response.text();
  const scripts = [];
  if (!html.includes('pdfjs-tablet-fix.js')) scripts.push('<script src="./pdfjs-tablet-fix.js"></script>');
  if (!html.includes('player-topbar.js')) scripts.push('<script src="./player-topbar.js"></script>');
  if (!html.includes('library-move-single-player.js')) scripts.push('<script src="./library-move-single-player.js"></script>');
  if (!html.includes('runtime-fix.js')) scripts.push('<script src="./runtime-fix.js"></script>');
  if (scripts.length) html = html.replace('</body>', scripts.join('\n') + '\n</body>');

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (request.mode === 'navigate') await cache.put('./index.html', response.clone());
    }
    return request.mode === 'navigate' ? await injectEnhancements(response) : response;
  } catch (_) {
    const fallback =
      await cache.match(request, { ignoreSearch: true }) ||
      (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (!fallback) return Response.error();
    return request.mode === 'navigate' ? await injectEnhancements(fallback) : fallback;
  }
}

async function cacheFirstExternal(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net' && (
    url.pathname.includes('/pdf-lib@') ||
    url.pathname.includes('/jszip@') ||
    url.pathname.includes('/pdfjs-dist@')
  )) {
    event.respondWith(cacheFirstExternal(event.request));
  }
});
