const CACHE = 'dt-music-scores-shell-v4-20261002';
const LEGACY_CACHE = 'dt-music-scores-v1';
const TABLET_FIX = './pdfjs-tablet-fix.js';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  TABLET_FIX,
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(APP_SHELL.map(async url => {
      try {
        const response = await fetch(new Request(url, { cache: 'reload' }));
        if (response.ok) await cache.put(url, response);
      } catch (_) {
        // Optional assets can be retried later; do not block installation.
      }
    }));
    const keys = await caches.keys();
    if (keys.includes(LEGACY_CACHE)) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('dt-music-scores-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function injectTabletFix(response) {
  if (!response || !response.ok) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes('pdfjs-tablet-fix.js')) {
    html = html.replace('</body>', '<script src="./pdfjs-tablet-fix.js"></script>\n</body>');
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(html, {status:response.status,statusText:response.statusText,headers});
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      await cache.put(request, response.clone());
      if (request.mode === 'navigate') await cache.put('./index.html', response.clone());
    }
    return request.mode === 'navigate' ? await injectTabletFix(response) : response;
  } catch (_) {
    const fallback = await cache.match(request, { ignoreSearch: true }) || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (!fallback) return Response.error();
    return request.mode === 'navigate' ? await injectTabletFix(fallback) : fallback;
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
  if (url.hostname === 'cdn.jsdelivr.net' && (url.pathname.includes('/pdf-lib@') || url.pathname.includes('/jszip@') || url.pathname.includes('/pdfjs-dist@'))) {
    event.respondWith(cacheFirstExternal(event.request));
  }
});
