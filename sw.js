// Banana Traveller service worker
// - App files: network first (so updates arrive), cached copy when offline.
// - Fonts and the Supabase library: cache first (they don't change).
// - Supabase data, photos/videos and /api: never cached (private + always live).

const VERSION = 'bt-v1';
const SHELL = [
  '/', '/index.html', '/styles.css', '/config.js', '/manifest.webmanifest',
  '/js/app.js', '/js/core.js', '/js/auth.js', '/js/feed.js', '/js/events.js',
  '/js/chat.js', '/js/friends.js', '/js/me.js', '/js/pwa.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isStatic = (url) =>
  url.hostname === 'fonts.googleapis.com' ||
  url.hostname === 'fonts.gstatic.com' ||
  (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js'));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never touch Supabase (data, auth, signed photo/video links) or our API
  if (url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/api/')) return;

  if (isStatic(url)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((hit) => hit || (req.mode === 'navigate' ? caches.match('/index.html') : undefined))
          .then((hit) => hit || new Response('Offline', { status: 503, statusText: 'Offline' }))
      )
    );
  }
});
