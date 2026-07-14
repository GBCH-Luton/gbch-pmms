import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { attachProperties } from '../../lib/properties'
import {
  formatDuration, postSystemComment, postAuditEvent, filterSelectStyle,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle, modalLabelStyle,
  modalTextareaStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle,
} from './shared'

export default function AdminSignOff({ profile, onTicketsChanged }) {
  const [tickets, setTickets] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [workedMsByTicket, setWorkedMsByTicket] = useState({})

  const [propertyFilter, setPropertyFilter] = useState('All')
  const [ticketNumberFilter, setTicketNumberFilter] = useState('')
  const [raiserFilter, setRaiserFilter] = useState('All')

  const [reopenModalTicket, setReopenModalTicket] = useState(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [archiveErrors, setArchiveErrors] = useState({})

  const [archiveConfirmTicket, setArchiveConfirmTicket] = useState(null)
  const [archiveConfirming, setArchiveConfirming] = useState(false)

  useEffect(() => {
    fetchPending()
    fetchProperties()
  }, [])

  async function fetchProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address')
      .order('address')

    if (!error) setProperties(data)
  }

  async function fetchPending() {
    const { data: ticketsData, error: ticketsError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, ticket_number, category, description, room, issue_tag, completion_note, completion_photo_url, photo_url, assigned_builder_id, property_id, raised_by, raised_by_name
      `)
      .eq('status', 'Completed')
      .order('completed_at', { ascending: false })

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name')

    if (!ticketsError && !staffError) {
      const withProperties = await attachProperties(ticketsData, 'address')
      const merged = withProperties.map(t => ({
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

  function openArchiveConfirm(ticket) {
    setArchiveConfirmTicket(ticket)
  }

  function closeArchiveConfirm() {
    setArchiveConfirmTicket(null)
  }

  async function confirmArchive() {
    const ticket = archiveConfirmTicket
    setArchiveConfirming(true)
    await verifyAndArchive(ticket)
    setArchiveConfirming(false)
    setArchiveConfirmTicket(null)
  }

  async function verifyAndArchive(ticket) {
    setArchiveErrors(prev => ({ ...prev, [ticket.id]: '' }))

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Archived', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null })
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
      .update({ status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null })
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

  // Derived from whichever tickets are actually pending sign-off right now,
  // not a full staff fetch -- keeps the dropdown short and relevant instead
  // of listing every builder/admin who has never raised anything.
  const raisers = Object.values(
    tickets.reduce((acc, t) => {
      if (t.raised_by) acc[t.raised_by] = { id: t.raised_by, name: t.raised_by_name || 'Unknown' }
      return acc
    }, {})
  ).sort((a, b) => a.name.localeCompare(b.name))

  const filteredTickets = tickets.filter(t => {
    // Native <select> values are always strings, but property_id off the
    // ticket is a number -- compare as strings so "3" matches 3.
    if (propertyFilter !== 'All' && String(t.property_id) !== String(propertyFilter)) return false
    if (ticketNumberFilter.trim() && !String(t.id).includes(ticketNumberFilter.trim())) return false
    if (raiserFilter !== 'All' && String(t.raised_by) !== String(raiserFilter)) return false
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: '#f3e8ff', color: '#9333ea', fontSize: '16px' }}>✓</span>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Pending Sign-Off ({filteredTickets.length} ticket{filteredTickets.length === 1 ? '' : 's'})</h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Completed repairs awaiting office verification before archiving.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Properties</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.address}</option>
          ))}
        </select>
        <select value={raiserFilter} onChange={(e) => setRaiserFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Raisers</option>
          {raisers.map(r => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <input
          type="text"
          value={ticketNumberFilter}
          onChange={(e) => setTicketNumberFilter(e.target.value)}
          placeholder="Search ticket #..."
          style={{ ...filterSelectStyle, cursor: 'text', width: '160px' }}
        />
        {(propertyFilter !== 'All' || ticketNumberFilter || raiserFilter !== 'All') && (
          <button
            onClick={() => { setPropertyFilter('All'); setTicketNumberFilter(''); setRaiserFilter('All') }}
            style={{ ...filterSelectStyle, background: '#fff' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredTickets.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>
            {tickets.length === 0 ? 'All clear — no completed repairs awaiting verification.' : 'No completed repairs match these filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredTickets.map(t => (
            <div key={t.id} style={{ border: '1px solid #e9d5ff', background: '#faf5ff', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>#{t.ticket_number}</span>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</span>
                <span style={{ display: 'block', fontSize: '13px', color: '#475569' }}>{t.room ? `${t.room} — ` : ''}{t.issue_tag || t.category}</span>
                <span style={{ display: 'block', fontSize: '13px', color: '#7e22ce', fontWeight: 600, marginTop: '2px' }}>Completed by {t.builderName || 'Unknown'}</span>
                <span style={{ display: 'block', fontSize: '12px', color: '#64748b', marginTop: '1px' }}>Raised by {t.raised_by_name || 'Unknown'}</span>
                {workedMsByTicket[t.id] != null && (
                  <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', fontWeight: 700, color: '#0d9488', background: '#f0fdfa', padding: '2px 8px', borderRadius: '20px' }}>
                    ⏱ {formatDuration(workedMsByTicket[t.id])} worked
                  </span>
                )}
              </div>

              {/* Before / After comparison -- the whole point of this page is
                  deciding whether the completed work is good enough to
                  archive, so the reported issue and the completion evidence
                  need to sit side by side, not just whichever photo happened
                  to exist. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ background: '#fff', border: '1px solid #e9d5ff', borderRadius: '10px', padding: '10px' }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before — reported issue</p>
                  {t.photo_url ? (
                    <img src={t.photo_url} alt="Reported issue" style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '8px', marginBottom: '6px' }} />
                  ) : (
                    <div style={{ width: '100%', height: '140px', borderRadius: '8px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No photo</span>
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>{t.description || t.issue_tag || 'No description recorded.'}</p>
                </div>

                <div style={{ background: '#fff', border: '1px solid #e9d5ff', borderRadius: '10px', padding: '10px' }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>After — completed work</p>
                  {t.completion_photo_url ? (
                    <img src={t.completion_photo_url} alt="Completed work" style={{ width: '100%', height: '140px', objectFit: 'cover', borderRadius: '8px', marginBottom: '6px' }} />
                  ) : (
                    <div style={{ width: '100%', height: '140px', borderRadius: '8px', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '6px' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No photo</span>
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>{t.completion_note || 'No completion note recorded.'}</p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  onClick={() => openArchiveConfirm(t)}
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
            <p style={modalTitleStyle}>Reopen Ticket #{reopenModalTicket.ticket_number}</p>
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

      {/* Archive confirmation modal */}
      {archiveConfirmTicket && (
        <div style={modalOverlayStyle} onClick={closeArchiveConfirm}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <p style={modalTitleStyle}>Verify &amp; Archive Ticket #{archiveConfirmTicket.ticket_number}?</p>
            <p style={modalSubtitleStyle}>{archiveConfirmTicket.property?.address}</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b' }}>
              This confirms the work is verified and closes the ticket for good. This can't be undone from here — a closed ticket can only be reopened separately.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeArchiveConfirm} disabled={archiveConfirming} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={confirmArchive}
                disabled={archiveConfirming}
                style={{ ...modalConfirmBtnStyle, background: '#16a34a', opacity: archiveConfirming ? 0.6 : 1, cursor: archiveConfirming ? 'not-allowed' : 'pointer' }}
              >
                {archiveConfirming ? 'Archiving...' : '✓ Verify & Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
