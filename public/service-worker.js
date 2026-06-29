const STATIC_CACHE = 'horizon-static-v2';
const RUNTIME_CACHE = 'horizon-runtime-v2';
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

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isStaticAssetRequest(request, url) {
  return (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith('/assets/') ||
      ['script', 'style', 'image', 'font', 'manifest'].includes(request.destination) ||
      /\.(?:js|css|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/.test(url.pathname)
    )
  );
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

async function networkOnlyMutation(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineJsonResponse();
  }
}

async function navigationResponse(request) {
  const cache = await caches.open(STATIC_CACHE);

  try {
    const response = await fetch(request);

    if (response.ok) {
      cache.put('/index.html', response.clone());
    }

    return response;
  } catch {
    const cachedShell = await caches.match('/index.html');
    const offlinePage = await caches.match('/offline.html');
    return cachedShell || offlinePage || Response.error();
  }
}

async function staticAssetResponse(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    fetch(request)
      .then((response) => {
        if (response.ok) {
          cache.put(request, response);
        }
      })
      .catch(() => undefined);

    return cachedResponse;
  }

  const response = await fetch(request);

  if (response.ok) {
    cache.put(request, response.clone());
  }

  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isApiRequest(url)) {
    // Mutating HR workflows are intentionally not cached or queued. Retrying login,
    // password reset, payroll, grievance, clock, or leave writes offline could
    // duplicate sensitive actions or replay stale credentials/payroll changes.
    if (request.method !== 'GET') {
      event.respondWith(networkOnlyMutation(request));
      return;
    }

    event.respondWith(networkFirstApi(request));
    return;
  }

  if (url.origin !== self.location.origin || request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationResponse(request));
    return;
  }

  if (isStaticAssetRequest(request, url)) {
    event.respondWith(staticAssetResponse(request));
  }
});
