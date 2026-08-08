import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'

// Reports page's AI question box, backed by a real Claude API call --
// replaced the old free pattern-matcher (4 fixed question shapes) with
// something that can answer any question phrased any way, over the same
// kind of aggregated, non-sensitive data the old runners already exposed
// (ticket counts, compliance aging, builder completions -- never raw
// resident names, vulnerability notes, or full ticket descriptions).
//
// Single-shot, not agentic: the whole context is gathered up front and
// handed to Claude in one call, same shape as the old runners' summaries
// just broader. If a question needs data outside that snapshot, the
// system prompt tells Claude to say so rather than guess -- there's no
// tool-use loop letting it run its own queries.
//
// Admin-only (authorizeAdmin, not just "logged in") -- this costs real
// money per call, unlike the free version it replaced, so it stays
// scoped the same way the original AI Trial page was.
//
// Every call is logged to pmms.ai_usage_log (tokens + computed cost)
// regardless of pricing being configured yet -- see
// ai_cost_per_million_input_tokens / ai_cost_per_million_output_tokens in
// pmms.settings, edited from AdminSettings.jsx.

const MODEL = 'claude-haiku-4-5-20251001'
const COMPLIANCE_TYPES = [
  { key: 'gas_safety', title: 'Gas Safety (CP12)' },
  { key: 'electrical_safety', title: 'Electrical Safety (EICR)' },
  { key: 'pat_testing', title: 'PAT Testing' },
  { key: 'fire_risk_assessment', title: 'Fire Risk Assessment' },
  { key: 'fire_alarm_test_log', title: 'Fire Alarm Test Log' },
  { key: 'fire_extinguisher_check', title: 'Fire Extinguisher Check' },
  { key: 'fire_extinguisher_service', title: 'Fire Extinguisher Service' },
  { key: 'legionella_risk_assessment', title: 'Legionella Risk Assessment' },
  { key: 'asbestos_management', title: 'Asbestos Management' },
  { key: 'lift_safety', title: 'Lift Safety' },
  { key: 'health_safety_inspection', title: 'Health & Safety Inspection' },
]

function complianceAging(record: any, thresholdDays: number) {
  if (!record) return 'red'
  if (record.not_applicable) return 'grey'
  if (!record.expiry_date) return 'red'
  const daysLeft = Math.floor((new Date(record.expiry_date).getTime() - Date.now()) / 86400000)
  if (daysLeft < 0) return 'red'
  if (daysLeft <= thresholdDays) return 'amber'
  return 'green'
}

// UK wall-clock date/time, same Intl-based approach as
// client/src/pages/admin/shared.jsx's ukDateKey/formatUKDateTime -- told to
// Claude explicitly in the system prompt, since nothing about "today"
// means anything to the model unless it's actually given the real current
// UK date to reason against.
function ukNow() {
  const now = new Date()
  const dateParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (parts: any, type: string) => parts.find((p: any) => p.type === type)?.value
  const todayUkDate = `${get(dateParts, 'year')}-${get(dateParts, 'month')}-${get(dateParts, 'day')}`
  const timeParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  return { todayUkDate, currentUkDateTime: `${todayUkDate} ${get(timeParts, 'hour')}:${get(timeParts, 'minute')}` }
}

