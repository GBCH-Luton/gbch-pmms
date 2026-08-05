import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const CATEGORY = 'Cleaning Rota'
const ISSUE_TAG = 'Routine 2-Week Visit'
const OPEN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']

// Triggered daily by pg_cron + pg_net (see scripts/add_routine_visits_cron.sql),
// same shared-secret pattern as check-void-aging/check-stuck-tickets/
// check-compliance-expiry -- verify_jwt is false for this function in
// supabase/config.toml so the secret check below is the only gate.
//
// Unlike those three functions, this one WRITES a new ticket rather than
// only sending an alert -- there's no existing precedent for that in this
// codebase (confirmed by reading all three before writing this), so the
// duplicate-guard (skip if an open Routine visit ticket already exists
// for the property) is the important safety property here: this function
// can safely run more than once a day, or be re-triggered manually,
// without ever creating two open routine-visit tickets for the same
// property.
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
      .eq('setting_key', 'routine_visit_alerts_enabled')
      .maybeSingle()
    if (enabledRow?.setting_value === false) {
      return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200, headers: corsHeaders })
    }

    const { data: flagDaysRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'routine_visit_flag_days')
      .maybeSingle()
    const flagDays = flagDaysRow?.setting_value != null ? Number(flagDaysRow.setting_value) : 12

    // Manager-only field the ticket-assignment UI collects everywhere else
    // (see AdminRaiseTicket.jsx/AdminPipeline.jsx) -- these tickets are
    // created and assigned by this cron job with no manager involved, so
    // there's no assignment step to type one into. Settings > Routine
    // Cleaning Visits configures it instead, applied to every visit this
    // function creates.
    const { data: estimatedMinutesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'routine_visit_estimated_minutes')
      .maybeSingle()
    const estimatedMinutes = estimatedMinutesRow?.setting_value != null ? Number(estimatedMinutesRow.setting_value) : 30

    // Pulled live so a future tweak to this subcategory's score in
    // Settings > Maintenance Categories is picked up automatically,
    // without needing this function edited too.
    const { data: categoriesRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()
    const routineVisitScore = Number(
      categoriesRow?.setting_value?.[CATEGORY]?.subCategories?.find((s: any) => s.label === ISSUE_TAG)?.score
      ?? categoriesRow?.setting_value?.[CATEGORY]?.weight
      ?? 20
    )

    const { data: properties, error: propsError } = await adminClient
      .schema('pmms')
      .from('properties')
      .select('id, assigned_cleaner_id, cleaner_assigned_since')
      .not('assigned_cleaner_id', 'is', null)

    if (propsError) {
      return new Response(JSON.stringify({ error: propsError.message }), { status: 500, headers: corsHeaders })
    }

    const { data: visitTickets } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('property_id, status, completed_at')
      .eq('category', CATEGORY)
      .eq('issue_tag', ISSUE_TAG)

    const nowMs = Date.now()
    let created = 0
    const results: any[] = []

    for (const property of properties || []) {
      const ticketsForProperty = (visitTickets || []).filter((t: any) => t.property_id === property.id)

      const hasOpenTicket = ticketsForProperty.some((t: any) => OPEN_STATUSES.includes(t.status))
      if (hasOpenTicket) { results.push({ property_id: property.id, skipped: 'already open' }); continue }

      const lastCompleted = ticketsForProperty
        .filter((t: any) => t.completed_at)
        .sort((a: any, b: any) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]

      const baseline = lastCompleted?.completed_at || property.cleaner_assigned_since
      if (!baseline) { results.push({ property_id: property.id, skipped: 'no baseline' }); continue }

      const daysSince = Math.floor((nowMs - new Date(baseline).getTime()) / 86400000)
      if (daysSince < flagDays) { results.push({ property_id: property.id, skipped: 'not due', daysSince }); continue }

      const { error: insertError } = await adminClient
        .schema('pmms')
        .from('tickets')
        .insert({
          category: CATEGORY,
          issue_tag: ISSUE_TAG,
          description: 'Routine 2-week cleaning visit due.',
          status: 'Assigned',
          property_id: property.id,
          assigned_builder_id: property.assigned_cleaner_id,
          estimated_minutes: estimatedMinutes,
          assign_type: 'Auto',
          priority_score: routineVisitScore,
        })

      if (insertError) {
        results.push({ property_id: property.id, error: insertError.message })
        continue
      }

      created += 1
      results.push({ property_id: property.id, created: true, daysSince })
    }

    return new Response(JSON.stringify({ checked: (properties || []).length, created, results }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
