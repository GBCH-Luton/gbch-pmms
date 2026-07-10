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

// Simpler than tickets' fetchManagersForDivision -- properties have no
// division column at all (confirmed against pmms.properties' schema), so
// every Admin + every manager-accessLevel custom role gets alerted,
// regardless of which division their role is scoped to for ticket work.
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
// scripts/add_compliance_expiry_cron.sql) -- there's no logged-in user at
// that point, so this is gated by a shared secret header instead of
// authorizeAdmin(). Reuses the same CRON_SECRET already set for
// check-stuck-tickets. verify_jwt is set to false for this function in
// supabase/config.toml so the secret check below is the only gate.
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
      .eq('setting_key', 'compliance_alerts_enabled')
      .maybeSingle()
    if (enabledRow?.setting_value === false) {
      return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200, headers: corsHeaders })
    }

    // Only Expired records are eligible here -- Due Soon is deliberately
    // visual-only (dashboard tile + portfolio page), to avoid alerting on
    // every one of 11 cert types x every property as they merely approach
    // their threshold window.
    const { data: candidateRecords, error: recordsError } = await adminClient
      .schema('pmms')
      .from('property_compliance')
      .select('id, property_id, cert_type, expiry_date')
      .eq('not_applicable', false)
      .not('expiry_date', 'is', null)
      .is('aging_alert_sent_at', null)

    if (recordsError) {
      return new Response(JSON.stringify({ error: recordsError.message }), { status: 500, headers: corsHeaders })
    }

    const todayMs = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() })()
    const expiredRecords = (candidateRecords || []).filter((r: any) => new Date(r.expiry_date).getTime() < todayMs)

    let alerted = 0
    if (expiredRecords.length > 0) {
      const recipients = await fetchAllAdminsAndManagers(adminClient)

      for (const r of expiredRecords) {
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
            'Compliance certificate expired',
            `${r.cert_type} at ${propertyRow?.address || 'a property'} expired on ${r.expiry_date}.`,
          )
        }

        await adminClient
          .schema('pmms')
          .from('property_compliance')
          .update({ aging_alert_sent_at: new Date().toISOString() })
          .eq('id', r.id)

        alerted += 1
      }
    }

    return new Response(JSON.stringify({ checked: candidateRecords?.length || 0, expired: expiredRecords.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
