/**
 * عامل الخدمة لمنصة مجالس: يفتح التطبيق بلا إنترنت.
 * - الصفحة: الشبكة أولًا، وعند الانقطاع النسخة المحفوظة.
 * - ملفات /assets/ (أسماؤها مُبصمة): من الذاكرة أولًا.
 * - طلبات Supabase لا تمر من هنا أبدًا؛ بيانات الحضور يتولاها طابور IndexedDB.
 */
const CACHE = 'majales-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok || res.type === 'opaque') {
    const c = await caches.open(CACHE);
    await c.put(request, res.clone());
  }
  return res;
}

async function networkFirstPage(request) {
  try {
    const res = await fetch(request);
    if (res.ok) {
      const c = await caches.open(CACHE);
      await c.put('/index.html', res.clone());
    }
    return res;
  } catch {
    return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (url.origin === self.location.origin && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname))) {
    event.respondWith(cacheFirst(request));
    return;
  }
});
