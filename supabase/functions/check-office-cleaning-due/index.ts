import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const CATEGORY = 'Cleaning Rota'
const ISSUE_TAG = 'Office Daily Clean'
const OPEN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']
const DEFAULT_ESTIMATED_MINUTES = 30

// Director's spec (2026-08-14): Monday-Friday only, no photo/checklist --
// just a plain ticket, same duplicate-guard reasoning as
// check-routine-visits-due (skip if an open one already exists, so a
// housekeeper who's behind doesn't get a second ticket piled on top of
// yesterday's unfinished one). Who's assigned each weekday is a manager-set
// rota (client/src/pages/admin/AdminBuilders.jsx's Office Cleaning Rota
// panel, deliberately on the Staff page rather than Settings -- see that
// panel's own comment), not a per-visit interval like the tenant Cleaners
// Rota -- this function reads that same setting rather than computing
// anything itself. A sick day/override needs no special handling here: the
// manager just reassigns the ticket this creates, or raises a separate one,
// both already-existing Pipeline/Raise Ticket actions.
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

    // Europe/London, not the server's own clock -- same reasoning as
    // check-clock-out-reminders/check-stale-shifts, a weekday boundary at
    // UTC midnight would be wrong for a UK office by definition.
    const weekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long' })
      .format(new Date())
      .toLowerCase()

    if (weekday === 'saturday' || weekday === 'sunday') {
      return new Response(JSON.stringify({ skipped: 'weekend' }), { status: 200, headers: corsHeaders })
    }

    const { data: rotaRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'office_cleaning_rota')
      .maybeSingle()
    const assignedStaffId = rotaRow?.setting_value?.[weekday]
    if (!assignedStaffId) {
      return new Response(JSON.stringify({ skipped: 'nobody assigned', weekday }), { status: 200, headers: corsHeaders })
    }

    // Exactly one is expected -- see PropertyCoreTab.jsx's PROPERTY_STATUSES
    // comment on 'Internal'. Takes the first if more than one somehow
    // exists rather than erroring, since a second internal location
    // (e.g. a future second office) shouldn't silently break this job.
    const { data: officeProperties, error: propsError } = await adminClient
      .schema('pmms')
      .from('properties')
      .select('id')
      .eq('status', 'Internal')
      .limit(1)

    if (propsError) {
      return new Response(JSON.stringify({ error: propsError.message }), { status: 500, headers: corsHeaders })
    }
    const officeProperty = (officeProperties || [])[0]
    if (!officeProperty) {
      return new Response(JSON.stringify({ skipped: 'no Internal property found' }), { status: 200, headers: corsHeaders })
    }

    const { data: existingTickets } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('status')
      .eq('property_id', officeProperty.id)
      .eq('category', CATEGORY)
      .eq('issue_tag', ISSUE_TAG)

    const hasOpenTicket = (existingTickets || []).some((t: any) => OPEN_STATUSES.includes(t.status))
    if (hasOpenTicket) {
      return new Response(JSON.stringify({ skipped: 'already open' }), { status: 200, headers: corsHeaders })
    }

    // Pulled live so a future tweak to this subcategory's score in
    // Settings > Maintenance Categories is picked up automatically,
    // same reasoning as check-routine-visits-due.
    const { data: categoriesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()
    const priorityScore = Number(
      categoriesRow?.setting_value?.[CATEGORY]?.subCategories?.find((s: any) => s.label === ISSUE_TAG)?.score
      ?? categoriesRow?.setting_value?.[CATEGORY]?.weight
      ?? 15
    )

    const { error: insertError } = await adminClient
      .schema('pmms')
      .from('tickets')
      .insert({
        category: CATEGORY,
        issue_tag: ISSUE_TAG,
        description: 'Daily office clean.',
        status: 'Assigned',
        property_id: officeProperty.id,
        assigned_builder_id: assignedStaffId,
        estimated_minutes: DEFAULT_ESTIMATED_MINUTES,
        assign_type: 'Auto',
        priority_score: priorityScore,
      })

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ created: true, weekday, assignedStaffId }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
