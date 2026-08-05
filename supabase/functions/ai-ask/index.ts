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

async function buildContext(adminClient: any) {
  const [{ data: tickets }, { data: properties }, { data: complianceRecords }, { data: staff }, { data: thresholdRow }] = await Promise.all([
    adminClient.schema('pmms').from('tickets').select('property_id, category, status, assigned_builder_id'),
    adminClient.schema('pmms').from('properties').select('id, address'),
    adminClient.schema('pmms').from('property_compliance').select('property_id, cert_type, expiry_date, not_applicable'),
    adminClient.from('staff').select('id, name'),
    adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'compliance_aging_threshold_days').maybeSingle(),
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
  const completedByBuilder: Record<string, number> = {}

  ;(tickets || []).forEach((t: any) => {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1
    if (t.category) categoryCounts[t.category] = (categoryCounts[t.category] || 0) + 1
    if (openStatuses.has(t.status) && t.property_id) {
      const addr = addressById[t.property_id] || 'Unknown property'
      openByProperty[addr] = (openByProperty[addr] || 0) + 1
    }
    if (t.status === 'Completed' && t.assigned_builder_id) {
      const name = nameById[t.assigned_builder_id] || 'Unknown'
      completedByBuilder[name] = (completedByBuilder[name] || 0) + 1
    }
  })

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

  return {
    totalTickets: (tickets || []).length,
    totalProperties: (properties || []).length,
    ticketsByStatus: statusCounts,
    ticketsByCategory: topN(categoryCounts, 20),
    openTicketsByProperty: topN(openByProperty, 15),
    completedJobsByBuilder: topN(completedByBuilder, 15),
    compliance: { expired, dueSoon, valid, flaggedSample },
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

    const systemPrompt = `You are answering a manager's question inside PMMS, a property maintenance management system, using ONLY the JSON data below -- it's a real snapshot of their live data, already aggregated (no resident names or personal details are included). Answer concisely, in plain prose (no markdown headers), citing real numbers from the data. If the question needs information that isn't in this snapshot, say so plainly rather than guessing or making up a number.\n\nDATA:\n${JSON.stringify(context)}`

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
