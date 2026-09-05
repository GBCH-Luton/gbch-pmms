# PMMS Push Notifications Pipeline — full reference for HRMS

Everything needed to reuse PMMS's web push pipeline in a sibling app on
the same Supabase project. All file contents below are verbatim from
the PMMS codebase, not summaries.

## 1. `send-push-notifications/index.ts` + all shared helpers it uses

**`supabase/functions/send-push-notifications/index.ts`**
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

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

    const result = await sendWebPushToStaff(adminClient, staffIds, title, message)
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders })
    }
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
```

**`supabase/functions/_shared/webPush.ts`** — the actual push-sending logic, shared by every caller
```typescript
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
```
Note the `mailto:admin@example.com` — that's a real placeholder in our own code, never updated to a real address. Worth using your own real contact email in HRMS's version, not copying that literal string.

**`supabase/functions/_shared/cors.ts`**
```typescript
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // Without this, Deno's Response defaults to no content-type, and
  // supabase-js's functions.invoke() then hands back the raw JSON text
  // as a string instead of parsing it -- every caller here expects data
  // to already be a parsed object.
  'Content-Type': 'application/json',
}
```

**`supabase/functions/_shared/authorizeAdmin.ts`** — used by `send-push-notifications` (this one requires PMMS Admin specifically)
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export async function authorizeAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user?.email) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: staffRows, error: staffError } = await adminClient
    .from('staff')
    .select('id')
    .ilike('email', escapeLikePattern(userData.user.email))
    .order('id')
    .limit(2)

  if (staffError || !staffRows?.length) {
    throw new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403 })
  }
  if (staffRows.length > 1) {
    console.warn(`Multiple staff rows found for email ${userData.user.email} -- using the first one.`)
  }
  const staffRow = staffRows[0]

  const { data: roleRow } = await adminClient
    .schema('pmms')
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staffRow.id)
    .maybeSingle()

  if (roleRow?.role !== 'Admin') {
    throw new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403 })
  }

  return { adminClient, callerStaffId: staffRow.id as string }
}
```

**`supabase/functions/_shared/authorizeStaff.ts`** — used by `notify-chat-mention`/`notify-dm-message` (any authenticated staff member, no role requirement — they're only ever acting on a message they themselves sent)
```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export async function authorizeStaff(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user?.email) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: staffRows, error: staffError } = await adminClient
    .from('staff')
    .select('id')
    .ilike('email', escapeLikePattern(userData.user.email))
    .order('id')
    .limit(2)

  if (staffError || !staffRows?.length) {
    throw new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403 })
  }
  const staffRow = staffRows[0]

  return { adminClient, callerStaffId: staffRow.id as string }
}
```

## 2. Exact call shape + the two message-triggered callers

`send-push-notifications` expects:
```json
{ "staffIds": ["uuid", "uuid", ...], "title": "string", "body": "string" }
```
Called via `supabase.functions.invoke('send-push-notifications', { body: {...} })` from admin/manager actions — a reassign-with-push-checkbox, a direct assignment, an automatic emergency alert on a priority change. Requires the caller to be Admin (via `authorizeAdmin`).

**`supabase/functions/notify-chat-mention/index.ts`** (fires only when a channel message actually @mentions someone)
```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeStaff } from '../_shared/authorizeStaff.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { adminClient, callerStaffId } = await authorizeStaff(req)

    const body = await req.json().catch(() => null)
    const messageId = body?.messageId
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), { status: 400, headers: corsHeaders })
    }

    const { data: message, error: messageError } = await adminClient
      .schema('pmms')
      .from('chat_messages')
      .select('sender_id, sender_name, division, body, mentioned_staff_ids')
      .eq('id', messageId)
      .maybeSingle()

    if (messageError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: corsHeaders })
    }
    if (message.sender_id !== callerStaffId) {
      return new Response(JSON.stringify({ error: 'You can only notify mentions for a message you sent' }), { status: 403, headers: corsHeaders })
    }

    const mentionedIds: string[] = message.mentioned_staff_ids || []
    if (mentionedIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), { status: 200, headers: corsHeaders })
    }

    const result = await sendWebPushToStaff(
      adminClient,
      mentionedIds,
      `${message.sender_name} mentioned you in #${message.division}`,
      message.body,
    )

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
```
Called with `{ "messageId": "uuid" }` — deliberately does NOT accept a list of staff IDs from the client; it re-derives who to notify from the message row's own `mentioned_staff_ids` column server-side, and verifies the caller actually sent that message. Never trust a client-supplied recipient list.

**`supabase/functions/notify-dm-message/index.ts`** (fires on every DM — a DM is always addressed to exactly one person, unlike a channel message)
```typescript
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeStaff } from '../_shared/authorizeStaff.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { adminClient, callerStaffId } = await authorizeStaff(req)

    const body = await req.json().catch(() => null)
    const messageId = body?.messageId
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), { status: 400, headers: corsHeaders })
    }

    const { data: message, error: messageError } = await adminClient
      .schema('pmms')
      .from('dm_messages')
      .select('sender_id, sender_name, recipient_id, body')
      .eq('id', messageId)
      .maybeSingle()

    if (messageError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: corsHeaders })
    }
    if (message.sender_id !== callerStaffId) {
      return new Response(JSON.stringify({ error: 'You can only notify for a message you sent' }), { status: 403, headers: corsHeaders })
    }

    const result = await sendWebPushToStaff(
      adminClient,
      [message.recipient_id],
      `${message.sender_name} sent you a message`,
      message.body || 'Sent a photo',
    )

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
```

## 3. The subscription table — schema `pmms`, not `public`

```sql
create table pmms.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
```
One row per browser/device a staff member has granted permission on (someone on both phone and laptop has two rows). Lives in `pmms`, **not** `public` — build HRMS's own `hrms.push_subscriptions`, don't reuse or read from this one directly (only `public.staff` is the actually-shared table).

## 4. Current RLS on that table (after a real fix — read this carefully)

```sql
create policy "self_manage" on pmms.push_subscriptions
  for all to authenticated
  using (staff_id = pmms.current_staff_id())
  with check (staff_id = pmms.current_staff_id());

