import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

function normalizeCustomRoles(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => (typeof r === 'string'
    ? { name: r, accessLevel: 'none' }
    : { name: r.name, accessLevel: r.accessLevel || 'none' }
  ))
}

async function fetchAssignableStaffForRole(adminClient: any, roleName: string) {
  const { data: roleRows } = await adminClient
    .schema('pmms')
    .from('staff_roles')
    .select('staff_id')
    .eq('role', roleName)

  if (!roleRows?.length) return []

  const { data: staffRows } = await adminClient
    .from('staff')
    .select('id, name')
    .in('id', roleRows.map((r: any) => r.staff_id))
    .eq('active', true)

  return staffRows || []
}

// Properties have no division column, so every Admin + every
// manager-accessLevel custom role gets alerted (mirrors
// check-compliance-expiry's fetchAllAdminsAndManagers exactly).
async function fetchAllAdminsAndManagers(adminClient: any) {
  const { data: rolesRow } = await adminClient
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const managerRoleNames = normalizedCustomRoles.filter((r: any) => r.accessLevel === 'manager').map((r: any) => r.name)

  const [managerLists, admins] = await Promise.all([
    Promise.all(managerRoleNames.map((name: string) => fetchAssignableStaffForRole(adminClient, name))),
    fetchAssignableStaffForRole(adminClient, 'Admin'),
  ])

  const byId: Record<string, any> = {}
  ;[...managerLists.flat(), ...admins].forEach((s: any) => { byId[s.id] = s })
  return Object.values(byId)
}

// Triggered once daily by pg_cron + pg_net (see
// scripts/add_void_aging_cron.sql) -- there's no logged-in user at that
// point, so this is gated by a shared secret header instead of
// authorizeAdmin(). Reuses the same CRON_SECRET already set for
// check-stuck-tickets/check-compliance-expiry. verify_jwt is set to
// false for this function in supabase/config.toml so the secret check
// below is the only gate.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: enabledRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'void_alerts_enabled')
      .maybeSingle()
    if (enabledRow?.setting_value === false) {
      return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200, headers: corsHeaders })
    }

    const { data: thresholdRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'void_aging_threshold_days')
      .maybeSingle()
    const thresholdDays = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 45

    const { data: candidateRooms, error: roomsError } = await adminClient
      .schema('pmms')
      .from('property_rooms')
      .select('id, property_id, room_name, void_since')
      .eq('current_status', 'Void')
      .not('void_since', 'is', null)
      .is('void_alert_sent_at', null)

    if (roomsError) {
      return new Response(JSON.stringify({ error: roomsError.message }), { status: 500, headers: corsHeaders })
    }

    const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
    const overdueRooms = (candidateRooms || []).filter((r: any) => {
      const daysSince = Math.floor((todayMs - new Date(r.void_since).getTime()) / 86400000)
      return daysSince >= thresholdDays
    })

    let alerted = 0
    if (overdueRooms.length > 0) {
      const recipients = await fetchAllAdminsAndManagers(adminClient)

      for (const r of overdueRooms) {
        if (recipients.length > 0) {
          const { data: propertyRow } = await adminClient
            .schema('pmms')
            .from('properties')
            .select('address')
            .eq('id', r.property_id)
            .maybeSingle()

          await sendWebPushToStaff(
            adminClient,
            recipients.map((s: any) => s.id),
            'Void room overdue',
            `${r.room_name} at ${propertyRow?.address || 'a property'} has been void since ${r.void_since} (over ${thresholdDays} days).`,
          )
        }

        await adminClient
          .schema('pmms')
          .from('property_rooms')
          .update({ void_alert_sent_at: new Date().toISOString() })
          .eq('id', r.id)

        alerted += 1
      }
    }

    return new Response(JSON.stringify({ checked: candidateRooms?.length || 0, overdue: overdueRooms.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
