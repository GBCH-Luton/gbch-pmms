// PMMS's only service worker, and its only job is web push -- no offline
// caching, no asset interception, deliberately minimal.

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* ignore malformed payloads */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'PMMS', {
      body: data.body || '',
      icon: '/icons.svg',
    })
  )
})

// Clicking the notification focuses an already-open tab if there is one,
// otherwise opens the app fresh. Deliberately doesn't deep-link to the
// specific ticket -- kept simple for this first version.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus()
      return self.clients.openWindow('/')
    })
  )
})
