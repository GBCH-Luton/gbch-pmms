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

// Same shape as check-long-breaks.ts's own copy -- division is resolved
// from the waiting job's category (same as ticket-based alerts already do)
// rather than from the idle builder's own role, so this needs no new
// "which division is this person in" lookup.
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
// scripts/add_idle_alert_cron.sql), same shared-secret pattern as every
// other check-* function -- verify_jwt is false for this function in
// supabase/config.toml.
//
// Closes the gap directors flagged 2026-08-12: a builder finishes a job,
// has more of his own assigned work still queued, but never starts the
// next one -- nobody else finds out unless a manager happens to check.
// Deliberately only fires when there's an Assigned ticket actually waiting
// for him (not someone legitimately caught up with nothing left to do).
// One-shot per idle stretch via daily_attendance.idle_alert_sent_at,
// cleared by handleComplete/handlePause in BuilderDashboard.jsx every time
// a fresh idle stretch begins, so a repeat idle period later the same
// shift gets its own alert window.
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
      .eq('setting_key', 'idle_alert_minutes')
      .maybeSingle()
    const thresholdMinutes = minutesRow?.setting_value != null ? Number(minutesRow.setting_value) : 30

    // Everyone still clocked in today, not yet alerted this idle stretch.
    const { data: openShifts, error: shiftsError } = await adminClient
      .schema('pmms')
      .from('daily_attendance')
      .select('id, staff_id, clock_in_at')
      .is('clock_out_at', null)
      .is('idle_alert_sent_at', null)

    if (shiftsError) {
      return new Response(JSON.stringify({ error: shiftsError.message }), { status: 500, headers: corsHeaders })
    }

    if (!openShifts?.length) {
      return new Response(JSON.stringify({ checked: 0, idle: 0, alerted: 0 }), { status: 200, headers: corsHeaders })
    }

    const staffIds = openShifts.map((s: any) => s.staff_id)

    const [{ data: openSessions }, { data: openActivity }, { data: shortTrips }, { data: assignedTickets }, { data: categoriesRow }] = await Promise.all([
      adminClient.schema('pmms').from('work_sessions').select('builder_id').is('ended_at', null).in('builder_id', staffIds),
      adminClient.schema('pmms').from('activity_log').select('staff_id').is('ended_at', null).in('staff_id', staffIds),
      adminClient.schema('pmms').from('tickets').select('assigned_builder_id').eq('status', 'On Hold').in('hold_reason', SHORT_TRIP_REASONS).in('assigned_builder_id', staffIds),
      adminClient.schema('pmms').from('tickets').select('id, ticket_number, category, property_id, assigned_builder_id, priority_score')
        .eq('status', 'Assigned').in('assigned_builder_id', staffIds).order('priority_score', { ascending: false }),
      adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'maintenance_categories').maybeSingle(),
    ])

    const onJobIds = new Set((openSessions || []).map((s: any) => s.builder_id))
    const awayIds = new Set((openActivity || []).map((a: any) => a.staff_id))
    const shortTripIds = new Set((shortTrips || []).map((t: any) => t.assigned_builder_id))
    // Highest-priority Assigned ticket per builder -- assignedTickets is
    // already ordered by priority_score desc, so the first one seen per
    // staff id wins, same "next job" pick as the idle banner on
    // BuilderDashboard.jsx uses.
    const nextJobByStaff: Record<string, any> = {}
    ;(assignedTickets || []).forEach((t: any) => { if (!nextJobByStaff[t.assigned_builder_id]) nextJobByStaff[t.assigned_builder_id] = t })

    const idleCandidates = openShifts.filter((s: any) =>
      !onJobIds.has(s.staff_id) && !awayIds.has(s.staff_id) && !shortTripIds.has(s.staff_id) && nextJobByStaff[s.staff_id]
    )

    if (!idleCandidates.length) {
      return new Response(JSON.stringify({ checked: openShifts.length, idle: 0, alerted: 0 }), { status: 200, headers: corsHeaders })
    }

    // Idle-since = the most recent ended work_sessions row today, falling
    // back to clock-in -- same source BuilderDashboard.jsx's own
    // computeIdleSince() uses, so what he sees live and what triggers this
    // alert agree.
    const { data: endedSessions } = await adminClient
      .schema('pmms')
      .from('work_sessions')
      .select('builder_id, ended_at')
      .not('ended_at', 'is', null)
      .in('builder_id', idleCandidates.map((s: any) => s.staff_id))
      .order('ended_at', { ascending: false })

    const lastEndedByStaff: Record<string, string> = {}
    ;(endedSessions || []).forEach((s: any) => { if (!lastEndedByStaff[s.builder_id]) lastEndedByStaff[s.builder_id] = s.ended_at })

    const now = Date.now()
    const overdue = idleCandidates.filter((s: any) => {
      const idleSince = lastEndedByStaff[s.staff_id] || s.clock_in_at
      return (now - new Date(idleSince).getTime()) >= thresholdMinutes * 60000
    })

    let alerted = 0
    for (const s of overdue) {
      const nextJob = nextJobByStaff[s.staff_id]
      const division = categoriesRow?.setting_value?.[nextJob.category]?.division || 'Maintenance'
      const managers = await fetchManagersForDivision(adminClient, division)

      if (managers.length > 0) {
        const [{ data: staffRow }, { data: propertyRow }] = await Promise.all([
          adminClient.from('staff').select('name').eq('id', s.staff_id).maybeSingle(),
          adminClient.schema('pmms').from('properties').select('address').eq('id', nextJob.property_id).maybeSingle(),
        ])

        await sendWebPushToStaff(
          adminClient,
          managers.map((m: any) => m.id),
          'Idle with a job waiting',
          `${staffRow?.name || 'A builder'} hasn't started a job in over ${thresholdMinutes} minutes -- Job #${nextJob.ticket_number} at ${propertyRow?.address || 'a property'} is still waiting.`,
        )
      }

      await adminClient
        .schema('pmms')
        .from('daily_attendance')
        .update({ idle_alert_sent_at: new Date().toISOString() })
        .eq('id', s.id)

      alerted += 1
    }

    return new Response(JSON.stringify({ checked: openShifts.length, idle: idleCandidates.length, overdue: overdue.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
