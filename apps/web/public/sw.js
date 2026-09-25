/* Stays service worker — app shell caching, offline fallback for the stay & guide, and web push. */
const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;
const OFFLINE_API = ['/api/v1/portal/home', '/api/v1/public/guide', '/api/v1/public/site', '/api/v1/portal/bookings'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/offline.html', '/icons/icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // Selected guest data: network first, fall back to the last copy so the stay works on weak Wi-Fi.
  if (OFFLINE_API.some((p) => url.pathname.startsWith(p))) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req).then((r) => r || new Response(JSON.stringify({ error: { code: 'offline', message: 'You are offline' } }), { status: 503, headers: { 'content-type': 'application/json' } }))),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // everything else: always live

  // Static build assets: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })));
    return;
  }

  // Pages: network first, cached copy, then the offline page.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match('/offline.html'))),
    );
  }
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Update', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Update', { body: d.body || '', tag: d.tag, icon: '/icons/icon.svg', badge: '/icons/icon.svg', data: { url: d.url || '/' } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (new URL(c.url).pathname.startsWith(target) && 'focus' in c) return c.focus();
      return self.clients.openWindow(target);
    }),
  );
});
