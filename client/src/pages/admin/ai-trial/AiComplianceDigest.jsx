// AI Trial: a plain-language compliance briefing built from real
// property_compliance data, using the same aging logic (computeComplianceAging)
// AdminCompliance.jsx itself uses. The "writing" is templated sentence
// construction driven by real numbers, not a real language model.

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { COLORS } from '../../../lib/colors'
import { computeComplianceAging, COMPLIANCE_TYPES } from '../shared'

const cardStyle = { background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '24px' }
const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }
const tdStyle = { padding: '8px 10px', fontSize: '13px', color: COLORS.slate900, borderTop: `1px solid ${COLORS.slate100}` }

export default function AiComplianceDigest() {
  const [loading, setLoading] = useState(true)
  const [digest, setDigest] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { data: properties } = await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability')
    const { data: records } = await supabase.schema('pmms').from('property_compliance').select('*')
    const recordsByKey = {}
    ;(records || []).forEach(r => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })

    const expired = []
    const dueSoon = []
    const byType = {}

    ;(properties || []).forEach(p => {
      COMPLIANCE_TYPES.forEach(type => {
        const record = recordsByKey[`${p.id}:${type.key}`]
        const aging = computeComplianceAging(record)
        if (aging.tier !== 'red' && aging.tier !== 'amber') return

        const entry = { property: p.address, vulnerable: p.high_vulnerability, type: type.title, aging }
        if (aging.tier === 'red') expired.push(entry)
        else dueSoon.push(entry)

        byType[type.title] = (byType[type.title] || 0) + 1
      })
    })

    const flaggedTotal = expired.length + dueSoon.length
    const vulnTotal = [...expired, ...dueSoon].filter(e => e.vulnerable).length
    const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0]

    let paragraph
    if (flaggedTotal === 0) {
      paragraph = 'Nothing expired or due soon across any tracked certificate type -- compliance is fully current right now.'
    } else {
      const parts = []
      parts.push(`${flaggedTotal} certificate${flaggedTotal === 1 ? ' is' : 's are'} expired or due within the usual review window`)
      if (expired.length) parts.push(`${expired.length} already expired`)
      if (vulnTotal) parts.push(`${vulnTotal} at high-vulnerability propert${vulnTotal === 1 ? 'y' : 'ies'}`)
      paragraph = parts.join(', ') + '.'
      if (topType) paragraph += ` ${topType[0]} needs the most attention -- ${topType[1]} of the ${flaggedTotal} flagged item${flaggedTotal === 1 ? '' : 's'} ${topType[1] === 1 ? 'is' : 'are'} that type.`
    }

    setDigest({ paragraph, expired, dueSoon, byType })
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Reading compliance records...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>AI Trial · Compliance Digest</h1>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>A plain-language summary of the same data the Compliance page tracks.</p>
        </div>
        <button onClick={load} style={{ flexShrink: 0, background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '18px' }}>
        <span style={{ fontSize: '18px' }}>✨</span>
        <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.5 }}>
          <b style={{ color: COLORS.slate900 }}>How to read this page:</b> there's nothing to type or click to get a result -- it reads every property's compliance record automatically and writes the summary below the moment the page opens. Every figure is a live count from your real records, not a generated guess. Use <b>Refresh</b> above if you've changed a compliance record and want the summary to catch up.
        </p>
      </div>

      <div style={{ ...cardStyle, marginBottom: '16px' }}>
        <p style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: COLORS.slate900, lineHeight: 1.6 }}>{digest.paragraph}</p>
      </div>

      {digest.expired.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: '16px' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 800, color: COLORS.red600 }}>Expired ({digest.expired.length})</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thStyle}>Property</th><th style={thStyle}>Certificate</th></tr></thead>
            <tbody>
              {digest.expired.map((e, i) => (
                <tr key={i}><td style={tdStyle}>{e.property}{e.vulnerable && ' ⚠️'}</td><td style={tdStyle}>{e.type}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {digest.dueSoon.length > 0 && (
        <div style={cardStyle}>
          <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 800, color: COLORS.amber600 }}>Due Soon ({digest.dueSoon.length})</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={thStyle}>Property</th><th style={thStyle}>Certificate</th><th style={thStyle}>Status</th></tr></thead>
            <tbody>
              {digest.dueSoon.map((e, i) => (
                <tr key={i}><td style={tdStyle}>{e.property}{e.vulnerable && ' ⚠️'}</td><td style={tdStyle}>{e.type}</td><td style={tdStyle}>{e.aging.label}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
