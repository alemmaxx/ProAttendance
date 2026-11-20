// Firebase Cloud Messaging (notifikasi push latar belakang)
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js', 'https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp({
  apiKey: "AIzaSyDIncQ3Nt6v6_WbMCs42t81DZVg6f35Hwc",
  authDomain: "kukusanmy.firebaseapp.com",
  projectId: "kukusanmy",
  storageBucket: "kukusanmy.firebasestorage.app",
  messagingSenderId: "710803283811",
  appId: "1:710803283811:web:4ceb3dbabf376b7a39fd56"
});
  firebase.messaging();
} catch (e) { /* notifikasi tidak disokong */ }

// ProAttendance service worker — network-first, cache sebagai sandaran
const CACHE = 'pa-v42';
const SHELL = ['/', '/worker', '/worker.html', '/admin.html', '/css/app.css', '/js/ui.js', '/js/fb.js', '/js/config.js', '/js/pekerja.js', '/js/admin.js', '/js/sched.js', '/js/payroll.js', '/js/push.js', '/js/claims.js', '/js/fs.js', '/js/statutory.js', '/js/manual.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png', '/manifest.json'];

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
    }).catch(() => caches.match(req).then(r => r || caches.match(new URL(req.url).pathname.startsWith('/worker') ? '/worker' : '/')))
  );
});