create policy "admin_read" on pmms.push_subscriptions
  for select to authenticated
  using (pmms.current_access_level() = 'admin');

create policy "manager_division_scoped_read" on pmms.push_subscriptions
  for select to authenticated
  using (pmms.current_access_level() = 'manager' and (pmms.current_division() is null or pmms.staff_division(staff_id) = pmms.current_division()));
```
**Gotcha worth inheriting the lesson from, not just the code**: this table originally had a blanket `is_admin_or_manager()` SELECT policy — any manager could read any staff member's push subscription keys (`p256dh`/`auth` are sensitive, they let you push-impersonate that device) regardless of division. Fixed properly only once someone noticed a division-scoped manager could read other divisions' rows. Build the division/department-scoping into HRMS's equivalent table from day one rather than starting broad and tightening later.

## 5. Client-side registration

**`client/public/sw.js`** (the entire service worker — PMMS's only one, push-only, no offline caching)
```javascript
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* ignore malformed payloads */ }

  event.waitUntil(
    self.registration.showNotification(data.title || 'PMMS', {
      body: data.body || '',
      icon: '/favicon.svg',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length > 0) return clients[0].focus()
      return self.clients.openWindow('/')
    })
  )
})
```

**`client/src/lib/pushNotifications.js`** (registration/subscribe logic)
```javascript
import { supabase } from './supabase'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function pushNotificationsSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

export function pushNotificationsGranted() {
  return pushNotificationsSupported() && Notification.permission === 'granted'
}

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
```
This is called from an "🔔 Enable Notifications" button that lives in the sidebar's bottom profile section (only rendered when `pushNotificationsSupported()` is true, disabled once already enabled).

## 6. Environment variables (names only)

Server-side (Edge Function secrets, set via `supabase secrets set`):
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — auto-injected into every Edge Function by Supabase, never set manually.

Client-side (`.env`, `VITE_`-prefixed so it's bundled into the app):
- `VITE_VAPID_PUBLIC_KEY`

Generate your own HRMS-specific VAPID keypair (`npx web-push generate-vapid-keys`) — don't reuse PMMS's. They're tied to the origin/app that registers subscriptions with the push service.

## 7. Gotchas actually hit building this

- **`functions.invoke()` returns a raw string instead of parsed JSON** if the Edge Function's response doesn't set `Content-Type: application/json` explicitly — Deno's `Response` defaults to none. Every function here sets it via the shared `corsHeaders` object.
- **Permission granted ≠ subscribed.** `Notification.permission === 'granted'` can be true with zero actual subscription rows (e.g. a browser pre-granting it). `hasActivePushSubscription()` checks for a real `PushManager` subscription, not just the permission flag — use that, not the permission check alone, to decide whether to show "Enable" vs "Enabled."
- **Dead subscriptions must be pruned**, not left to fail forever — a push service returns 404/410 once an endpoint is gone (uninstalled, browser data cleared); `sendWebPushToStaff` deletes those rows immediately so future alerts don't keep retrying them.
- **Missing VAPID keys must fail soft**, not crash — `sendWebPushToStaff` returns a clean `{sent:0, total:0, error:...}` if the env vars aren't set, so a push-notification failure never breaks the actual action that triggered it (message still sends even if the push doesn't).
- **Email case-sensitivity bit us in production**: `authorizeAdmin`/`authorizeStaff` use `.ilike`, not `.eq`, against `staff.email` — Supabase Auth always lowercases the session's email, but the `staff` table is free-typed and has had capitalized emails land in it, which silently denied a real admin every admin action until this was caught. Copy the `.ilike` + `escapeLikePattern` pattern exactly, don't simplify it to `.eq`.
- **HTTPS is required** for `serviceWorker`/`PushManager` to even exist as browser APIs — `localhost` is exempted for dev, but any real deployed environment must be served over HTTPS or `pushNotificationsSupported()` will correctly return false for everyone.
- **Service worker must be served from the site root** (`/sw.js`) to get the broadest scope — a service worker can only control pages at or below its own path.
