// ProAttendance service worker — network-first, cache sebagai sandaran
const CACHE = 'pa-v3';
const SHELL = ['/', '/index.html', '/admin.html', '/css/app.css', '/js/ui.js', '/js/fb.js', '/js/config.js', '/js/pekerja.js', '/js/admin.js', '/js/sched.js', '/js/payroll.js', '/icon.svg', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
