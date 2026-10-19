// Cache para usar la app sin red mientras armas.
// Archivos propios (app, datos, modelos): red primero, cache si no hay red.
// Externos (three.js fijado por version, fuentes, fotos de Brickit): cache primero.
const CACHE = 'legobuilds-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname === 'api.github.com') return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (url.origin === location.origin) {
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('./')) || Response.error();
      }
    }
    const hit = await cache.match(req);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  })());
});
