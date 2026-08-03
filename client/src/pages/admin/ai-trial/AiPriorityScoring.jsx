// AI Trial: scans open tickets' free-text description/issue tag for
// severity keywords the fixed category/issue-tag score might under-weigh,
// and flags a suggested re-priority for a human to review. Free,
// rule-based (keywordEngine.js) -- not a real language model, and never
// changes a ticket's actual score itself; it's read-only.

import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { COLORS } from '../../../lib/colors'
import { attachProperties } from '../../../lib/properties'
import { priorityTierLabel, fetchPriorityThresholds } from '../shared'
import { suggestPriorityAdjustment } from './keywordEngine'

const tierColour = (tier) => tier === 'P1 Critical' ? COLORS.red600 : tier === 'P2 Urgent' ? COLORS.amber600 : COLORS.slate500

export default function AiPriorityScoring({ onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [flagged, setFlagged] = useState([])

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { p1, p2 } = await fetchPriorityThresholds()

    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, issue_tag, description, priority_score, status, property_id')
      .not('status', 'in', '("Completed","Archived","Cancelled")')

    if (error || !data) { setLoading(false); return }

    const withProperties = await attachProperties(data, 'address')

    const results = withProperties.map(t => {
      const text = `${t.issue_tag || ''} ${t.description || ''}`
      const { bonus, reason } = suggestPriorityAdjustment(text)
      const currentScore = t.priority_score || 0
      const suggestedScore = currentScore + bonus
      return {
        ...t,
        currentTier: priorityTierLabel(currentScore, p1, p2),
        suggestedTier: priorityTierLabel(suggestedScore, p1, p2),
        currentScore, suggestedScore, bonus, reason,
      }
    }).filter(t => t.bonus > 0)
      .sort((a, b) => b.bonus - a.bonus)

    setFlagged(results)
    setLoading(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Scanning open tickets...</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>AI Trial · Priority Scoring</h1>
          <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>Open tickets whose description suggests a different urgency than their current score.</p>
        </div>
        <button onClick={load} style={{ flexShrink: 0, background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '8px 14px', fontSize: '12.5px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      <div style={{ background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '16px 18px', marginBottom: '18px' }}>
        <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 800, color: COLORS.slate900 }}>✨ What this page is</p>
        <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
          Every ticket already has a priority score (P1/P2/P3), first calculated on the <b>Log a Ticket</b> page and shown on the <b>Pipeline</b> page. That score comes from a fixed points system your admin set up on Settings -- each category and issue tag is worth a set number of points.
        </p>
        <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
          This page double-checks that score against what was actually <i>written</i> on each open ticket. It scans the description and issue tag for words like "burst," "flooding," "sparking," "gas smell," "no heat," or "emergency" -- and if it finds one that the fixed score doesn't seem to account for, it lists that ticket below as a suggestion worth a second look.
        </p>
        <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
          <b style={{ color: COLORS.slate900 }}>What to do if a ticket is listed here:</b> go find it on the Pipeline page and decide for yourself. If you agree it should be more urgent, use Pipeline's own "Priority Override" feature to bump it -- this page cannot change a ticket's score itself, it can only point one out.
        </p>
        <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.6 }}>
          <b style={{ color: COLORS.slate900 }}>If nothing is listed below:</b> that's a good result -- it means today's Pipeline priorities already match what people wrote, and there's nothing to reconsider right now. Use <b>Refresh</b> above to check again after new tickets come in.
        </p>
      </div>

      {flagged.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '14px', color: COLORS.slate600, fontWeight: 600 }}>All clear — nothing flagged right now.</p>
          <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate400 }}>Either there are no open tickets, or none of their descriptions mention a severity keyword the current score doesn't already account for. That's a normal, good result — not a sign the page isn't working.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {flagged.map(t => (
            <div key={t.id} style={{ background: COLORS.white, borderRadius: '14px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '16px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '10px' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 3px 0', fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}>#{t.ticket_number} · {t.category}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>{t.property?.address || 'Unknown property'}</p>
                </div>
                <button onClick={() => onNavigate?.('pipeline')} style={{ flexShrink: 0, background: 'none', border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', fontSize: '11px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer' }}>
                  Review in Pipeline →
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12.5px' }}>
                <span style={{ color: COLORS.slate400 }}>Currently</span>
                <span style={{ fontWeight: 800, color: tierColour(t.currentTier) }}>{t.currentTier} · {t.currentScore}pts</span>
                <span style={{ color: COLORS.slate300 }}>→</span>
                <span style={{ color: COLORS.slate400 }}>Suggested</span>
                <span style={{ fontWeight: 800, color: tierColour(t.suggestedTier) }}>{t.suggestedTier} · {t.suggestedScore}pts</span>
              </div>
              <p style={{ margin: '8px 0 0 0', fontSize: '11.5px', color: COLORS.slate500 }}>{t.reason}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
