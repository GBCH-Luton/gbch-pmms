import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

const STUCK_ELIGIBLE_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']
const GLOBAL_TRIAGE_THRESHOLD = 70
const P2_URGENT_THRESHOLD = 40

function priorityTierLabel(score: number | null) {
  if ((score || 0) >= GLOBAL_TRIAGE_THRESHOLD) return 'P1 Critical'
  if ((score || 0) >= P2_URGENT_THRESHOLD) return 'P2 Urgent'
  return 'P3 Routine'
}

function thresholdToMs({ value, unit }: { value: number; unit: string }) {
  return (Number(value) || 0) * (unit === 'days' ? 86400000 : 3600000)
}

function isTicketStuck(ticket: any, thresholdsSetting: any, nowMs = Date.now()) {
  if (!thresholdsSetting || !STUCK_ELIGIBLE_STATUSES.includes(ticket.status)) return false
  const tier = ticket.priority_override || priorityTierLabel(ticket.priority_score)
  const cell = thresholdsSetting?.[ticket.status]?.[tier]
  if (!cell) return false
  const changedAt = ticket.status_changed_at || ticket.created_at
  return (nowMs - new Date(changedAt).getTime()) >= thresholdToMs(cell)
}

function normalizeCustomRoles(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => (typeof r === 'string'
    ? { name: r, accessLevel: 'none', division: null }
    : { name: r.name, accessLevel: r.accessLevel || 'none', division: r.division || null }
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

async function fetchManagersForDivision(adminClient: any, division: string) {
  const { data: rolesRow } = await adminClient
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const roleNames = normalizedCustomRoles
    .filter((r: any) => r.accessLevel === 'manager' && (r.division || 'Maintenance') === division)
    .map((r: any) => r.name)

  const [managerLists, admins] = await Promise.all([
    Promise.all(roleNames.map((name: string) => fetchAssignableStaffForRole(adminClient, name))),
    fetchAssignableStaffForRole(adminClient, 'Admin'),
  ])

  const byId: Record<string, any> = {}
  ;[...managerLists.flat(), ...admins].forEach((s: any) => { byId[s.id] = s })
  return Object.values(byId)
}

// Triggered every 15 minutes by pg_cron + pg_net (see
// scripts/add_ticket_stuck_alerting.sql) -- there's no logged-in user at
// that point, so this is gated by a shared secret header instead of
// authorizeAdmin(). verify_jwt is set to false for this function in
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
      .eq('setting_key', 'stuck_alerts_enabled')
      .maybeSingle()
    if (enabledRow?.setting_value === false) {
      return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200, headers: corsHeaders })
    }

    const { data: thresholdsRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'stuck_ticket_thresholds')
      .maybeSingle()
    if (!thresholdsRow?.setting_value) {
      return new Response(JSON.stringify({ skipped: 'no thresholds configured' }), { status: 200, headers: corsHeaders })
    }
    const thresholds = thresholdsRow.setting_value

    const { data: candidateTickets, error: ticketsError } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, property_id, priority_score, priority_override, status_changed_at, created_at')
      .in('status', STUCK_ELIGIBLE_STATUSES)
      .is('stuck_alert_sent_at', null)

    if (ticketsError) {
      return new Response(JSON.stringify({ error: ticketsError.message }), { status: 500, headers: corsHeaders })
    }

    const stuckTickets = (candidateTickets || []).filter((t: any) => isTicketStuck(t, thresholds))

    const { data: categoriesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()

    let alerted = 0
    for (const t of stuckTickets) {
      const division = categoriesRow?.setting_value?.[t.category]?.division || 'Maintenance'
      const managers = await fetchManagersForDivision(adminClient, division)

      if (managers.length > 0) {
        const { data: propertyRow } = await adminClient
          .schema('pmms')
          .from('properties')
          .select('address')
          .eq('id', t.property_id)
          .maybeSingle()

        await sendWebPushToStaff(
          adminClient,
          managers.map((m: any) => m.id),
          'Stuck ticket needs attention',
          `Job #${t.ticket_number}: ${t.category} at ${propertyRow?.address || 'a property'} has been ${t.status} too long.`,
        )
      }

      await adminClient.schema('pmms').from('audit_events').insert({
        ticket_id: t.id,
        actor_id: null,
        actor_name: 'System (Stuck Ticket Monitor)',
        action: 'Stuck Alert',
        summary: `Flagged as stuck in "${t.status}" and ${managers.length > 0 ? `alerted ${managers.length} manager(s)/admin(s)` : 'no managers found to alert'}.`,
      })

      await adminClient
        .schema('pmms')
        .from('tickets')
        .update({ stuck_alert_sent_at: new Date().toISOString() })
        .eq('id', t.id)

      alerted += 1
    }

    return new Response(JSON.stringify({ checked: candidateTickets?.length || 0, stuck: stuckTickets.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
