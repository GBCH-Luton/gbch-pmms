// Housekeeping Manager's control screen (Cleaners Rota Phase 4). Three
// sections: which properties are due/overdue for their routine visit,
// each cleaner's current workload, and delay reasons awaiting approval
// (Phase 3). Reassignment itself isn't rebuilt here -- a property's
// cleaner is reassigned from its Property Profile (PropertyCoreTab.jsx),
// a single job from the Pipeline page, both already existing -- this
// page links out to them rather than duplicating that UI.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { attachProperties } from '../../lib/properties'
import {
  fetchRoutineVisitAging, fetchAssignableStaffForCategory, createNotification, postAuditEvent,
  STAFF_AVAILABILITY_STYLES,
} from './shared'

const cardStyle = { background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const sectionTitleStyle = { margin: '0 0 4px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }
const sectionSubtitleStyle = { margin: '0 0 16px 0', fontSize: '13px', color: '#64748b' }

const TIER_STYLES = {
  red: { bg: '#fee2e2', color: '#dc2626' },
  amber: { bg: '#fef3c7', color: '#d97706' },
  green: { bg: '#dcfce7', color: '#16a34a' },
  grey: { bg: '#f1f5f9', color: '#64748b' },
}

const OPEN_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']

export default function AdminHousekeeping({ profile, onNavigate }) {
  const [visits, setVisits] = useState([])
  const [cleaners, setCleaners] = useState([])
  const [pendingDelays, setPendingDelays] = useState([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState({})
  const [actionSubmitting, setActionSubmitting] = useState({})

  useEffect(() => {
    fetchAll()
  }, [])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchVisits(), fetchWorkload(), fetchPendingDelays()])
    setLoading(false)
  }

  async function fetchVisits() {
    setVisits(await fetchRoutineVisitAging())
  }

  async function fetchWorkload() {
    const staff = await fetchAssignableStaffForCategory('Cleaning Rota')
    if (!staff.length) { setCleaners([]); return }

    const { data: properties } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, assigned_cleaner_id')
      .in('assigned_cleaner_id', staff.map(s => s.id))

    const { data: openTickets } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, assigned_builder_id, status')
      .in('assigned_builder_id', staff.map(s => s.id))
      .in('status', OPEN_STATUSES)

    setCleaners(staff.map(s => ({
      ...s,
      propertyCount: (properties || []).filter(p => p.assigned_cleaner_id === s.id).length,
      openTicketCount: (openTickets || []).filter(t => t.assigned_builder_id === s.id).length,
    })))
  }

  async function fetchPendingDelays() {
    const { data } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, property_id, assigned_builder_id, delay_reason, delay_reason_note, delay_reason_submitted_at')
      .eq('delay_reason_status', 'pending')
      .order('delay_reason_submitted_at', { ascending: true })

    if (!data?.length) { setPendingDelays([]); return }

    const withProperties = await attachProperties(data, 'address')
    const { data: staff } = await supabase.from('staff').select('id, name').in('id', data.map(t => t.assigned_builder_id))
    const nameById = {}
    ;(staff || []).forEach(s => { nameById[s.id] = s.name })

    setPendingDelays(withProperties.map(t => ({ ...t, cleanerName: nameById[t.assigned_builder_id] || 'Unknown' })))
  }

  async function handleReviewDelay(ticket, decision) {
    setActionSubmitting(prev => ({ ...prev, [ticket.id]: true }))
    setActionError(prev => ({ ...prev, [ticket.id]: '' }))

    const now = new Date().toISOString()
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ delay_reason_status: decision, delay_reason_reviewed_at: now, delay_reason_reviewed_by: profile.id })
      .eq('id', ticket.id)

    if (error) {
      setActionSubmitting(prev => ({ ...prev, [ticket.id]: false }))
      setActionError(prev => ({ ...prev, [ticket.id]: error.message }))
      return
    }

    await postAuditEvent(ticket.id, profile, 'Delay Reason Reviewed', `${decision === 'approved' ? 'Approved' : 'Rejected'} by ${profile.name}`)
    await createNotification(
      ticket.assigned_builder_id,
      ticket.id,
      decision === 'approved'
        ? `Your delay reason for Job #${ticket.ticket_number} was approved.`
        : `Your delay reason for Job #${ticket.ticket_number} was not approved -- please speak to your manager.`,
    )

    setActionSubmitting(prev => ({ ...prev, [ticket.id]: false }))
    await fetchPendingDelays()
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading Housekeeping...</p>
    </div>
  )

  return (
    <div>
      <h1 style={{ margin: '0 0 16px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Housekeeping</h1>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Routine Visits Due</p>
        <p style={sectionSubtitleStyle}>Every property with a cleaner assigned, ordered by how overdue it is.</p>
        {visits.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No properties have a cleaner assigned yet.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visits.map(v => {
            const style = TIER_STYLES[v.tier]
            return (
              <button
                key={v.propertyId}
                onClick={() => onNavigate?.('properties', { propertyId: v.propertyId })}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', textAlign: 'left' }}
              >
                <div>
                  <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{v.address}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{v.cleanerName}{v.daysSince != null ? ` — ${v.daysSince} days since last visit` : ''}</p>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: style.color, background: style.bg, padding: '3px 10px', borderRadius: '20px', flexShrink: 0 }}>{v.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Cleaner Workload</p>
        <p style={sectionSubtitleStyle}>How many properties and open jobs each cleaner currently has.</p>
        {cleaners.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No Housekeepers found.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {cleaners.map(c => {
            const availStyle = STAFF_AVAILABILITY_STYLES[c.availability] || STAFF_AVAILABILITY_STYLES['Available']
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                <div>
                  <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{c.name}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>{c.propertyCount} propert{c.propertyCount === 1 ? 'y' : 'ies'} · {c.openTicketCount} open job{c.openTicketCount === 1 ? '' : 's'}</p>
                </div>
                <span style={{ fontSize: '11px', fontWeight: 800, color: availStyle.color, background: availStyle.bg, padding: '3px 10px', borderRadius: '20px', flexShrink: 0 }}>{c.availability}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={cardStyle}>
        <p style={sectionTitleStyle}>Pending Delay Reasons</p>
        <p style={sectionSubtitleStyle}>A cleaner reported they couldn't complete a routine visit on time -- review before it's accepted.</p>
        {pendingDelays.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Nothing waiting for review.</p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {pendingDelays.map(t => (
            <div key={t.id} style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>#{t.ticket_number}</p>
              <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</p>
              <p style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#78350f' }}>
                <strong>{t.cleanerName}</strong>: {t.delay_reason}{t.delay_reason_note ? ` — ${t.delay_reason_note}` : ''}
              </p>
              {actionError[t.id] && <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#dc2626' }}>{actionError[t.id]}</p>}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleReviewDelay(t, 'approved')}
                  disabled={actionSubmitting[t.id]}
                  style={{ flex: 1, padding: '8px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: actionSubmitting[t.id] ? 'not-allowed' : 'pointer' }}
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => handleReviewDelay(t, 'rejected')}
                  disabled={actionSubmitting[t.id]}
                  style={{ flex: 1, padding: '8px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: actionSubmitting[t.id] ? 'not-allowed' : 'pointer' }}
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
