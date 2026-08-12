import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

function normalizeCustomRoles(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => (typeof r === 'string'
    ? { name: r, accessLevel: 'none', division: null }
    : { name: r.name, accessLevel: r.accessLevel || 'none', division: r.division || null }
  ))
}

async function fetchAssignableStaffForRole(adminClient: any, roleName: string) {
  const { data: roleRows } = await adminClient.schema('pmms').from('staff_roles').select('staff_id').eq('role', roleName)
  if (!roleRows?.length) return []
  const { data: staffRows } = await adminClient.from('staff').select('id, name').in('id', roleRows.map((r: any) => r.staff_id)).eq('active', true)
  return staffRows || []
}

// Same shape as check-long-breaks.ts's own copy -- a job is tied to the
// ticket's own category, so this stays division-scoped (unlike
// check-clock-out-reminders/check-stale-shifts, which alert every
// admin/manager since attendance isn't a per-division concept).
async function fetchManagersForDivision(adminClient: any, division: string) {
  const { data: rolesRow } = await adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'custom_roles').maybeSingle()
  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const roleNames = normalizedCustomRoles.filter((r: any) => r.accessLevel === 'manager' && (r.division || 'Maintenance') === division).map((r: any) => r.name)

  const [managerLists, admins] = await Promise.all([
    Promise.all(roleNames.map((name: string) => fetchAssignableStaffForRole(adminClient, name))),
    fetchAssignableStaffForRole(adminClient, 'Admin'),
  ])

  const byId: Record<string, any> = {}
  ;[...managerLists.flat(), ...admins].forEach((s: any) => { byId[s.id] = s })
  return Object.values(byId)
}

// Triggered every 15 minutes by pg_cron + pg_net (see
// scripts/add_long_running_job_alert_cron.sql), same shared-secret pattern
// as every other check-* function -- verify_jwt is false for this function
// in supabase/config.toml.
//
// Directors approved 2026-08-12, alongside pauseOpenJob in
// check-clock-out-reminders: that fix catches a job left open past the
// builder's own end of day, but within a single day a job could still run
// for hours with nobody but a manager who happens to glance at Clocking's
// "Over 8h" row ever finding out. This is the same idea as
// check-long-breaks (which alerts on a within-day break running long) but
// for the job itself -- one-shot per In Progress stretch
// (long_running_job_alert_sent_at is cleared on every fresh clock-in/resume
// by BuilderDashboard.jsx, so a job that's paused and later resumed gets
// its own fresh alert window, not silently covered by a guard left over
// from hours earlier).
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

    const { data: hoursRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'long_running_job_alert_hours')
      .maybeSingle()
    const thresholdHours = hoursRow?.setting_value != null ? Number(hoursRow.setting_value) : 6

    const { data: candidateTickets, error: ticketsError } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, property_id, assigned_builder_id, status_changed_at')
      .eq('status', 'In Progress')
      .is('long_running_job_alert_sent_at', null)

    if (ticketsError) {
      return new Response(JSON.stringify({ error: ticketsError.message }), { status: 500, headers: corsHeaders })
    }

    const now = Date.now()
    const overdue = (candidateTickets || []).filter((t: any) =>
      (now - new Date(t.status_changed_at).getTime()) >= thresholdHours * 3600000
    )

    const { data: categoriesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()

    let alerted = 0
    for (const t of overdue) {
      const division = categoriesRow?.setting_value?.[t.category]?.division || 'Maintenance'
      const managers = await fetchManagersForDivision(adminClient, division)

      if (managers.length > 0) {
        const [{ data: staffRow }, { data: propertyRow }] = await Promise.all([
          adminClient.from('staff').select('name').eq('id', t.assigned_builder_id).maybeSingle(),
          adminClient.schema('pmms').from('properties').select('address').eq('id', t.property_id).maybeSingle(),
        ])

        await sendWebPushToStaff(
          adminClient,
          managers.map((m: any) => m.id),
          'Job running long',
          `${staffRow?.name || 'A builder'} has been on Job #${t.ticket_number} for over ${thresholdHours}h -- ${propertyRow?.address || 'a property'}.`,
        )
      }

      await adminClient
        .schema('pmms')
        .from('tickets')
        .update({ long_running_job_alert_sent_at: new Date().toISOString() })
        .eq('id', t.id)

      alerted += 1
    }

    return new Response(JSON.stringify({ checked: candidateTickets?.length || 0, overdue: overdue.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
