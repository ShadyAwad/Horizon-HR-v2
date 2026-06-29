const STATIC_CACHE = 'horizon-static-v1';
const RUNTIME_CACHE = 'horizon-runtime-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/offline.html',
  '/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => ![STATIC_CACHE, RUNTIME_CACHE].includes(cacheName))
          .map((cacheName) => caches.delete(cacheName)),
      ))
      .then(() => self.clients.claim()),
  );
});

function offlineJsonResponse() {
  return new Response(
    JSON.stringify({
      success: false,
      offline: true,
      error: 'You are offline. Please reconnect and try again.',
    }),
    {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function isSensitiveApiPath(pathname) {
  return pathname.startsWith('/api/auth/');
}

async function networkFirstApi(request) {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok && !isSensitiveApiPath(new URL(request.url).pathname)) {
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    const cachedResponse = await cache.match(request);
    return cachedResponse || offlineJsonResponse();
  }
}

async function navigationResponse(request) {
  try {
    return await fetch(request);
  } catch {
    const cachedShell = await caches.match('/index.html');
    const offlinePage = await caches.match('/offline.html');
    return cachedShell || offlinePage || Response.error();
  }
}

async function staticAssetResponse(request) {
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const cache = await caches.open(RUNTIME_CACHE);
  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  // Mutating HR workflows are intentionally not cached or queued. Retrying payroll,
  // grievance, auth, clock, or leave writes offline could duplicate sensitive actions.
  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  event.respondWith(staticAssetResponse(request));
});
