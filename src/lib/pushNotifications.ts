import { apiClient } from '../services/apiClient';
import { PushNotificationLog } from '../types';

let activeEventSource: EventSource | null = null;
let activeToken: string | null = null;
const shownNotificationIds = new Set<string>();

export function detectClientPlatform(): 'android' | 'ios' | 'desktop' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'desktop';
}

export async function registerPlayUpServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return reg;
  } catch {
    return null;
  }
}

export async function displayNativePushNotification(notif: {
  id?: string;
  title: string;
  body: string;
  orderNumber?: string;
}): Promise<boolean> {
  const dedupKey = notif.id || (notif.orderNumber ? `ord_${notif.orderNumber}` : `${notif.title}_${notif.body}`);
  if (shownNotificationIds.has(dedupKey)) {
    return false;
  }
  shownNotificationIds.add(dedupKey);

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  if (Notification.permission !== 'granted') {
    return false;
  }

  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg && reg.active) {
      reg.active.postMessage({
        type: 'SHOW_ORDER_DELIVERED_NOTIFICATION',
        title: notif.title,
        body: notif.body,
        orderNumber: notif.orderNumber
      });
      return true;
    }
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(notif.title, {
        body: notif.body,
        icon: '/playup-icon.svg',
        badge: '/playup-icon.svg',
        tag: notif.orderNumber ? `playup-order-${notif.orderNumber}` : `playup-notif-${Date.now()}`
      });
      return true;
    }
    new Notification(notif.title, {
      body: notif.body,
      icon: '/playup-icon.svg',
      tag: notif.orderNumber ? `playup-order-${notif.orderNumber}` : undefined
    });
    return true;
  } catch {
    return false;
  }
}

export async function requestAndSubscribePushNotifications(token: string): Promise<{
  granted: boolean;
  permission: NotificationPermission | 'unsupported';
  queuedOfflineNotifications: PushNotificationLog[];
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { granted: false, permission: 'unsupported', queuedOfflineNotifications: [] };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      permission = 'denied';
    }
  }

  const reg = await registerPlayUpServiceWorker();
  const devicePlatform = detectClientPlatform();
  let endpoint = `sw-push://${devicePlatform}/${Date.now()}`;
  let keys: { p256dh: string; auth: string } | undefined;

  if (reg && 'pushManager' in reg) {
    try {
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) {
        endpoint = existingSub.endpoint;
        const json = existingSub.toJSON();
        if (json.keys?.p256dh && json.keys?.auth) {
          keys = { p256dh: json.keys.p256dh, auth: json.keys.auth };
        }
      }
    } catch {
      // Fallback to SW + SSE push channel
    }
  }

  const res = await apiClient.subscribePushNotifications(token, {
    endpoint,
    keys,
    devicePlatform
  });

  if (permission === 'granted' && res.queuedOfflineNotifications?.length > 0) {
    for (const queued of res.queuedOfflineNotifications) {
      await displayNativePushNotification({
        id: queued.id,
        title: queued.title,
        body: queued.body,
        orderNumber: queued.orderNumber
      });
    }
  }

  return {
    granted: permission === 'granted',
    permission,
    queuedOfflineNotifications: res.queuedOfflineNotifications || []
  };
}

export function connectRealTimePushStream(
  token: string,
  onOrderDeliveredPush?: (notification: PushNotificationLog) => void
): () => void {
  if (typeof window === 'undefined' || !token) {
    return () => {};
  }

  if (activeEventSource && activeToken === token) {
    return () => {};
  }

  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  activeToken = token;
  registerPlayUpServiceWorker().catch(() => {});

  const es = new EventSource(`/api/notifications/push-stream?token=${encodeURIComponent(token)}`);
  activeEventSource = es;

  es.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data?.type === 'ORDER_DELIVERED_PUSH' && data.notification) {
        const notif: PushNotificationLog = data.notification;
        await displayNativePushNotification({
          id: notif.id,
          title: notif.title,
          body: notif.body,
          orderNumber: notif.orderNumber
        });
        if (onOrderDeliveredPush) {
          onOrderDeliveredPush(notif);
        }
      }
    } catch {
      // Ignore heartbeat or non-JSON comment lines
    }
  };

  es.onerror = () => {
    // EventSource automatically reconnects when device wakes from sleep/lock or regains network
  };

  return () => {
    es.close();
    if (activeEventSource === es) {
      activeEventSource = null;
      activeToken = null;
    }
  };
}
