const CACHE_NAME = 'matchpilot-shell-v1';
const OFFLINE_URL = '/offline.html';
const STATIC_ASSETS = [OFFLINE_URL, '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

function networkFetch(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  return fetch(request, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }
  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || networkFetch(request)));
  }
});
