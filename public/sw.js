const CACHE_NAME = 'suivi-personnel-v3'
const APP_SHELL = [
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-512.png',
  '/apple-touch-icon.png'
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const isStaticAsset = url.pathname.endsWith('.png') || url.pathname.endsWith('.webmanifest') || url.pathname.endsWith('.svg')

  if (!isStaticAsset) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((cached) => cached || caches.match('/manifest.webmanifest'))))
    return
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone()
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => undefined)
      return response
    }))
  )
})

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {}
  const title = payload.title || 'Suivi personnel'
  const options = {
    body: payload.body || 'Rappel de suivi',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: payload.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ('focus' in client) {
        client.navigate(targetUrl)
        return client.focus()
      }
    }
    return clients.openWindow(targetUrl)
  }))
})
