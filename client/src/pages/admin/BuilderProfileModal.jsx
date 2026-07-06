import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { modalOverlayStyle, modalCardStyle, modalLabelStyle, modalCancelBtnStyle, formatUKDateTime } from './shared'

export default function BuilderProfileModal({ builderId, onClose }) {
  const [builder, setBuilder] = useState(null)
  const [tickets, setTickets] = useState([])
  const [comments, setComments] = useState([])

  useEffect(() => {
    if (!builderId) return
    let cancelled = false

    async function load() {
      setBuilder(null)
      setTickets([])
      setComments([])

      const { data: builderData } = await supabase
        .from('staff')
        .select('id, name')
        .eq('id', builderId)
        .single()

      const { data: ticketData } = await supabase
        .schema('pmms')
        .from('tickets')
        .select(`
          id, status, description, room, mileage_logged,
          property:properties!property_id(address)
        `)
        .eq('assigned_builder_id', builderId)

      const ticketIds = (ticketData || []).map(t => t.id)
      let commentData = []
      if (ticketIds.length > 0) {
        const { data } = await supabase
          .schema('pmms')
          .from('comments')
          .select('id, ticket_id, body, author_name, role, created_at')
          .in('ticket_id', ticketIds)
          .order('created_at', { ascending: false })
        commentData = data || []
      }

      if (!cancelled) {
        setBuilder(builderData)
        setTickets(ticketData || [])
        setComments(commentData)
      }
    }

    load()
    return () => { cancelled = true }
  }, [builderId])

  if (!builderId || !builder) return null

  const activeJobs = tickets.filter(t => t.status !== 'Completed' && t.status !== 'Archived')
  const completedJobs = tickets.filter(t => t.status === 'Completed' || t.status === 'Archived')
  const inProgressJob = tickets.find(t => t.status === 'In Progress')
  const totalMiles = tickets.reduce((sum, t) => sum + (t.mileage_logged || 0), 0)

  let dutyBadge = { label: 'Standby / Idle', bg: '#f1f5f9', color: '#94a3b8' }
  if (inProgressJob) dutyBadge = { label: 'On-Site Active', bg: '#dcfce7', color: '#16a34a' }
  else if (activeJobs.length > 0) dutyBadge = { label: 'Assigned / Transit', bg: '#dbeafe', color: '#1d4ed8' }

  return (
    <div style={modalOverlayStyle}>
      <div style={{ ...modalCardStyle, maxWidth: '640px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '12px', marginBottom: '16px' }}>
          <div>
            <p style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>{builder.name}</p>
            <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', fontWeight: 800, color: dutyBadge.color, background: dutyBadge.bg, padding: '3px 10px', borderRadius: '20px' }}>
              {dutyBadge.label}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '20px' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Active Jobs</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{activeJobs.length}</strong>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Completed</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: '#16a34a', marginTop: '4px' }}>{completedJobs.length}</strong>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Total Miles</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: '#0d9488', marginTop: '4px' }}>{totalMiles.toFixed(1)}</strong>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '10px', textAlign: 'center' }}>
            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Log Events</span>
            <strong style={{ display: 'block', fontSize: '18px', fontWeight: 800, color: '#0f172a', marginTop: '4px' }}>{comments.length}</strong>
          </div>
        </div>

        <p style={modalLabelStyle}>Current Assignment</p>
        {inProgressJob ? (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px' }}>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#16a34a' }}>#{inProgressJob.id}</span>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{inProgressJob.property?.address}</span>
            <span style={{ display: 'block', fontSize: '13px', color: '#475569' }}>{inProgressJob.room || '—'} → {inProgressJob.description}</span>
          </div>
        ) : activeJobs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeJobs.map(j => (
              <div key={j.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>#{j.id}</span>{' '}
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{j.property?.address}</span>{' '}
                <span style={{ fontSize: '12px', color: '#64748b' }}>— {j.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No active assignment.</p>
        )}

        <p style={modalLabelStyle}>Recent Activity</p>
        <div style={{ border: '1px solid #f1f5f9', borderRadius: '10px', padding: '10px 12px', maxHeight: '260px', overflowY: 'auto' }}>
          {comments.length === 0 && (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>No recorded history for this builder yet.</p>
          )}
          {comments.slice(0, 10).map(c => (
            <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>Job #{c.ticket_id} · {c.author_name}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatUKDateTime(c.created_at)}</span>
              </div>
              <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#475569' }}>{c.body}</p>
            </div>
          ))}
        </div>

        <div style={{ marginTop: '16px' }}>
          <button onClick={onClose} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
