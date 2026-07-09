import webpush from 'npm:web-push@3'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'

// Every real caller of this function is a manager/admin action (a
// reassign with the push checkbox ticked, a direct assignment, or an
// automatic emergency alert triggered by a priority change) -- gated
// behind the same authorizeAdmin() check create-staff-account uses,
// rather than leaving it open to any authenticated request.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    await authorizeAdmin(req)

    const body = await req.json().catch(() => null)
    const staffIds = Array.isArray(body?.staffIds) ? body.staffIds : []
    const title = (body?.title || '').trim()
    const message = (body?.body || '').trim()

    if (!staffIds.length || !title) {
      return new Response(JSON.stringify({ error: 'staffIds and title are required' }), { status: 400, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
    const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
    if (!vapidPublicKey || !vapidPrivateKey) {
      return new Response(JSON.stringify({ error: 'Push notifications are not configured (missing VAPID keys).' }), { status: 500, headers: corsHeaders })
    }

    webpush.setVapidDetails('mailto:admin@example.com', vapidPublicKey, vapidPrivateKey)

    const { data: subs, error: subsError } = await adminClient
      .schema('pmms')
      .from('push_subscriptions')
      .select('*')
      .in('staff_id', staffIds)

    if (subsError) {
      return new Response(JSON.stringify({ error: subsError.message }), { status: 400, headers: corsHeaders })
    }

    const payload = JSON.stringify({ title, body: message })

    const results = await Promise.allSettled(
      (subs || []).map(sub =>
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
        const statusCode = result.reason?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          await adminClient.schema('pmms').from('push_subscriptions').delete().eq('id', (subs as any)[i].id)
        }
      }
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    return new Response(JSON.stringify({ sent, total: results.length }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
