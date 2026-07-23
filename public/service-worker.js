const STATIC_CACHE = 'stanza-static-v7';
const RUNTIME_CACHE = 'stanza-runtime-v7';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/offline.html',
  '/icons/stanza-favicon.svg',
  '/icons/stanza-192.png',
  '/icons/stanza-512.png',
  '/icons/stanza-maskable-192.png',
  '/icons/stanza-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS)),
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

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

function isProfileImageRequest(url) {
  return url.pathname.startsWith('/profile-images/');
}

function isDevelopmentModuleRequest(url) {
  return (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@id/') ||
    url.pathname.startsWith('/node_modules/')
  );
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

async function networkOnlyApi(request) {
  try {
    return await fetch(request, { cache: 'no-store' });
  } catch {
    return offlineJsonResponse();
  }
}

async function networkOnlyMutation(request) {
  try {
    return await fetch(request, { cache: 'no-store' });
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
  const cachedResponse = await cache.match(request);

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
    // Authenticated HR API responses can contain payroll, grievance, attendance, role,
    // location, and employee data. They are intentionally network-only and never stored
    // in Cache Storage, so one browser user/session cannot receive another user's stale
    // private JSON while offline.
    // Mutating HR workflows are intentionally not cached or queued. Retrying login,
    // password reset, payroll, grievance, company feed, clock, or leave writes offline could
    // duplicate sensitive actions or replay stale credentials/payroll changes.
    event.respondWith(request.method === 'GET' ? networkOnlyApi(request) : networkOnlyMutation(request));
    return;
  }

  if (isProfileImageRequest(url)) {
    // Profile photos are user-specific media. Keep them out of shared PWA caches;
    // the avatar component falls back to initials when the network is unavailable.
    event.respondWith(networkOnlyApi(request));
    return;
  }

  if (url.origin !== self.location.origin || request.method !== 'GET') {
    return;
  }

  // A production worker can still control localhost after switching back to Vite.
  // Never serve cached source modules into that development session.
  if (isDevelopmentModuleRequest(url)) {
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
