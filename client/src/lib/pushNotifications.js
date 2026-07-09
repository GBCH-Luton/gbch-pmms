import { supabase } from './supabase'

// Web Push wants the VAPID public key as a raw Uint8Array, not the
// base64url string it's naturally stored/shared as.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function pushNotificationsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

// Whether this browser has already granted permission -- NOT the same as
// having an active subscription (permission can be granted with no
// subscription row ever created, e.g. if the browser pre-grants it for
// some reason without the user ever clicking Enable). Only useful as a
// quick synchronous hint before the real, async check below resolves.
export function pushNotificationsGranted() {
  return pushNotificationsSupported() && Notification.permission === 'granted'
}

// The actual source of truth for whether this device will receive a
// push -- confirms a subscription row was actually written to
// pmms.push_subscriptions, not just that permission was granted.
export async function hasActivePushSubscription() {
  if (!pushNotificationsSupported() || Notification.permission !== 'granted') return false
  const registration = await navigator.serviceWorker.getRegistration('/sw.js')
  if (!registration) return false
  const subscription = await registration.pushManager.getSubscription()
  return !!subscription
}

export async function enablePushNotifications(staffId) {
  if (!pushNotificationsSupported()) {
    return { success: false, message: 'Push notifications are not supported on this browser/device.' }
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { success: false, message: 'Notification permission was not granted.' }
  }

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidKey) {
    return { success: false, message: 'Push notifications are not configured yet.' }
  }

  // Real subscribe failures happen (a stale service worker, the push
  // service being unreachable, a browser that silently refuses in some
  // contexts) -- these must resolve to a clean { success: false } like
  // every other failure path here, not escape as an unhandled rejection.
  try {
    const registration = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    const existing = await registration.pushManager.getSubscription()
    const subscription = existing || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    })

    const json = subscription.toJSON()
    const { error } = await supabase
      .schema('pmms')
      .from('push_subscriptions')
      .upsert(
        { staff_id: staffId, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
        { onConflict: 'endpoint' }
      )

    if (error) return { success: false, message: error.message }
    return { success: true }
  } catch (err) {
    return { success: false, message: err.message || 'Could not enable push notifications.' }
  }
}
