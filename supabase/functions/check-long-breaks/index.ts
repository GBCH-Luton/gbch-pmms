import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// The 3 Stop reasons that lock a builder to a break timer on their own
// phone (see SHORT_TRIP_REASONS in BuilderDashboard.jsx) -- kept in sync
// by hand, there's no shared constant an Edge Function can import from the
// client bundle.
const SHORT_TRIP_REASONS = ['Going to the Office', 'Lunch Break', 'Getting materials myself']

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

// Same shape as check-stuck-tickets.ts's own copy -- a builder's break is
// tied to the ticket they paused, so this stays division-scoped (unlike
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
// scripts/add_long_break_alert_cron.sql), same shared-secret pattern as
// every other check-* function -- verify_jwt is false for this function
// in supabase/config.toml.
//
// Builder v.2 review gap: the end-of-day auto-clock-out escalation catches
// a shift that's quietly still open, but a within-day break (materials
// run, lunch, office trip) had no equivalent -- a builder could sit
// "Away" on their own locked screen for hours with nobody else ever
// finding out unless a manager happened to look. This closes that gap the
// same way stuck-ticket alerting already works: one-shot per pause
// instance (long_break_alert_sent_at is cleared by handlePause every time
// a new break starts, so a repeat offender gets alerted again, not just
// once ever), division-scoped to whoever manages this ticket's category.
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

    const { data: minutesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'long_break_alert_minutes')
      .maybeSingle()
    const thresholdMinutes = minutesRow?.setting_value != null ? Number(minutesRow.setting_value) : 45

    const { data: candidateTickets, error: ticketsError } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, property_id, assigned_builder_id, hold_reason, status_changed_at')
      .eq('status', 'On Hold')
      .in('hold_reason', SHORT_TRIP_REASONS)
      .is('long_break_alert_sent_at', null)

    if (ticketsError) {
      return new Response(JSON.stringify({ error: ticketsError.message }), { status: 500, headers: corsHeaders })
    }

    const now = Date.now()
    const overdue = (candidateTickets || []).filter((t: any) =>
      (now - new Date(t.status_changed_at).getTime()) >= thresholdMinutes * 60000
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
          'Still on a break',
          `${staffRow?.name || 'A builder'} has been "${t.hold_reason}" for over ${thresholdMinutes} minutes -- Job #${t.ticket_number} at ${propertyRow?.address || 'a property'}.`,
        )
      }

      await adminClient
        .schema('pmms')
        .from('tickets')
        .update({ long_break_alert_sent_at: new Date().toISOString() })
        .eq('id', t.id)

      alerted += 1
    }

    return new Response(JSON.stringify({ checked: candidateTickets?.length || 0, overdue: overdue.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
