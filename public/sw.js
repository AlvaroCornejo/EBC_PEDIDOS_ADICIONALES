const CACHE = 'pedidos-v2';
const STATIC = ['/', '/app.js', '/styles.css', '/manifest.json', '/icon.svg'];

// Instalar: cachear recursos estáticos
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting()));
});

// Activar: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first para API, cache-first para estáticos
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return; // API siempre de red
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});

// Push: mostrar notificación nativa
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch {}
  const title = data.title || 'Pedidos Adicionales';
  const options = {
    body:   data.body  || '',
    icon:   '/icon.svg',
    badge:  '/icon.svg',
    vibrate: [200, 100, 200],
    data:   { url: data.url || '/' },
    actions: [{ action: 'open', title: 'Ver ahora' }]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Click en notificación: abrir/enfocar la app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus();
          client.postMessage({ type: 'NAVIGATE', url: target });
          return;
        }
      }
      clients.openWindow(target);
    })
  );
});
