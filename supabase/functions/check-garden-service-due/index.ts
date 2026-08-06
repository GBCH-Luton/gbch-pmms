import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

const CATEGORY = 'Grounds & External Works'
const ISSUE_TAG = 'Garden maintenance'
const OPEN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']

// UK growing-season convention, matched with isUkSummerMonth() in
// client/src/pages/admin/shared.jsx -- Mar-Oct is summer (shorter
// interval), Nov-Feb is winter (longer). A month-granularity boundary
// doesn't need Europe/London precision the way a specific timestamp does,
// so this just uses the server clock's own month.
function isSummerMonth(date: Date) {
  const month = date.getMonth() + 1
  return month >= 3 && month <= 10
}

// Triggered daily by pg_cron + pg_net (see
// scripts/add_garden_service_cron.sql), same shared-secret pattern as
// check-stuck-tickets/check-compliance-expiry/check-void-aging/
// check-routine-visits-due -- verify_jwt is false for this function in
// supabase/config.toml so the secret check below is the only gate.
//
// Deliberately does NOT auto-assign a builder (unlike
// check-routine-visits-due, which can because every property already has
// one designated assigned_cleaner_id) -- gardens are serviced by a mix of
// internal staff and external contractors with no staff row at all
// (see PropertyGardensTab.jsx), so there's no reliable "this property's
// gardener is X" to route to. Tickets land status: 'Pending' for a
// manager to assign by hand, same as any manually-raised ticket.
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
      .eq('setting_key', 'garden_auto_ticket_enabled')
      .maybeSingle()
    if (enabledRow?.setting_value === false) {
      return new Response(JSON.stringify({ skipped: 'disabled' }), { status: 200, headers: corsHeaders })
    }

    const { data: settingsRows } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['garden_service_days_summer', 'garden_service_days_winter', 'maintenance_categories'])
    const settingsMap: Record<string, any> = {}
    ;(settingsRows || []).forEach((r: any) => { settingsMap[r.setting_key] = r.setting_value })

    const summerDays = settingsMap.garden_service_days_summer != null ? Number(settingsMap.garden_service_days_summer) : 90
    const winterDays = settingsMap.garden_service_days_winter != null ? Number(settingsMap.garden_service_days_winter) : 180
    const thresholdDays = isSummerMonth(new Date()) ? summerDays : winterDays

    // Pulled live so a future tweak to this subcategory's score in
    // Settings > Maintenance Categories is picked up automatically,
    // without needing this function edited too.
    const gardenScore = Number(
      settingsMap.maintenance_categories?.[CATEGORY]?.subCategories?.find((s: any) => s.label === ISSUE_TAG)?.score
      ?? settingsMap.maintenance_categories?.[CATEGORY]?.weight
      ?? 20
    )

    const { data: properties, error: propsError } = await adminClient
      .schema('pmms')
      .from('properties')
      .select('id, garden_last_attended_date')
      .eq('has_garden', true)

    if (propsError) {
      return new Response(JSON.stringify({ error: propsError.message }), { status: 500, headers: corsHeaders })
    }

    const { data: gardenTickets } = await adminClient
      .schema('pmms')
      .from('tickets')
      .select('property_id, status, completed_at')
      .eq('category', CATEGORY)
      .eq('issue_tag', ISSUE_TAG)

    const nowMs = Date.now()
    let created = 0
    const results: any[] = []

    for (const property of properties || []) {
      const ticketsForProperty = (gardenTickets || []).filter((t: any) => t.property_id === property.id)

      const hasOpenTicket = ticketsForProperty.some((t: any) => OPEN_STATUSES.includes(t.status))
      if (hasOpenTicket) { results.push({ property_id: property.id, skipped: 'already open' }); continue }

      const lastCompleted = ticketsForProperty
        .filter((t: any) => t.completed_at)
        .sort((a: any, b: any) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]

      // Same "never attended = due immediately" convention as
      // fetchGardenReviewAging() on the dashboard -- no baseline is
      // treated as maximally overdue, not skipped.
      const baseline = lastCompleted?.completed_at || property.garden_last_attended_date
      const daysSince = baseline ? Math.floor((nowMs - new Date(baseline).getTime()) / 86400000) : Infinity
      if (daysSince < thresholdDays) { results.push({ property_id: property.id, skipped: 'not due', daysSince }); continue }

      const { error: insertError } = await adminClient
        .schema('pmms')
        .from('tickets')
        .insert({
          category: CATEGORY,
          issue_tag: ISSUE_TAG,
          description: 'Garden due for seasonal service.',
          status: 'Pending',
          property_id: property.id,
          priority_score: gardenScore,
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
