// PlayUp Official Service Worker — Real-Time Push Notifications & Offline Delivery
const CACHE_NAME = 'playup-pwa-v2.4.1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Listen for Web Push events from backend push service (works when app is closed / phone is locked)
self.addEventListener('push', (event) => {
  let payload = {
    title: 'PlayUp',
    body: 'Votre commande est terminée.',
    orderNumber: '',
    tag: 'playup-order-delivery'
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        title: parsed.title || 'PlayUp',
        body: parsed.body || payload.body,
        orderNumber: parsed.orderNumber || '',
        tag: parsed.orderNumber ? `playup-order-${parsed.orderNumber}` : 'playup-order-delivery'
      };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/playup-icon.svg',
      badge: '/playup-icon.svg',
      tag: payload.tag,
      renotify: false,
      requireInteraction: true,
      data: {
        url: '/?tab=account',
        orderNumber: payload.orderNumber
      }
    })
  );
});

// Allow client / SSE bridge to trigger native OS notification via ServiceWorkerRegistration
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SHOW_ORDER_DELIVERED_NOTIFICATION') return;

  const title = data.title || 'PlayUp';
  const body = data.body || 'Votre commande est terminée.';
  const tag = data.orderNumber ? `playup-order-${data.orderNumber}` : `playup-notif-${Date.now()}`;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/playup-icon.svg',
      badge: '/playup-icon.svg',
      tag,
      renotify: false,
      requireInteraction: true,
      data: {
        url: '/?tab=account',
        orderNumber: data.orderNumber || ''
      }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
