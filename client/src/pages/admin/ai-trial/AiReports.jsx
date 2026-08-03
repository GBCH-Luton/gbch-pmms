// AI Trial: type a question in plain English, matched against a small set
// of supported question patterns, each backed by a real query against
// production data. Not a general natural-language query engine -- if the
// question doesn't match a supported pattern, it says so and lists what it
// can currently answer, rather than guessing.

import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { COLORS } from '../../../lib/colors'
import { attachProperties } from '../../../lib/properties'
import { computeComplianceAging, COMPLIANCE_TYPES } from '../shared'

const EXAMPLE_QUESTIONS = [
  'Which properties have the most open tickets?',
  'What compliance is overdue or expiring soon?',
  'What is the most common issue category?',
  'Which builders have completed the most jobs?',
]

const PATTERNS = [
  { test: /propert.*(most|top).*(ticket|issue)|which propert.*(most|open)/i, key: 'topProperties' },
  { test: /compliance.*(overdue|expired|expiring|lapsing)|overdue.*compliance/i, key: 'complianceOverdue' },
  { test: /(most common|top).*(issue|categor)/i, key: 'topCategory' },
  { test: /builder.*(most|top).*(job|complet)|who.*most.*job/i, key: 'topBuilders' },
]

const cardStyle = { background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px' }
const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }
const tdStyle = { padding: '8px 10px', fontSize: '13px', color: COLORS.slate900, borderTop: `1px solid ${COLORS.slate100}` }

async function runTopProperties() {
  const { data } = await supabase.schema('pmms').from('tickets').select('id, property_id').not('status', 'in', '("Completed","Archived","Cancelled")')
  if (!data?.length) return { summary: 'No open tickets right now.', rows: [] }

  const counts = {}
  data.forEach(t => { if (t.property_id) counts[t.property_id] = (counts[t.property_id] || 0) + 1 })
  const withProps = await attachProperties(Object.keys(counts).map(id => ({ property_id: id })), 'address')
  const rows = withProps.map(r => ({ label: r.property?.address || 'Unknown', value: counts[r.property_id] }))
    .sort((a, b) => b.value - a.value).slice(0, 5)

  return {
    summary: rows.length ? `${rows[0].label} has the most open tickets right now, with ${rows[0].value}.` : 'No open tickets right now.',
    columns: ['Property', 'Open tickets'], rows,
  }
}

async function runComplianceOverdue() {
  const { data: properties } = await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability')
  const { data: records } = await supabase.schema('pmms').from('property_compliance').select('*')
  const recordsByKey = {}
  ;(records || []).forEach(r => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })

  const flagged = []
  ;(properties || []).forEach(p => {
    COMPLIANCE_TYPES.forEach(type => {
      const record = recordsByKey[`${p.id}:${type.key}`]
      const aging = computeComplianceAging(record)
      if (aging.tier === 'red' || aging.tier === 'amber') {
        flagged.push({ label: `${p.address} — ${type.title}`, value: aging.label, vulnerable: p.high_vulnerability })
      }
    })
  })

  const vulnCount = flagged.filter(f => f.vulnerable).length
  const summary = flagged.length
    ? `${flagged.length} certificate${flagged.length === 1 ? '' : 's'} expired or expiring soon${vulnCount ? `, including ${vulnCount} at high-vulnerability properties` : ''}.`
    : 'Nothing expired or expiring soon -- compliance looks current.'

  return { summary, columns: ['Property / Certificate', 'Status'], rows: flagged.slice(0, 10).map(f => ({ label: f.label, value: f.value })) }
}

async function runTopCategory() {
  const { data } = await supabase.schema('pmms').from('tickets').select('category')
  if (!data?.length) return { summary: 'No tickets logged yet.', rows: [] }

  const counts = {}
  data.forEach(t => { if (t.category) counts[t.category] = (counts[t.category] || 0) + 1 })
  const rows = Object.entries(counts).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 5)

  return {
    summary: rows.length ? `${rows[0].label} is the most common issue category, with ${rows[0].value} ticket${rows[0].value === 1 ? '' : 's'} all-time.` : 'No tickets logged yet.',
    columns: ['Category', 'Tickets (all-time)'], rows,
  }
}

async function runTopBuilders() {
  const { data } = await supabase.schema('pmms').from('tickets').select('assigned_builder_id').eq('status', 'Completed')
  if (!data?.length) return { summary: 'No completed jobs recorded yet.', rows: [] }

  const counts = {}
  data.forEach(t => { if (t.assigned_builder_id) counts[t.assigned_builder_id] = (counts[t.assigned_builder_id] || 0) + 1 })
  const ids = Object.keys(counts)
  if (!ids.length) return { summary: 'No completed jobs recorded yet.', rows: [] }

  const { data: staffRows } = await supabase.from('staff').select('id, name').in('id', ids)
  const nameById = {}
  ;(staffRows || []).forEach(s => { nameById[s.id] = s.name })

  const rows = ids.map(id => ({ label: nameById[id] || 'Unknown', value: counts[id] })).sort((a, b) => b.value - a.value).slice(0, 5)

  return {
    summary: rows.length ? `${rows[0].label} has completed the most jobs, with ${rows[0].value} all-time.` : 'No completed jobs recorded yet.',
    columns: ['Builder', 'Completed jobs (all-time)'], rows,
  }
}

const RUNNERS = { topProperties: runTopProperties, complianceOverdue: runComplianceOverdue, topCategory: runTopCategory, topBuilders: runTopBuilders }

export default function AiReports() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [unmatched, setUnmatched] = useState(false)

  async function handleAsk() {
    const match = PATTERNS.find(p => p.test.test(question))
    setResult(null)
    setUnmatched(false)

    if (!match) { setUnmatched(true); return }

    setLoading(true)
    const data = await RUNNERS[match.key]()
    setResult(data)
    setLoading(false)
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>AI Trial · Reports</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>Ask a question in plain English -- answers come from your real data.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '18px' }}>
        <span style={{ fontSize: '18px' }}>✨</span>
        <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.5 }}>
          <b style={{ color: COLORS.slate900 }}>AI Trial — pattern-matched, not a general question answerer yet.</b> Works for the 4 example questions below; anything else won't be understood.
        </p>
      </div>

      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder="e.g. Which properties have the most open tickets?"
            style={{ flex: 1, height: '44px', padding: '0 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', boxSizing: 'border-box' }}
          />
          <button onClick={handleAsk} disabled={!question.trim() || loading} style={{ padding: '0 20px', borderRadius: '10px', border: 'none', background: COLORS.teal700, color: COLORS.white, fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: !question.trim() || loading ? 0.5 : 1 }}>
            {loading ? '...' : 'Ask →'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
          {EXAMPLE_QUESTIONS.map(q => (
            <button key={q} onClick={() => { setQuestion(q); setResult(null); setUnmatched(false) }} style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '999px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate600, cursor: 'pointer' }}>
              {q}
            </button>
          ))}
        </div>
      </div>

      {unmatched && (
        <div style={{ ...cardStyle }}>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600 }}>I can currently only answer the 4 example questions above -- try one of those, or phrase your question similarly.</p>
        </div>
      )}

      {result && (
        <div style={cardStyle}>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{result.summary}</p>
          {result.rows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={thStyle}>{result.columns[0]}</th><th style={thStyle}>{result.columns[1]}</th></tr></thead>
              <tbody>
                {result.rows.map((r, i) => (
                  <tr key={i}><td style={tdStyle}>{r.label}</td><td style={tdStyle}>{r.value}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
