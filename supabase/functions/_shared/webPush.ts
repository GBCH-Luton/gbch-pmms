import webpush from 'npm:web-push@3'

// Shared by send-push-notifications (manager/admin-triggered, user-gated)
// and check-stuck-tickets (cron-triggered, secret-gated) -- both just need
// to push a title/body to a set of staff IDs and clean up dead
// subscriptions, they differ only in how the caller is authorized.
export async function sendWebPushToStaff(adminClient: any, staffIds: string[], title: string, body: string) {
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!vapidPublicKey || !vapidPrivateKey) {
    return { sent: 0, total: 0, error: 'Push notifications are not configured (missing VAPID keys).' }
  }

  webpush.setVapidDetails('mailto:admin@example.com', vapidPublicKey, vapidPrivateKey)

  const { data: subs, error: subsError } = await adminClient
    .schema('pmms')
    .from('push_subscriptions')
    .select('*')
    .in('staff_id', staffIds)

  if (subsError) return { sent: 0, total: 0, error: subsError.message }
  if (!subs?.length) return { sent: 0, total: 0 }

  const payload = JSON.stringify({ title, body })

  const results = await Promise.allSettled(
    subs.map((sub: any) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      )
    )
  )

  // Prune subscriptions the push service says no longer exist, so they
  // don't keep being (fruitlessly) retried on every future alert.
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const statusCode = (result as any).reason?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await adminClient.schema('pmms').from('push_subscriptions').delete().eq('id', subs[i].id)
      }
    }
  }

  const sent = results.filter(r => r.status === 'fulfilled').length
  return { sent, total: results.length }
}
