import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  formatDuration, postSystemComment, postAuditEvent,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle, modalLabelStyle,
  modalTextareaStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle,
} from './shared'

export default function AdminSignOff({ profile, onTicketsChanged }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [workedMsByTicket, setWorkedMsByTicket] = useState({})

  const [reopenModalTicket, setReopenModalTicket] = useState(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [archiveErrors, setArchiveErrors] = useState({})

  useEffect(() => {
    fetchPending()
  }, [])

  async function fetchPending() {
    const { data: ticketsData, error: ticketsError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, category, description, room, issue_tag, completion_note, completion_photo_url, photo_url, assigned_builder_id,
        property:properties!property_id(address)
      `)
      .eq('status', 'Completed')
      .order('completed_at', { ascending: false })

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name')

    if (!ticketsError && !staffError) {
      const merged = ticketsData.map(t => ({
        ...t,
        builderName: staffData.find(s => s.id === t.assigned_builder_id)?.name,
      }))
      setTickets(merged)
      await fetchWorkedTimes(merged.map(t => t.id))
    }
    setLoading(false)
    onTicketsChanged?.()
  }

  async function fetchWorkedTimes(ticketIds) {
    if (ticketIds.length === 0) { setWorkedMsByTicket({}); return }

    const { data, error } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('ticket_id, started_at, ended_at')
      .in('ticket_id', ticketIds)
      .not('ended_at', 'is', null)

    if (error) return

    const map = {}
    data.forEach(s => {
      const ms = new Date(s.ended_at) - new Date(s.started_at)
      map[s.ticket_id] = (map[s.ticket_id] || 0) + ms
    })
    setWorkedMsByTicket(map)
  }

  async function verifyAndArchive(ticket) {
    setArchiveErrors(prev => ({ ...prev, [ticket.id]: '' }))

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Archived' })
      .eq('id', ticket.id)

    if (error) {
      setArchiveErrors(prev => ({ ...prev, [ticket.id]: error.message }))
      return
    }

    const now = new Date()
    const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    await postSystemComment(ticket.id, profile, `Verified and archived by ${profile.name} on ${stamp}.`)
    await postAuditEvent(ticket.id, profile, 'Status Changed', `Completed → Archived (verified by ${profile.name})`)
    await fetchPending()
  }

  function openReopenModal(ticket) { setReopenModalTicket(ticket); setReopenReason(''); setReopenError('') }
  function closeReopenModal() { setReopenModalTicket(null) }

  async function submitReopen() {
    if (!reopenReason.trim()) { setReopenError('Please enter a reason.'); return }

    const t = reopenModalTicket

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Assigned' })
      .eq('id', t.id)

    if (error) { setReopenError(error.message); return }

    await postSystemComment(t.id, profile, `Reopened. Reason: ${reopenReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Status Changed', `Completed → Assigned (reopened). Reason: ${reopenReason.trim()}`)
    await fetchPending()
    closeReopenModal()
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading pending sign-offs...</p>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: '#f3e8ff', color: '#9333ea', fontSize: '16px' }}>✓</span>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Pending Sign-Off ({tickets.length} ticket{tickets.length === 1 ? '' : 's'})</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Completed repairs awaiting office verification before archiving.</p>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>
            All clear — no completed repairs awaiting verification.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {tickets.map(t => (
            <div key={t.id} style={{ border: '1px solid #e9d5ff', background: '#faf5ff', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                {(t.completion_photo_url || t.photo_url) && (
                  <img src={t.completion_photo_url || t.photo_url} alt="Completion" style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '8px', flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>#{t.id}</span>
                  <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</span>
                  <span style={{ display: 'block', fontSize: '13px', color: '#475569' }}>{t.issue_tag || t.category}</span>
                  <span style={{ display: 'block', fontSize: '13px', color: '#7e22ce', fontWeight: 600, marginTop: '2px' }}>Completed by {t.builderName || 'Unknown'}</span>
                  {t.completion_note && (
                    <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#475569', background: '#fff', border: '1px solid #e9d5ff', borderRadius: '8px', padding: '8px 10px' }}>{t.completion_note}</p>
                  )}
                  {workedMsByTicket[t.id] != null && (
                    <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', fontWeight: 700, color: '#0d9488', background: '#f0fdfa', padding: '2px 8px', borderRadius: '20px' }}>
                      ⏱ {formatDuration(workedMsByTicket[t.id])} worked
                    </span>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  onClick={() => verifyAndArchive(t)}
                  style={{ flex: 1, padding: '10px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ✓ Verify &amp; Archive
                </button>
                <button
                  onClick={() => openReopenModal(t)}
                  style={{ flex: 1, padding: '10px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ↩ Reopen
                </button>
              </div>
              {archiveErrors[t.id] && (
                <p style={modalErrorStyle}>⚠ Couldn't archive: {archiveErrors[t.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reopen modal */}
      {reopenModalTicket && (
        <div style={modalOverlayStyle} onClick={closeReopenModal}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <p style={modalTitleStyle}>Reopen Ticket #{reopenModalTicket.id}</p>
            <p style={modalSubtitleStyle}>{reopenModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Reason (required)</label>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              rows={2}
              placeholder="e.g. Resident says the leak came back..."
              style={modalTextareaStyle}
            />

            {reopenError && <p style={modalErrorStyle}>{reopenError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeReopenModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitReopen} style={{ ...modalConfirmBtnStyle, background: '#dc2626' }}>Reopen Ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