async function buildContext(adminClient: any) {
  const [{ data: tickets }, { data: properties }, { data: complianceRecords }, { data: staff }, { data: thresholdRow }, { data: shifts }, { data: deadlineRow }] = await Promise.all([
    adminClient.schema('pmms').from('tickets').select('ticket_number, property_id, category, status, assigned_builder_id, created_at, completed_at, first_assigned_at, mileage_logged, transit_start'),
    adminClient.schema('pmms').from('properties').select('id, address'),
    adminClient.schema('pmms').from('property_compliance').select('property_id, cert_type, expiry_date, not_applicable'),
    adminClient.from('staff').select('id, name'),
    adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'compliance_aging_threshold_days').maybeSingle(),
    // Attendance was entirely missing before -- "do the builders clock in
    // on time" had genuinely nothing to answer from. late_flag is already
    // computed at clock-in time (see BuilderDashboard.jsx) against
    // daily_clock_in_deadline, so this is just exposing that, not
    // recomputing punctuality logic here.
    adminClient.schema('pmms').from('daily_attendance').select('staff_id, work_date, clock_in_at, late_flag').order('clock_in_at', { ascending: false }).limit(500),
    adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'daily_clock_in_deadline').maybeSingle(),
  ])

  const thresholdDays = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 90
  const addressById: Record<string, string> = {}
  ;(properties || []).forEach((p: any) => { addressById[p.id] = p.address })
  const nameById: Record<string, string> = {}
  ;(staff || []).forEach((s: any) => { nameById[s.id] = s.name })

  const openStatuses = new Set(['Pending', 'Assigned', 'In Progress', 'On Hold'])
  const statusCounts: Record<string, number> = {}
  const categoryCounts: Record<string, number> = {}
  const openByProperty: Record<string, number> = {}

  ;(tickets || []).forEach((t: any) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
    if (t.category) categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1
    if (openStatuses.has(t.status) && t.property_id) {
      const addr = addressById[t.property_id] || 'Unknown property'
      openByProperty[addr] = (openByProperty[addr] || 0) + 1
    }
  })

  const dailyClockInDeadline = deadlineRow?.setting_value || '09:00'

  // Per-builder rollup -- completed/open workload plus how they're doing
  // on timekeeping, so "how is X performing" has real numbers to answer
  // with instead of just an all-time completed count. Only builders who
  // actually show up in tickets or shifts get a row (an inactive/unused
  // builder account doesn't clutter this).
  const builderIds = new Set<string>()
  ;(tickets || []).forEach((t: any) => { if (t.assigned_builder_id) builderIds.add(t.assigned_builder_id) })
  ;(shifts || []).forEach((s: any) => { if (s.staff_id) builderIds.add(s.staff_id) })

  const builderPerformance = Array.from(builderIds).map((id) => {
    const builderTickets = (tickets || []).filter((t: any) => t.assigned_builder_id === id)
    const completed = builderTickets.filter((t: any) => t.completed_at)
    const openCount = builderTickets.filter((t: any) => !t.completed_at && t.status !== 'Cancelled').length
    const avgTurnaroundHours = completed.length > 0
      ? completed.reduce((sum: number, t: any) => sum + Math.max(0, new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()), 0) / completed.length / 3600000
      : null

    const builderShifts = (shifts || []).filter((s: any) => s.staff_id === id)
    const lateCount = builderShifts.filter((s: any) => s.late_flag).length

    return {
      builder: nameById[id] || 'Unknown',
      completedJobs: completed.length,
      openJobs: openCount,
      avgTurnaroundHours: avgTurnaroundHours != null ? Math.round(avgTurnaroundHours * 10) / 10 : null,
      shiftsLogged: builderShifts.length,
      lateClockIns: lateCount,
      onTimeClockInPct: builderShifts.length > 0 ? Math.round(((builderShifts.length - lateCount) / builderShifts.length) * 1000) / 10 : null,
    }
  }).sort((a, b) => b.completedJobs - a.completedJobs)

  const totalShifts = (shifts || []).length
  const totalLateShifts = (shifts || []).filter((s: any) => s.late_flag).length
  const attendanceOverall = {
    dailyClockInDeadline,
    shiftsLogged: totalShifts,
    lateClockIns: totalLateShifts,
    onTimeClockInPct: totalShifts > 0 ? Math.round(((totalShifts - totalLateShifts) / totalShifts) * 1000) / 10 : null,
  }

  const recordsByKey: Record<string, any> = {}
  ;(complianceRecords || []).forEach((r: any) => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })
  let expired = 0, dueSoon = 0, noRecord = 0, valid = 0
  const flaggedSample: string[] = []
  ;(properties || []).forEach((p: any) => {
    COMPLIANCE_TYPES.forEach(type => {
      const tier = complianceAging(recordsByKey[`${p.id}:${type.key}`], thresholdDays)
      if (tier === 'red') { expired++; if (flaggedSample.length < 15) flaggedSample.push(`${p.address} — ${type.title}: expired or no record`) }
      else if (tier === 'amber') { dueSoon++; if (flaggedSample.length < 15) flaggedSample.push(`${p.address} — ${type.title}: due soon`) }
      else if (tier === 'green') valid++
    })
  })

  const topN = (obj: Record<string, number>, n: number) =>
    Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, count]) => ({ label, count }))

  // Every pre-aggregated field above is all-time and date-blind -- fine
  // for "which category comes up most" but useless for "how many did
  // Paulo finish today", which was the actual gap this was built to close
  // (see conversation this came out of). Raw per-ticket rows let Claude
  // answer ANY date-scoped question itself (today/this week/a specific
  // person/a specific day) by reasoning against currentUkDateTime below,
  // rather than needing a new pre-computed field invented for every
  // possible question in advance. Capped at 500 (most recent first) to
  // keep token cost bounded as ticket volume grows -- fine today at ~65
  // total tickets, revisit the cap if that changes materially.
  const recentTickets = (tickets || [])
    .slice()
    .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 500)
    .map((t: any) => ({
      ticketNumber: t.ticket_number,
      category: t.category,
      status: t.status,
      property: t.property_id ? addressById[t.property_id] : null,
      builder: t.assigned_builder_id ? (nameById[t.assigned_builder_id] || 'Unknown') : null,
      createdAt: t.created_at,
      firstAssignedAt: t.first_assigned_at,
      completedAt: t.completed_at,
      mileageLogged: t.mileage_logged,
      comingFrom: t.transit_start,
    }))

  return {
    ...ukNow(),
    totalTickets: (tickets || []).length,
    totalProperties: (properties || []).length,
    ticketsByStatus: statusCounts,
    ticketsByCategory: topN(categoryCounts, 20),
    openTicketsByProperty: topN(openByProperty, 15),
    builderPerformance,
    attendanceOverall,
    compliance: { expired, dueSoon, valid, flaggedSample },
    recentTickets,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { adminClient, callerStaffId } = await authorizeAdmin(req)

    const body = await req.json().catch(() => null)
    const question = (body?.question || '').trim()
    if (!question) {
      return new Response(JSON.stringify({ error: 'question is required' }), { status: 400, headers: corsHeaders })
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'AI is not configured yet -- ANTHROPIC_API_KEY is missing.' }), { status: 500, headers: corsHeaders })
    }

    const context = await buildContext(adminClient)

    const systemPrompt = `You are answering a manager's question inside PMMS, a property maintenance management system, using ONLY the JSON data below -- it's a real snapshot of their live data (no resident names or personal details are included). Answer concisely, in plain prose (no markdown headers), citing real numbers from the data.

DATA.currentUkDateTime / DATA.todayUkDate is the real current UK date and time -- use it to work out "today", "yesterday", "this week" (Mon-Sun), "this month" etc. yourself from DATA.recentTickets' date fields (all UK-relevant timestamps -- treat a date as matching "today" if its UK calendar date equals todayUkDate). DATA.recentTickets holds the most recent 500 tickets (ticketNumber, category, status, property, builder, createdAt, firstAssignedAt, completedAt, mileageLogged, comingFrom) -- count, filter or group these yourself for anything date-scoped or mileage-related that isn't already in one of the pre-aggregated fields (ticketsByStatus/ticketsByCategory/openTicketsByProperty are all-time totals, not date-scoped). A null completedAt means still open. mileageLogged is the miles the builder actually entered when starting that job (0 or null means none logged); comingFrom is where they said they travelled from ("Home"/"Office / depot"/a shop name/etc, or "Already on site"). There is NO estimated/expected mileage figure anywhere in this snapshot -- that comparison only exists live on the Clocking page and isn't something this data can answer; say so rather than guessing at an estimate.

DATA.builderPerformance is one row per active builder: completedJobs and openJobs (workload), avgTurnaroundHours (created-to-completed, all-time), and shiftsLogged/lateClockIns/onTimeClockInPct for timekeeping -- use this directly for "how is X performing" or "who's busiest" type questions rather than only citing completedJobs. DATA.attendanceOverall is the same timekeeping shape rolled up across everyone, plus dailyClockInDeadline (the UK "HH:mm" cutoff a clock-in after which counts as late) -- use it for portfolio-wide punctuality questions like "do builders clock in on time".

If a question needs information genuinely outside this snapshot (e.g. older than the 500 most recent tickets/500 most recent shifts, job quality/customer feedback, estimated mileage, or anything else this snapshot doesn't carry), say so plainly rather than guessing or making up a number.

DATA:
${JSON.stringify(context)}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: question }],
      }),
    })

    if (!claudeRes.ok) {
      // Never forward the raw provider error body to the client -- it can
      // include request/account details that aren't this caller's to see.
      console.error('Claude API error:', claudeRes.status, await claudeRes.text().catch(() => ''))
      return new Response(JSON.stringify({ error: `AI request failed (${claudeRes.status}). Try again in a moment.` }), { status: 502, headers: corsHeaders })
    }

    const claudeData = await claudeRes.json()
    const answer = claudeData.content?.[0]?.text || "I couldn't generate an answer."
    const inputTokens = claudeData.usage?.input_tokens ?? null
    const outputTokens = claudeData.usage?.output_tokens ?? null

    const { data: pricingRows } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_key, setting_value')
      .in('setting_key', ['ai_cost_per_million_input_tokens', 'ai_cost_per_million_output_tokens'])
    const pricing: Record<string, number> = {}
    ;(pricingRows || []).forEach((r: any) => { pricing[r.setting_key] = Number(r.setting_value) })

    const costUsd = (pricing.ai_cost_per_million_input_tokens != null && pricing.ai_cost_per_million_output_tokens != null && inputTokens != null && outputTokens != null)
      ? (inputTokens / 1_000_000) * pricing.ai_cost_per_million_input_tokens + (outputTokens / 1_000_000) * pricing.ai_cost_per_million_output_tokens
      : null

    await adminClient.schema('pmms').from('ai_usage_log').insert({
      staff_id: callerStaffId,
      question,
      answer,
      model: MODEL,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    })

    return new Response(JSON.stringify({ answer, usage: { inputTokens, outputTokens, costUsd } }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    console.error('ai-ask error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
