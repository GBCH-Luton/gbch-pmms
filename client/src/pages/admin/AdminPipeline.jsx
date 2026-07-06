import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import BuilderProfileModal from './BuilderProfileModal'
import {
  CATEGORIES, priorityTierLabel, priorityBadgeStyle, statusColour, formatUKDate, formatUKDateTime,
  filterSelectStyle, thStyle, tdStyle, actionBtnStyle,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle, modalLabelStyle,
  modalTextareaStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle, radioRowStyle,
  roleBadgeStyle, postSystemComment, postAuditEvent, fetchAssignableBuilders, STAFF_AVAILABILITY_STYLES,
  createNotification,
} from './shared'

const expandLabelStyle = { margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em' }
const expandValueStyle = { margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: '#0f172a' }
const expandSectionStyle = { background: '#fff', borderRadius: '12px', padding: '16px', border: '1px solid #e2e8f0' }
const expandSectionTitleStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }

export default function AdminPipeline({ profile, onTicketsChanged, initialStatusFilter, initialPriorityFilter, onInitialFilterConsumed }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTicketId, setExpandedTicketId] = useState(null)
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')
  const [builders, setBuilders] = useState([])
  const [properties, setProperties] = useState([])

  const [statusFilter, setStatusFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [builderFilter, setBuilderFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')

  const [reassignModalTicket, setReassignModalTicket] = useState(null)
  const [reassignBuilderId, setReassignBuilderId] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [reassignError, setReassignError] = useState('')

  const [cancelModalTicket, setCancelModalTicket] = useState(null)
  const [cancelType, setCancelType] = useState('Mistake / not a real fault')
  const [cancelReason, setCancelReason] = useState('')
  const [cancelDuplicateRef, setCancelDuplicateRef] = useState('')
  const [cancelError, setCancelError] = useState('')

  const [priorityModalTicket, setPriorityModalTicket] = useState(null)
  const [priorityTier, setPriorityTier] = useState('')
  const [priorityReason, setPriorityReason] = useState('')
  const [priorityError, setPriorityError] = useState('')

  const [historyModalTicket, setHistoryModalTicket] = useState(null)
  const [historyEvents, setHistoryEvents] = useState([])

  const [commentsModalTicket, setCommentsModalTicket] = useState(null)
  const [comments, setComments] = useState([])
  const [newCommentText, setNewCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [commentPosting, setCommentPosting] = useState(false)

  const [builderProfileId, setBuilderProfileId] = useState(null)

  useEffect(() => {
    fetchTickets()
    fetchBuilders()
    fetchProperties()
    if (initialStatusFilter) setStatusFilter(initialStatusFilter)
    if (initialPriorityFilter) setPriorityFilter(initialPriorityFilter)
    if (initialStatusFilter || initialPriorityFilter) onInitialFilterConsumed?.()
  }, [])

  useEffect(() => {
    if (reassignModalTicket) {
      setReassignBuilderId(reassignModalTicket.assigned_builder_id || '')
      setReassignReason('')
      setReassignError('')
    }
  }, [reassignModalTicket])

  useEffect(() => {
    if (priorityModalTicket) {
      setPriorityTier(priorityModalTicket.priority_override || priorityTierLabel(priorityModalTicket.priority_score))
      setPriorityReason('')
      setPriorityError('')
    }
  }, [priorityModalTicket])

  useEffect(() => {
    if (cancelModalTicket) {
      setCancelType('Mistake / not a real fault')
      setCancelReason('')
      setCancelDuplicateRef('')
      setCancelError('')
    }
  }, [cancelModalTicket])

  async function fetchTickets() {
    const { data: ticketsData, error: ticketsError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, status, category, description, room, priority_score, priority_override, mileage_logged,
        no_access_flag, no_access_note, hold_reason, hold_note, completion_note, photo_url, completion_photo_url,
        completed_at, created_at, assigned_builder_id, property_id,
        property:properties!property_id(address)
      `)
      .order('created_at', { ascending: false })

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name')

    if (!ticketsError && !staffError) {
      const merged = ticketsData.map(t => ({
        ...t,
        builderName: staffData.find(s => s.id === t.assigned_builder_id)?.name,
      }))
      setTickets(merged)
    }
    setLoading(false)
    onTicketsChanged?.()
  }

  async function fetchBuilders() {
    setBuilders(await fetchAssignableBuilders())
  }

  async function fetchProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address')
      .order('address')

    if (!error) setProperties(data)
  }

  function openReassignModal(ticket) { setReassignModalTicket(ticket) }
  function closeReassignModal() { setReassignModalTicket(null) }

  async function submitReassign() {
    if (!reassignBuilderId) { setReassignError('Please select a builder.'); return }
    if (!reassignReason.trim()) { setReassignError('Please enter a reason.'); return }

    const t = reassignModalTicket
    const promoteToAssigned = t.status === 'Pending'
    const fromName = t.builderName || 'Unassigned'
    const toName = builders.find(b => b.id === reassignBuilderId)?.name || reassignBuilderId

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        assigned_builder_id: reassignBuilderId,
        ...(promoteToAssigned ? { status: 'Assigned' } : {}),
      })
      .eq('id', t.id)

    if (error) { setReassignError(error.message); return }

    const statusNote = promoteToAssigned ? ` Status: ${t.status} → Assigned.` : ''
    await postSystemComment(t.id, profile, `Reassigned from ${fromName} to ${toName}. Reason: ${reassignReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Reassigned', `Reassigned from ${fromName} to ${toName}.${statusNote} Reason: ${reassignReason.trim()}`)
    await createNotification(reassignBuilderId, t.id, `You've been assigned Job #${t.id} at ${t.property?.address || 'a property'}.`)
    await fetchTickets()
    closeReassignModal()
  }

  function openCancelModal(ticket) { setCancelModalTicket(ticket) }
  function closeCancelModal() { setCancelModalTicket(null) }

  async function submitCancel() {
    if (!cancelReason.trim()) { setCancelError('Please enter a reason.'); return }

    const t = cancelModalTicket
    const dupRef = cancelDuplicateRef.trim()

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        status: 'Cancelled',
        cancel_type: cancelType,
        cancel_reason: cancelReason.trim(),
        cancel_duplicate_ref: (cancelType === 'Duplicate' && dupRef) ? dupRef : null,
      })
      .eq('id', t.id)

    if (error) { setCancelError(error.message); return }

    const dupNote = (cancelType === 'Duplicate' && dupRef) ? ` (duplicate of #${dupRef})` : ''
    await postSystemComment(t.id, profile, `Ticket cancelled — ${cancelType}${dupNote}. Reason: ${cancelReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Status Changed', `${t.status} → Cancelled (${cancelType}${dupNote}). Reason: ${cancelReason.trim()}`)
    await fetchTickets()
    closeCancelModal()
  }

  function openPriorityModal(ticket) { setPriorityModalTicket(ticket) }
  function closePriorityOverrideModal() { setPriorityModalTicket(null) }

  async function submitPriorityOverride() {
    if (!priorityTier) { setPriorityError('Please select a priority tier.'); return }
    if (!priorityReason.trim()) { setPriorityError('Please enter a reason.'); return }

    const t = priorityModalTicket

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ priority_override: priorityTier })
      .eq('id', t.id)

    if (error) { setPriorityError(error.message); return }

    await postSystemComment(t.id, profile, `Priority manually set to ${priorityTier}. Reason: ${priorityReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Priority Override', `Priority manually set to ${priorityTier}. Reason: ${priorityReason.trim()}`)
    await fetchTickets()
    closePriorityOverrideModal()
  }

  async function openHistoryModal(ticket) {
    setHistoryModalTicket(ticket)
    setHistoryEvents([])
    const { data, error } = await supabase
      .schema('pmms')
      .from('audit_events')
      .select('id, action, summary, actor_name, created_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: false })

    if (!error) setHistoryEvents(data)
  }
  function closeHistoryModal() { setHistoryModalTicket(null) }

  async function openCommentsModal(ticket) {
    setCommentsModalTicket(ticket)
    setNewCommentText('')
    setCommentError('')
    await fetchComments(ticket.id)
  }
  function closeCommentsModal() { setCommentsModalTicket(null) }

  async function fetchComments(ticketId) {
    const { data, error } = await supabase
      .schema('pmms')
      .from('comments')
      .select('id, body, author_name, role, created_at')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })

    if (!error) setComments(data)
  }

  async function submitNewComment() {
    if (!newCommentText.trim()) return

    setCommentPosting(true)
    setCommentError('')

    const { error } = await supabase
      .schema('pmms')
      .from('comments')
      .insert({
        ticket_id: commentsModalTicket.id,
        author_id: profile.id,
        author_name: profile.name,
        role: profile.role,
        body: newCommentText.trim(),
      })

    setCommentPosting(false)

    if (error) { setCommentError(error.message); return }

    const trimmed = newCommentText.trim()
    const preview = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed
    await postAuditEvent(commentsModalTicket.id, profile, 'Status Changed', `Comment added: "${preview}"`)

    setNewCommentText('')
    await fetchComments(commentsModalTicket.id)
  }

  function effectiveTier(t) {
    return t.priority_override || priorityTierLabel(t.priority_score)
  }

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false
    if (propertyFilter !== 'All' && t.property_id !== propertyFilter) return false
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
    if (builderFilter !== 'All' && t.assigned_builder_id !== builderFilter) return false
    if (priorityFilter !== 'All' && effectiveTier(t) !== priorityFilter) return false
    return true
  })

  function sortValue(t, column) {
    switch (column) {
      case 'property': return (t.property?.address || '').toLowerCase()
      case 'room': return (t.room || '').toLowerCase()
      case 'priority': return t.priority_score || 0
      case 'status': return (t.status || '').toLowerCase()
      case 'logDate': return new Date(t.created_at).getTime()
      default: return ''
    }
  }

  function toggleSort(column) {
    if (sortColumn === column) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  function sortArrow(column) {
    if (sortColumn !== column) return ''
    return sortDirection === 'asc' ? ' ▲' : ' ▼'
  }

  const sortedTickets = sortColumn
    ? [...filteredTickets].sort((a, b) => {
        const va = sortValue(a, sortColumn)
        const vb = sortValue(b, sortColumn)
        if (va < vb) return sortDirection === 'asc' ? -1 : 1
        if (va > vb) return sortDirection === 'asc' ? 1 : -1
        return 0
      })
    : filteredTickets

  function clearFilters() {
    setStatusFilter('All')
    setPropertyFilter('All')
    setCategoryFilter('All')
    setBuilderFilter('All')
    setPriorityFilter('All')
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading tickets...</p>
    </div>
  )

  return (
    <div>

      {/* Pipeline filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Statuses</option>
          <option value="Assigned">Assigned</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed</option>
          <option value="Archived">Archived</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <select value={propertyFilter} onChange={(e) => setPropertyFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Properties</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.address}</option>
          ))}
        </select>
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={builderFilter} onChange={(e) => setBuilderFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Builders</option>
          {builders.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Priorities</option>
          <option value="P1 Critical">P1 Critical</option>
          <option value="P2 Urgent">P2 Urgent</option>
          <option value="P3 Routine">P3 Routine</option>
        </select>
        <button onClick={clearFilters} style={{ padding: '8px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Clear filters
        </button>
      </div>

      {/* Pipeline table */}
      <div style={{ background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('property')}>Property{sortArrow('property')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('room')}>Area{sortArrow('room')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('priority')}>Priority{sortArrow('priority')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('logDate')}>Log Date{sortArrow('logDate')}</th>
                <th style={{ ...thStyle, width: '32px' }} />
              </tr>
            </thead>
            <tbody>
              {sortedTickets.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>
                    No tickets match these filters.
                  </td>
                </tr>
              )}
              {sortedTickets.map(t => {
                const tier = effectiveTier(t)
                const tierStyle = priorityBadgeStyle(tier)
                const isCompliance = (t.description || '').startsWith('[Compliance Failure:')
                const isExpanded = expandedTicketId === t.id
                return (
                  <Fragment key={t.id}>
                    <tr
                      onClick={() => setExpandedTicketId(isExpanded ? null : t.id)}
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid #f1f5f9', cursor: 'pointer',
                        background: isExpanded ? '#fef2f2' : undefined,
                        boxShadow: isExpanded ? 'inset 4px 0 0 #dc2626' : undefined,
                      }}
                    >
                      <td style={tdStyle}>
                        <span style={{ display: 'block', fontWeight: 700, color: '#0f172a' }}>
                          {t.property?.address}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: '#475569' }}>{t.room || '—'}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 800, color: tierStyle.color, background: tierStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>
                          {tier}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: 'inline-block', fontSize: '11px', fontWeight: 700, color: statusColour(t.status),
                            background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px',
                            ...(t.status === 'In Progress' ? { animation: 'pulse 1.6s ease-in-out infinite' } : {}),
                          }}
                        >
                          {t.status}
                        </span>
                        {t.status === 'On Hold' && t.hold_reason && (
                          <span style={{ display: 'block', fontSize: '10px', color: '#d97706', fontWeight: 700, marginTop: '3px' }}>{t.hold_reason}</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: '#475569' }}>{formatUKDate(t.created_at)}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: '#94a3b8', fontWeight: 700 }}>
                        {isExpanded ? '▲' : '▼'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: '2px solid #dc2626' }}>
                        <td colSpan={6} style={{ padding: 0, background: '#fef2f2', boxShadow: 'inset 4px 0 0 #dc2626' }}>
                          <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Ticket Details</p>
                              <p style={expandLabelStyle}>Ticket</p>
                              <p style={expandValueStyle}>#{t.id} — {t.category}</p>

                              {isCompliance && (
                                <span style={{ display: 'inline-block', fontSize: '9px', fontWeight: 800, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 6px', borderRadius: '20px', marginBottom: '8px' }}>
                                  COMPLIANCE FAILURE
                                </span>
                              )}

                              <p style={expandLabelStyle}>Area</p>
                              <p style={expandValueStyle}>{t.room || '—'}</p>

                              <p style={expandLabelStyle}>Issue</p>
                              <p style={{ ...expandValueStyle, marginBottom: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{t.description}</p>
                            </div>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Photos &amp; Videos</p>
                              {(t.photo_url || t.completion_photo_url) ? (
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                  {t.photo_url && (
                                    <a href={t.photo_url} target="_blank" rel="noreferrer">
                                      <p style={expandLabelStyle}>Reported Photo</p>
                                      <img src={t.photo_url} alt="Reported fault" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0' }} />
                                    </a>
                                  )}
                                  {t.completion_photo_url && (
                                    <a href={t.completion_photo_url} target="_blank" rel="noreferrer">
                                      <p style={expandLabelStyle}>Completion Photo</p>
                                      <img src={t.completion_photo_url} alt="Completed job" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px', border: '1px solid #e2e8f0' }} />
                                    </a>
                                  )}
                                </div>
                              ) : (
                                <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No photos or videos attached</p>
                              )}
                            </div>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Assignment &amp; Priority</p>
                              <p style={expandLabelStyle}>Assigned Builder</p>
                              {t.assigned_builder_id ? (
                                <p style={{ ...expandValueStyle, color: '#1d4ed8', cursor: 'pointer' }} onClick={() => setBuilderProfileId(t.assigned_builder_id)}>
                                  {t.builderName || 'Unknown'}
                                </p>
                              ) : (
                                <p style={expandValueStyle}>Unassigned</p>
                              )}

                              <p style={expandLabelStyle}>Priority Score</p>
                              <p style={expandValueStyle}>{t.priority_score} pts</p>

                              {t.mileage_logged != null && (
                                <>
                                  <p style={expandLabelStyle}>Mileage Logged</p>
                                  <p style={expandValueStyle}>{t.mileage_logged}</p>
                                </>
                              )}

                              <p style={expandLabelStyle}>Raised</p>
                              <p style={{ ...expandValueStyle, marginBottom: t.status === 'Completed' ? 10 : 0 }}>{formatUKDateTime(t.created_at)}</p>

                              {t.status === 'Completed' && (
                                <>
                                  <p style={expandLabelStyle}>Completed</p>
                                  <p style={{ ...expandValueStyle, marginBottom: 0 }}>{formatUKDateTime(t.completed_at)}</p>
                                </>
                              )}
                            </div>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Notes &amp; Flags</p>
                              {!t.no_access_flag && !(t.status === 'On Hold' && t.hold_reason) && !t.completion_note && (
                                <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No notes on this ticket</p>
                              )}

                              {t.no_access_flag && (
                                <div style={{ padding: '8px 10px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: '#c2410c' }}>No Access</p>
                                  {t.no_access_note && <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#7c2d12' }}>{t.no_access_note}</p>}
                                </div>
                              )}

                              {t.status === 'On Hold' && t.hold_reason && (
                                <div style={{ padding: '8px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: '#d97706' }}>On Hold — {t.hold_reason}</p>
                                  {t.hold_note && <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#92400e' }}>{t.hold_note}</p>}
                                </div>
                              )}

                              {t.completion_note && (
                                <div style={{ padding: '8px 10px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: '#16a34a' }}>Completion Note</p>
                                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#166534' }}>{t.completion_note}</p>
                                </div>
                              )}
                            </div>

                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button onClick={() => openCommentsModal(t)} style={actionBtnStyle}>Comments</button>
                              <button onClick={() => openHistoryModal(t)} style={actionBtnStyle}>History</button>
                              <button onClick={() => openPriorityModal(t)} style={actionBtnStyle}>Priority</button>
                              {t.status !== 'Cancelled' && (
                                <button onClick={() => openCancelModal(t)} style={{ ...actionBtnStyle, color: '#dc2626', borderColor: '#fecaca' }}>Cancel</button>
                              )}
                              <button onClick={() => openReassignModal(t)} style={{ ...actionBtnStyle, background: '#1d4ed8', color: '#fff', borderColor: '#1d4ed8' }}>Reassign</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reassign modal */}
      {reassignModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Reassign Ticket #{reassignModalTicket.id}</p>
            <p style={modalSubtitleStyle}>{reassignModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Builder</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {builders.map(b => {
                const isUnavailable = b.availability !== 'Available'
                return (
                <label key={b.id} style={{ ...radioRowStyle(reassignBuilderId === b.id), opacity: isUnavailable ? 0.55 : 1 }}>
                  <input
                    type="radio"
                    name="reassign-builder"
                    checked={reassignBuilderId === b.id}
                    onChange={() => setReassignBuilderId(b.id)}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: isUnavailable ? '#64748b' : '#0f172a' }}>
                    {b.name}
                    {isUnavailable && (
                      <span style={{ fontSize: '10px', fontWeight: 800, color: STAFF_AVAILABILITY_STYLES[b.availability]?.color, background: STAFF_AVAILABILITY_STYLES[b.availability]?.bg, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                        {b.availability}{b.availabilityNote ? ` — ${b.availabilityNote}` : ''}
                      </span>
                    )}
                  </span>
                </label>
                )
              })}
            </div>

            <label style={modalLabelStyle}>Reason (required)</label>
            <textarea
              value={reassignReason}
              onChange={(e) => setReassignReason(e.target.value)}
              rows={2}
              placeholder="e.g. Closer to site, has the right skillset..."
              style={modalTextareaStyle}
            />

            {reassignError && <p style={modalErrorStyle}>{reassignError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeReassignModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitReassign} style={modalConfirmBtnStyle}>Reassign</button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel ticket modal */}
      {cancelModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Cancel Ticket #{cancelModalTicket.id}</p>
            <p style={modalSubtitleStyle}>{cancelModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Cancellation Type</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={radioRowStyle(cancelType === 'Mistake / not a real fault')}>
                <input
                  type="radio"
                  name="cancel-type"
                  checked={cancelType === 'Mistake / not a real fault'}
                  onChange={() => setCancelType('Mistake / not a real fault')}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Mistake / not a real fault</span>
              </label>
              <label style={radioRowStyle(cancelType === 'Duplicate')}>
                <input
                  type="radio"
                  name="cancel-type"
                  checked={cancelType === 'Duplicate'}
                  onChange={() => setCancelType('Duplicate')}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>Duplicate ticket</span>
              </label>
            </div>

            {cancelType === 'Duplicate' && (
              <>
                <label style={modalLabelStyle}>Duplicate of ticket # (optional)</label>
                <input
                  type="text"
                  value={cancelDuplicateRef}
                  onChange={(e) => setCancelDuplicateRef(e.target.value)}
                  placeholder="e.g. 1001"
                  style={modalTextareaStyle}
                />
              </>
            )}

            <label style={modalLabelStyle}>Reason (required)</label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={2}
              placeholder="e.g. Resident misidentified the issue, no fault found..."
              style={modalTextareaStyle}
            />

            {cancelError && <p style={modalErrorStyle}>{cancelError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeCancelModal} style={modalCancelBtnStyle}>Keep Ticket</button>
              <button onClick={submitCancel} style={{ ...modalConfirmBtnStyle, background: '#dc2626' }}>Confirm Cancellation</button>
            </div>
          </div>
        </div>
      )}

      {/* Priority override modal */}
      {priorityModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Set Priority — Ticket #{priorityModalTicket.id}</p>
            <p style={modalSubtitleStyle}>{priorityModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Priority Tier</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {['P1 Critical', 'P2 Urgent', 'P3 Routine'].map(tierOption => (
                <label key={tierOption} style={radioRowStyle(priorityTier === tierOption)}>
                  <input
                    type="radio"
                    name="priority-tier"
                    checked={priorityTier === tierOption}
                    onChange={() => setPriorityTier(tierOption)}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{tierOption}</span>
                </label>
              ))}
            </div>

            <label style={modalLabelStyle}>Reason (required)</label>
            <textarea
              value={priorityReason}
              onChange={(e) => setPriorityReason(e.target.value)}
              rows={2}
              placeholder="e.g. Resident is medically vulnerable and cannot use other bathrooms..."
              style={modalTextareaStyle}
            />

            {priorityError && <p style={modalErrorStyle}>{priorityError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closePriorityOverrideModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitPriorityOverride} style={modalConfirmBtnStyle}>Set Priority</button>
            </div>
          </div>
        </div>
      )}

      {/* Ticket history modal — chronological log of status changes */}
      {historyModalTicket && (
        <div style={modalOverlayStyle} onClick={closeHistoryModal}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={modalTitleStyle}>History — Ticket #{historyModalTicket.id}</p>
                <p style={modalSubtitleStyle}>{historyModalTicket.property?.address}</p>
              </div>
              <button onClick={closeHistoryModal} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {historyEvents.length === 0 && (
                <p style={{ fontSize: '13px', color: '#94a3b8' }}>No status changes recorded for this ticket yet.</p>
              )}
              {historyEvents.map(e => (
                <div key={e.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#1d4ed8', background: '#eff6ff', padding: '2px 8px', borderRadius: '20px' }}>{e.action}</span>
                    <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatUKDateTime(e.created_at)}</span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: '#475569' }}>{e.summary}</p>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>by {e.actor_name}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: '16px' }}>
              <button onClick={closeHistoryModal} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Comments modal */}
      {commentsModalTicket && (
        <div style={modalOverlayStyle} onClick={closeCommentsModal}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <p style={modalTitleStyle}>Comments — Ticket #{commentsModalTicket.id}</p>
                <p style={modalSubtitleStyle}>{commentsModalTicket.property?.address}</p>
              </div>
              <button onClick={closeCommentsModal} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <p style={{ margin: '16px 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments ({comments.length})</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
              {comments.length === 0 && (
                <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>No comments yet. Start the conversation about this job.</p>
              )}
              {comments.map(c => {
                const badge = roleBadgeStyle(c.role)
                return (
                  <div key={c.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{c.author_name}</span>
                        {c.role && (
                          <span style={{ fontSize: '10px', fontWeight: 800, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase' }}>{c.role}</span>
                        )}
                      </div>
                      <span style={{ fontSize: '11px', color: '#94a3b8', whiteSpace: 'nowrap' }}>{formatUKDateTime(c.created_at)}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: '#475569' }}>{c.body}</p>
                  </div>
                )
              })}
            </div>

            <textarea
              value={newCommentText}
              onChange={(e) => setNewCommentText(e.target.value)}
              rows={2}
              placeholder="Add a comment…"
              style={{ ...modalTextareaStyle, marginTop: '12px' }}
            />

            {commentError && <p style={modalErrorStyle}>{commentError}</p>}

            <button
              onClick={submitNewComment}
              disabled={commentPosting || !newCommentText.trim()}
              style={{
                ...modalConfirmBtnStyle, width: '100%', marginTop: '12px',
                opacity: (commentPosting || !newCommentText.trim()) ? 0.6 : 1,
                cursor: (commentPosting || !newCommentText.trim()) ? 'not-allowed' : 'pointer',
              }}
            >
              {commentPosting ? 'Posting...' : 'Post comment'}
            </button>
          </div>
        </div>
      )}

      <BuilderProfileModal builderId={builderProfileId} onClose={() => setBuilderProfileId(null)} />

    </div>
  )
}
