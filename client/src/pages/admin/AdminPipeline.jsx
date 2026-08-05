import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import BuilderProfileModal from './BuilderProfileModal'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import { fetchAllMaintenanceCategoryNames } from '../../lib/maintenanceCategories'
import { fetchDivisions } from '../../lib/divisions'
import PrintableTicketReport from '../../components/PrintableTicketReport'
import AttachmentMedia from '../../components/AttachmentMedia'
import {
  priorityTierLabel, priorityBadgeStyle, statusColour, statusLabel, formatUKDate, formatUKDateTime, formatDurationDays, formatDuration,
  filterSelectStyle, thStyle, tdStyle, actionBtnStyle,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle, modalLabelStyle,
  modalTextareaStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle, radioRowStyle,
  roleBadgeStyle, postSystemComment, postAuditEvent, fetchAssignableBuilders, fetchAssignableStaffForDivision, fetchAssignableStaffForCategory, STAFF_AVAILABILITY_STYLES,
  createNotification, sendPushNotification, pushEmergencyAlert, resolveCategoryDivision, isTicketStuck, KpiTiles, fetchPriorityThresholds,
  EVENTS_FEATURE_ENABLED,
} from './shared'

const expandLabelStyle = { margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.04em' }
const expandValueStyle = { margin: '0 0 10px 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }
const expandSectionStyle = { background: COLORS.white, borderRadius: '12px', padding: '16px', border: `1px solid ${COLORS.slate200}` }
const expandSectionTitleStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 800, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.05em' }

export default function AdminPipeline({ profile, onTicketsChanged, initialStatusFilter, initialPriorityFilter, initialStuckFilter, onInitialFilterConsumed }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTicketId, setExpandedTicketId] = useState(null)
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc')
  const [builders, setBuilders] = useState([])
  const [properties, setProperties] = useState([])
  const [categoryOptions, setCategoryOptions] = useState([])
  // Who can be reassigned THIS ticket, scoped to its category's division --
  // e.g. a Housekeeping ticket offers Housekeepers here, not Builders.
  // Deliberately separate from `builders` above, which stays the flat
  // Builder-only list used by the page's own "Builder" filter dropdown.
  const [reassignOptions, setReassignOptions] = useState([])

  const [statusFilter, setStatusFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('') // '' = All Properties -- PropertySearchSelect's own "cleared" state
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [builderFilter, setBuilderFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [ticketNumberSearch, setTicketNumberSearch] = useState('')
  const [stuckOnlyFilter, setStuckOnlyFilter] = useState(false)
  const [stuckThresholds, setStuckThresholds] = useState(null)
  // Division filter/print-export additions -- default 'All'/'' (not a
  // 30-day default like AdminReports.jsx) since Pipeline is a live
  // day-to-day view where old Pending/On-Hold tickets still need to stay
  // visible unless a manager deliberately narrows the range.
  const [divisionOptions, setDivisionOptions] = useState([])
  const [divisionFilter, setDivisionFilter] = useState('All')
  const [categoriesSettingsRow, setCategoriesSettingsRow] = useState(null)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const [reportSectionOpen, setReportSectionOpen] = useState(false)
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)

  const [reassignModalTicket, setReassignModalTicket] = useState(null)
  const [reassignBuilderId, setReassignBuilderId] = useState('')
  const [reassignReason, setReassignReason] = useState('')
  const [reassignError, setReassignError] = useState('')
  const [reassignSendPush, setReassignSendPush] = useState(false)

  // Bulk reassign -- selection persists across filter/sort changes, same
  // as ordinary multi-select table behaviour, so switching a filter never
  // silently drops something the manager already picked.
  const [selectedTicketIds, setSelectedTicketIds] = useState(() => new Set())
  const [bulkReassignOpen, setBulkReassignOpen] = useState(false)
  const [bulkReassignOptions, setBulkReassignOptions] = useState([])
  const [bulkReassignBuilderId, setBulkReassignBuilderId] = useState('')
  const [bulkReassignReason, setBulkReassignReason] = useState('')
  const [bulkReassignError, setBulkReassignError] = useState('')
  const [bulkReassignSubmitting, setBulkReassignSubmitting] = useState(false)
  const [bulkReassignSummary, setBulkReassignSummary] = useState(null)
  const [bulkReassignSendPush, setBulkReassignSendPush] = useState(false)

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

  const [addToEventModalTicket, setAddToEventModalTicket] = useState(null)
  const [openEventOptions, setOpenEventOptions] = useState([])
  const [selectedEventIdForTicket, setSelectedEventIdForTicket] = useState('')
  const [addToEventError, setAddToEventError] = useState('')
  const [addToEventSubmitting, setAddToEventSubmitting] = useState(false)

  const [builderProfileId, setBuilderProfileId] = useState(null)

  useEffect(() => {
    fetchTickets()
    fetchBuilders()
    fetchProperties()
    fetchStuckThresholds()
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchAllMaintenanceCategoryNames(profile.division).then(setCategoryOptions)
    fetchDivisions().then(setDivisionOptions)
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'maintenance_categories').maybeSingle()
      .then(({ data }) => setCategoriesSettingsRow(data))
    if (initialStatusFilter) setStatusFilter(initialStatusFilter)
    if (initialPriorityFilter) setPriorityFilter(initialPriorityFilter)
    if (initialStuckFilter) setStuckOnlyFilter(true)
    if (initialStatusFilter || initialPriorityFilter || initialStuckFilter) onInitialFilterConsumed?.()
  }, [])

  async function fetchStuckThresholds() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'stuck_ticket_thresholds')
      .maybeSingle()
    if (data?.setting_value) setStuckThresholds(data.setting_value)
  }

  useEffect(() => {
    if (reassignModalTicket) {
      setReassignBuilderId(reassignModalTicket.assigned_builder_id || '')
      setReassignReason('')
      setReassignError('')
      setReassignOptions([])
      fetchAssignableStaffForCategory(reassignModalTicket.category).then(setReassignOptions)
    }
  }, [reassignModalTicket])

  // Eligible builders for a bulk reassign = the intersection across every
  // distinct category among the selected tickets (a builder must be
  // assignable for ALL of them, not just one) -- decided this way over
  // restricting selection to one category at a time, since the real use
  // case (clearing someone's whole workload before leave) often spans
  // categories.
  useEffect(() => {
    if (bulkReassignOpen) {
      setBulkReassignBuilderId('')
      setBulkReassignReason('')
      setBulkReassignError('')
      setBulkReassignSummary(null)
      setBulkReassignOptions([])

      const selected = tickets.filter(t => selectedTicketIds.has(t.id))
      const distinctCategories = [...new Set(selected.map(t => t.category))]

      Promise.all(distinctCategories.map(cat => fetchAssignableStaffForCategory(cat))).then(lists => {
        if (lists.length === 0) { setBulkReassignOptions([]); return }
        const [first, ...rest] = lists
        const intersected = first.filter(b => rest.every(list => list.some(x => x.id === b.id)))
        setBulkReassignOptions(intersected)
      })
    }
  }, [bulkReassignOpen])

  useEffect(() => {
    if (priorityModalTicket) {
      setPriorityTier(priorityModalTicket.priority_override || priorityTierLabel(priorityModalTicket.priority_score, p1Threshold, p2Threshold))
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
        id, ticket_number, status, category, description, room, priority_score, priority_override, mileage_logged,
        no_access_flag, no_access_note, hold_reason, hold_note, completion_note, photo_url, completion_photo_url,
        completed_at, created_at, status_changed_at, first_assigned_at, assigned_builder_id, property_id, event_id
      `)
      .order('created_at', { ascending: false })

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
    }
    setLoading(false)
    onTicketsChanged?.()
  }

  async function fetchBuilders() {
    setBuilders(await (profile.division ? fetchAssignableStaffForDivision(profile.division) : fetchAssignableBuilders()))
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
  function closeReassignModal() { setReassignModalTicket(null); setReassignSendPush(false) }

  async function submitReassign() {
    if (!reassignBuilderId) { setReassignError('Please select a builder.'); return }
    if (!reassignReason.trim()) { setReassignError('Please enter a reason.'); return }

    const t = reassignModalTicket
    const promoteToAssigned = t.status === 'Pending'
    const fromName = t.builderName || 'Unassigned'
    const toName = reassignOptions.find(b => b.id === reassignBuilderId)?.name || reassignBuilderId

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        assigned_builder_id: reassignBuilderId,
        ...(promoteToAssigned ? { status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null, first_assigned_at: new Date().toISOString() } : {}),
      })
      .eq('id', t.id)

    if (error) { setReassignError(error.message); return }

    const statusNote = promoteToAssigned ? ` Status: ${statusLabel(t.status)} → Assigned.` : ''
    await postSystemComment(t.id, profile, `Reassigned from ${fromName} to ${toName}. Reason: ${reassignReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Reassigned', `Reassigned from ${fromName} to ${toName}.${statusNote} Reason: ${reassignReason.trim()}`)
    await createNotification(reassignBuilderId, t.id, `You've been assigned Job #${t.ticket_number} at ${t.property?.address || 'a property'}.`)
    if (reassignSendPush) {
      await sendPushNotification([reassignBuilderId], 'New job assigned', `Job #${t.ticket_number} at ${t.property?.address || 'a property'}.`)
    }
    await fetchTickets()
    closeReassignModal()
  }

  // Any manager can add a ticket to an existing Event, regardless of
  // division -- the Event itself is meant to coordinate across
  // divisions (e.g. a landlord inspection touches both Housekeeping and
  // Maintenance). Only lists OPEN events (not every linked ticket
  // already in a terminal status) -- same computed-completion logic as
  // AdminEvents.jsx, kept in sync by definition since both read the same
  // ticket rows rather than a stored flag.
  async function openAddToEventModal(ticket) {
    setAddToEventModalTicket(ticket)
    setSelectedEventIdForTicket(ticket.event_id || '')
    setAddToEventError('')

    const { data: eventRows } = await supabase.schema('pmms').from('events').select('id, title')
    const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, event_id, status')

    const terminal = ['Completed', 'Archived', 'Cancelled']
    const open = (eventRows || []).filter(e => {
      const linked = (ticketRows || []).filter(t => t.event_id === e.id)
      return linked.length === 0 || !linked.every(t => terminal.includes(t.status))
    })
    setOpenEventOptions(open)
  }

  function closeAddToEventModal() { setAddToEventModalTicket(null) }

  async function submitAddToEvent() {
    if (!selectedEventIdForTicket) { setAddToEventError('Please select an Event.'); return }

    setAddToEventSubmitting(true)
    setAddToEventError('')

    const t = addToEventModalTicket
    const eventTitle = openEventOptions.find(e => e.id === selectedEventIdForTicket)?.title || 'an Event'

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ event_id: selectedEventIdForTicket })
      .eq('id', t.id)

    setAddToEventSubmitting(false)

    if (error) { setAddToEventError(error.message); return }

    await postAuditEvent(t.id, profile, 'Added to Event', `Added to "${eventTitle}" by ${profile.name}.`)
    await fetchTickets()
    closeAddToEventModal()
  }

  function openBulkReassignModal() { setBulkReassignOpen(true) }
  function closeBulkReassignModal() { setBulkReassignOpen(false); setBulkReassignSendPush(false) }

  // Same four steps submitReassign does for one ticket, repeated per
  // selected ticket. Sequential rather than Promise.all -- bulk batches
  // are small (a handful to a dozen tickets) so there's no real
  // performance need, and it keeps failure handling simple to reason
  // about. Each ticket's update is independent (no shared transaction),
  // so one failure doesn't abort the rest -- failures are collected and
  // reported afterward instead of silently swallowed.
  async function submitBulkReassign() {
    if (!bulkReassignBuilderId) { setBulkReassignError('Please select a builder.'); return }
    if (!bulkReassignReason.trim()) { setBulkReassignError('Please enter a reason.'); return }

    setBulkReassignSubmitting(true)
    setBulkReassignError('')

    const targetTickets = tickets.filter(t => selectedTicketIds.has(t.id))
    const toName = bulkReassignOptions.find(b => b.id === bulkReassignBuilderId)?.name || bulkReassignBuilderId
    const reasonText = bulkReassignReason.trim()

    const failures = []
    let successCount = 0

    for (const t of targetTickets) {
      const promoteToAssigned = t.status === 'Pending'
      const fromName = t.builderName || 'Unassigned'

      const { error } = await supabase
        .schema('pmms')
        .from('tickets')
        .update({
          assigned_builder_id: bulkReassignBuilderId,
          ...(promoteToAssigned ? { status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null, first_assigned_at: new Date().toISOString() } : {}),
        })
        .eq('id', t.id)

      if (error) {
        failures.push({ ticket: t, message: error.message })
        continue
      }

      const statusNote = promoteToAssigned ? ` Status: ${statusLabel(t.status)} → Assigned.` : ''
      await postSystemComment(t.id, profile, `Reassigned from ${fromName} to ${toName}. Reason: ${reasonText}`)
      await postAuditEvent(t.id, profile, 'Reassigned', `Reassigned from ${fromName} to ${toName}.${statusNote} Reason: ${reasonText}`)
      await createNotification(bulkReassignBuilderId, t.id, `You've been assigned Job #${t.ticket_number} at ${t.property?.address || 'a property'}.`)
      successCount += 1
    }

    if (bulkReassignSendPush && successCount > 0) {
      await sendPushNotification([bulkReassignBuilderId], 'New jobs assigned', `You've been assigned ${successCount} job${successCount === 1 ? '' : 's'}.`)
    }

    setBulkReassignSubmitting(false)
    await fetchTickets()

    if (failures.length === 0) {
      setSelectedTicketIds(new Set())
      closeBulkReassignModal()
    } else {
      setBulkReassignSummary({ successCount, failures })
    }
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
        status_changed_at: new Date().toISOString(),
        stuck_alert_sent_at: null,
        cancel_type: cancelType,
        cancel_reason: cancelReason.trim(),
        cancel_duplicate_ref: (cancelType === 'Duplicate' && dupRef) ? dupRef : null,
      })
      .eq('id', t.id)

    if (error) { setCancelError(error.message); return }

    const dupNote = (cancelType === 'Duplicate' && dupRef) ? ` (duplicate of #${dupRef})` : ''
    await postSystemComment(t.id, profile, `Ticket cancelled — ${cancelType}${dupNote}. Reason: ${cancelReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Status Changed', `${statusLabel(t.status)} → Cancelled (${cancelType}${dupNote}). Reason: ${cancelReason.trim()}`)
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

    if (priorityTier === 'P1 Critical') {
      const { data: categoriesRow } = await supabase
        .schema('pmms')
        .from('settings')
        .select('setting_value')
        .eq('setting_key', 'maintenance_categories')
        .maybeSingle()
      await pushEmergencyAlert(t, resolveCategoryDivision(t.category, categoriesRow))
    }

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
    return t.priority_override || priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)
  }

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
    if (divisionFilter !== 'All' && resolveCategoryDivision(t.category, categoriesSettingsRow) !== divisionFilter) return false
    if (builderFilter !== 'All' && t.assigned_builder_id !== builderFilter) return false
    if (priorityFilter !== 'All' && effectiveTier(t) !== priorityFilter) return false
    if (ticketNumberSearch.trim() && !String(t.ticket_number).includes(ticketNumberSearch.trim())) return false
    if (stuckOnlyFilter && !isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)) return false
    if (fromDate && new Date(t.created_at).getTime() < new Date(fromDate).getTime()) return false
    if (toDate && new Date(t.created_at).getTime() > new Date(toDate).getTime() + 86400000 - 1) return false
    return true
  })

  function sortValue(t, column) {
    switch (column) {
      case 'ticketNumber': return t.ticket_number || 0
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
    setPropertyFilter('')
    setCategoryFilter('All')
    setDivisionFilter('All')
    setBuilderFilter('All')
    setPriorityFilter('All')
    setTicketNumberSearch('')
    setStuckOnlyFilter(false)
    setFromDate('')
    setToDate('')
  }

  // Mirrors the dashboard's "Ticket Pipeline" tiles exactly -- counts are
  // always off the full ticket list, never the currently filtered view,
  // so every tile stays a stable shortcut to that category regardless of
  // whatever filter combination happens to be applied right now.
  const kpis = [
    { label: 'Total tickets', value: tickets.length, colour: COLORS.slate500, statusFilter: 'All' },
    { label: 'Unassigned', value: tickets.filter(t => t.status === 'Pending').length, colour: COLORS.red600, statusFilter: 'Pending' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, colour: COLORS.teal600, statusFilter: 'In Progress' },
    { label: 'On Hold', value: tickets.filter(t => t.status === 'On Hold').length, colour: COLORS.amber500, statusFilter: 'On Hold' },
    { label: 'Completed', value: tickets.filter(t => t.status === 'Completed').length, colour: COLORS.green600, statusFilter: 'Completed' },
    { label: 'P1 Critical', value: tickets.filter(t => effectiveTier(t) === 'P1 Critical').length, colour: COLORS.red600, statusFilter: 'All', priorityFilter: 'P1 Critical' },
    { label: 'Stuck', value: tickets.filter(t => isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)).length, colour: COLORS.red600, statusFilter: 'All', stuckOnly: true },
  ]

  // Clicking a tile is a "jump to this category" shortcut, same as
  // arriving fresh from the dashboard -- resets every other filter first
  // so the result always matches the tile's count exactly.
  function applyKpiFilter(kpi) {
    clearFilters()
    setStatusFilter(kpi.statusFilter || 'All')
    if (kpi.priorityFilter) setPriorityFilter(kpi.priorityFilter)
    if (kpi.stuckOnly) setStuckOnlyFilter(true)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading tickets...</p>
    </div>
  )

  return (
    <div>

      <KpiTiles kpis={kpis} onTileClick={applyKpiFilter} />

      {/* Pipeline filters -- the day-to-day triage filters a manager uses
          constantly stay in their own row; Division/date range/export are a
          distinct "generate a report" action, not something reached for on
          every visit, so they get their own labeled section below rather
          than being crammed into the same row. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Statuses</option>
          <option value="Pending">Unassigned</option>
          <option value="Assigned">Assigned</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed</option>
          <option value="Archived">Archived</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        <div style={{ width: '220px' }}>
          <PropertySearchSelect properties={properties} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
        </div>
        <input
          type="text"
          value={ticketNumberSearch}
          onChange={(e) => setTicketNumberSearch(e.target.value)}
          placeholder="Search ticket #..."
          style={{ ...filterSelectStyle, width: '150px' }}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Categories</option>
          {categoryOptions.map(c => (
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
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px', border: `1px solid ${COLORS.amber200}`, background: COLORS.amber50, color: COLORS.amber800, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          <input type="checkbox" checked={stuckOnlyFilter} onChange={(e) => setStuckOnlyFilter(e.target.checked)} />
          ⚠ Stuck only
        </label>
        <button onClick={clearFilters} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Clear filters
        </button>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={() => setReportSectionOpen(prev => !prev)}
          style={{
            display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            padding: '10px 16px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px',
            cursor: 'pointer', fontSize: '11px', fontWeight: 800, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.05em',
          }}
        >
          <span>📋 Generate a report</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate400, textTransform: 'none', letterSpacing: 0 }}>
            {reportSectionOpen ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>
        {reportSectionOpen && (
          <div style={{
            display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end',
            marginTop: '8px', padding: '12px 16px', borderRadius: '12px',
            border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50,
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, marginBottom: '4px' }}>Division</label>
              <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} style={filterSelectStyle}>
                <option value="All">All Divisions</option>
                {divisionOptions.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, marginBottom: '4px' }}>Raised from</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={filterSelectStyle} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, marginBottom: '4px' }}>Raised to</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={filterSelectStyle} />
            </div>
            <button onClick={() => setReportOpen(true)} style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: COLORS.slate900, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              🖨️ Print / Export
            </button>
          </div>
        )}
      </div>

      {reportOpen && (
        <PrintableTicketReport
          tickets={filteredTickets}
          categoriesSettingsRow={categoriesSettingsRow}
          divisionLabel={divisionFilter === 'All' ? 'All Divisions' : divisionFilter}
          fromDate={fromDate}
          toDate={toDate}
          onClose={() => setReportOpen(false)}
        />
      )}

      {selectedTicketIds.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: COLORS.blue50, border: `1px solid ${COLORS.blue200}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.blue700 }}>{selectedTicketIds.size} ticket{selectedTicketIds.size === 1 ? '' : 's'} selected</span>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <button onClick={openBulkReassignModal} style={{ padding: '8px 16px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
              Bulk Reassign
            </button>
            <button
              onClick={() => setSelectedTicketIds(new Set())}
              style={{ background: 'none', border: 'none', color: COLORS.blue700, fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {/* Pipeline table */}
      <div style={{ background: COLORS.white, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
                <th style={{ ...thStyle, width: '32px' }}>
                  <input
                    type="checkbox"
                    checked={sortedTickets.length > 0 && sortedTickets.every(t => selectedTicketIds.has(t.id))}
                    onChange={(e) => {
                      setSelectedTicketIds(prev => {
                        const next = new Set(prev)
                        if (e.target.checked) sortedTickets.forEach(t => next.add(t.id))
                        else sortedTickets.forEach(t => next.delete(t.id))
                        return next
                      })
                    }}
                  />
                </th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('ticketNumber')}>Ticket #{sortArrow('ticketNumber')}</th>
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
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: COLORS.slate400, fontWeight: 600 }}>
                    No tickets match these filters.
                  </td>
                </tr>
              )}
              {sortedTickets.map(t => {
                const tier = effectiveTier(t)
                const tierStyle = priorityBadgeStyle(tier)
                const isCompliance = (t.description || '').startsWith('[Compliance Failure:')
                const isExpanded = expandedTicketId === t.id
                const isSelected = selectedTicketIds.has(t.id)
                const stuck = isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)
                return (
                  <Fragment key={t.id}>
                    <tr
                      onClick={() => setExpandedTicketId(isExpanded ? null : t.id)}
                      style={{
                        borderBottom: isExpanded ? 'none' : `1px solid ${COLORS.slate100}`, cursor: 'pointer',
                        background: isExpanded ? COLORS.red50 : isSelected ? COLORS.blue50 : stuck ? COLORS.amber50 : undefined,
                        boxShadow: isExpanded ? `inset 4px 0 0 ${COLORS.red600}` : stuck ? `inset 4px 0 0 ${COLORS.amber600}` : undefined,
                      }}
                    >
                      <td style={tdStyle} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            setSelectedTicketIds(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(t.id)
                              else next.delete(t.id)
                              return next
                            })
                          }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: COLORS.slate600, fontWeight: 600 }}>{t.ticket_number}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ display: 'block', fontWeight: 700, color: COLORS.slate900 }}>
                          {t.property?.address}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: COLORS.slate600 }}>{t.room || '—'}</span>
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
                          {statusLabel(t.status)}
                        </span>
                        {t.status === 'On Hold' && t.hold_reason && (
                          <span style={{ display: 'block', fontSize: '10px', color: COLORS.amber600, fontWeight: 700, marginTop: '3px' }}>{t.hold_reason}</span>
                        )}
                        {stuck && (
                          <span style={{ display: 'block', fontSize: '10px', color: COLORS.amber700, fontWeight: 800, marginTop: '3px' }}>
                            ⚠ Stuck {formatDurationDays(Date.now() - new Date(t.status_changed_at || t.created_at).getTime())}
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <span style={{ color: COLORS.slate600 }}>{formatUKDate(t.created_at)}</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'center', color: COLORS.slate400, fontWeight: 700 }}>
                        {isExpanded ? '▲' : '▼'}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: `2px solid ${COLORS.red600}` }}>
                        <td colSpan={8} style={{ padding: 0, background: COLORS.red50, boxShadow: `inset 4px 0 0 ${COLORS.red600}` }}>
                          <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Ticket Details</p>
                              <p style={expandLabelStyle}>Ticket</p>
                              <p style={expandValueStyle}>#{t.ticket_number} — {t.category}</p>

                              {isCompliance && (
                                <span style={{ display: 'inline-block', fontSize: '9px', fontWeight: 800, color: COLORS.orange700, background: COLORS.orange50, border: `1px solid ${COLORS.orange200}`, padding: '2px 6px', borderRadius: '20px', marginBottom: '8px' }}>
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
                                    <div>
                                      <p style={expandLabelStyle}>Reported Photo</p>
                                      <AttachmentMedia url={t.photo_url} alt="Reported fault" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px', border: `1px solid ${COLORS.slate200}` }} />
                                    </div>
                                  )}
                                  {t.completion_photo_url && (
                                    <div>
                                      <p style={expandLabelStyle}>Completion Photo</p>
                                      <AttachmentMedia url={t.completion_photo_url} alt="Completed job" style={{ width: '140px', height: '140px', objectFit: 'cover', borderRadius: '10px', border: `1px solid ${COLORS.slate200}` }} />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <p style={{ fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', margin: 0 }}>No photos or videos attached</p>
                              )}
                            </div>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Assignment &amp; Priority</p>
                              <p style={expandLabelStyle}>Assigned Builder</p>
                              {t.assigned_builder_id ? (
                                <p style={{ ...expandValueStyle, color: COLORS.blue700, cursor: 'pointer' }} onClick={() => setBuilderProfileId(t.assigned_builder_id)}>
                                  {t.builderName || 'Unknown'}
                                </p>
                              ) : (
                                <p style={expandValueStyle}>Unassigned</p>
                              )}

                              <p style={expandLabelStyle}>Priority Score</p>
                              <p style={expandValueStyle}>{t.priority_score} pts</p>

                              <p style={expandLabelStyle}>Time to Assignment</p>
                              <p style={expandValueStyle}>
                                {t.first_assigned_at ? formatDuration(new Date(t.first_assigned_at) - new Date(t.created_at)) : 'Not yet assigned'}
                              </p>

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
                                <p style={{ fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', margin: 0 }}>No notes on this ticket</p>
                              )}

                              {t.no_access_flag && (
                                <div style={{ padding: '8px 10px', background: COLORS.orange50, border: `1px solid ${COLORS.orange200}`, borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.orange700 }}>No Access</p>
                                  {t.no_access_note && <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.orange900 }}>{t.no_access_note}</p>}
                                </div>
                              )}

                              {t.status === 'On Hold' && t.hold_reason && (
                                <div style={{ padding: '8px 10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber200}`, borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.amber600 }}>On Hold — {t.hold_reason}</p>
                                  {t.hold_note && <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.amber800 }}>{t.hold_note}</p>}
                                </div>
                              )}

                              {t.completion_note && (
                                <div style={{ padding: '8px 10px', background: COLORS.green50, border: `1px solid ${COLORS.green200}`, borderRadius: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.green600 }}>Completion Note</p>
                                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.green800 }}>{t.completion_note}</p>
                                </div>
                              )}
                            </div>

                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button onClick={() => openCommentsModal(t)} style={actionBtnStyle}>Comments</button>
                              <button onClick={() => openHistoryModal(t)} style={actionBtnStyle}>History</button>
                              <button onClick={() => openPriorityModal(t)} style={actionBtnStyle}>Priority</button>
                              {EVENTS_FEATURE_ENABLED && (
                                <button onClick={() => openAddToEventModal(t)} style={actionBtnStyle}>{t.event_id ? 'Change Event' : 'Add to Event'}</button>
                              )}
                              {t.status !== 'Cancelled' && (
                                <button onClick={() => openCancelModal(t)} style={{ ...actionBtnStyle, color: COLORS.red600, borderColor: COLORS.red200 }}>Cancel</button>
                              )}
                              <button onClick={() => openReassignModal(t)} style={{ ...actionBtnStyle, background: COLORS.blue700, color: COLORS.white, borderColor: COLORS.blue700 }}>Reassign</button>
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
            <p style={modalTitleStyle}>Reassign Ticket #{reassignModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{reassignModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Builder</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reassignOptions.length === 0 && (
                <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No one is assignable to this category yet.</p>
              )}
              {reassignOptions.map(b => {
                const isUnavailable = b.availability !== 'Available'
                return (
                <label key={b.id} style={{ ...radioRowStyle(reassignBuilderId === b.id), opacity: isUnavailable ? 0.55 : 1 }}>
                  <input
                    type="radio"
                    name="reassign-builder"
                    checked={reassignBuilderId === b.id}
                    onChange={() => setReassignBuilderId(b.id)}
                  />
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: isUnavailable ? COLORS.slate500 : COLORS.slate900 }}>
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

            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 0 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, cursor: 'pointer' }}>
              <input type="checkbox" checked={reassignSendPush} onChange={(e) => setReassignSendPush(e.target.checked)} />
              Also send a push notification
            </label>

            {reassignError && <p style={modalErrorStyle}>{reassignError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeReassignModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitReassign} style={modalConfirmBtnStyle}>Reassign</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk reassign modal */}
      {bulkReassignOpen && (() => {
        const targetTickets = tickets.filter(t => selectedTicketIds.has(t.id))
        const distinctCategories = [...new Set(targetTickets.map(t => t.category))]
        return (
          <div style={modalOverlayStyle}>
            <div style={modalCardStyle}>
              <p style={modalTitleStyle}>Reassign {targetTickets.length} Ticket{targetTickets.length === 1 ? '' : 's'}</p>
              <p style={modalSubtitleStyle}>{distinctCategories.join(', ')}</p>

              {bulkReassignSummary ? (
                <>
                  <p style={{ margin: '14px 0 0 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>
                    Reassigned {bulkReassignSummary.successCount} of {targetTickets.length} ticket{targetTickets.length === 1 ? '' : 's'}.
                  </p>
                  <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {bulkReassignSummary.failures.map(f => (
                      <p key={f.ticket.id} style={{ margin: 0, fontSize: '12px', color: COLORS.red600 }}>
                        Job #{f.ticket.ticket_number} failed: {f.message}
                      </p>
                    ))}
                  </div>
                  <div style={{ marginTop: '16px' }}>
                    <button
                      onClick={() => {
                        // Keep only the failures selected -- succeeded
                        // tickets are done, and this leaves the failed
                        // ones ready for an easy retry.
                        setSelectedTicketIds(new Set(bulkReassignSummary.failures.map(f => f.ticket.id)))
                        closeBulkReassignModal()
                      }}
                      style={{ ...modalConfirmBtnStyle, width: '100%' }}
                    >
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label style={modalLabelStyle}>Builder</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {bulkReassignOptions.length === 0 && (
                      <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>
                        No one is assignable to every selected ticket's category — try narrowing your selection.
                      </p>
                    )}
                    {bulkReassignOptions.map(b => {
                      const isUnavailable = b.availability !== 'Available'
                      return (
                        <label key={b.id} style={{ ...radioRowStyle(bulkReassignBuilderId === b.id), opacity: isUnavailable ? 0.55 : 1 }}>
                          <input
                            type="radio"
                            name="bulk-reassign-builder"
                            checked={bulkReassignBuilderId === b.id}
                            onChange={() => setBulkReassignBuilderId(b.id)}
                          />
                          <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: isUnavailable ? COLORS.slate500 : COLORS.slate900 }}>
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
                    value={bulkReassignReason}
                    onChange={(e) => setBulkReassignReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Closer to site, has the right skillset..."
                    style={modalTextareaStyle}
                  />

                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 0 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, cursor: 'pointer' }}>
                    <input type="checkbox" checked={bulkReassignSendPush} onChange={(e) => setBulkReassignSendPush(e.target.checked)} />
                    Also send a push notification
                  </label>

                  {bulkReassignError && <p style={modalErrorStyle}>{bulkReassignError}</p>}

                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                    <button onClick={closeBulkReassignModal} disabled={bulkReassignSubmitting} style={modalCancelBtnStyle}>Cancel</button>
                    <button
                      onClick={submitBulkReassign}
                      disabled={bulkReassignSubmitting}
                      style={{ ...modalConfirmBtnStyle, opacity: bulkReassignSubmitting ? 0.6 : 1, cursor: bulkReassignSubmitting ? 'not-allowed' : 'pointer' }}
                    >
                      {bulkReassignSubmitting ? 'Reassigning...' : `Reassign All ${targetTickets.length}`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}

      {/* Cancel ticket modal */}
      {cancelModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Cancel Ticket #{cancelModalTicket.ticket_number}</p>
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
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>Mistake / not a real fault</span>
              </label>
              <label style={radioRowStyle(cancelType === 'Duplicate')}>
                <input
                  type="radio"
                  name="cancel-type"
                  checked={cancelType === 'Duplicate'}
                  onChange={() => setCancelType('Duplicate')}
                />
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>Duplicate ticket</span>
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
              <button onClick={submitCancel} style={{ ...modalConfirmBtnStyle, background: COLORS.red600 }}>Confirm Cancellation</button>
            </div>
          </div>
        </div>
      )}

      {/* Priority override modal */}
      {priorityModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Set Priority — Ticket #{priorityModalTicket.ticket_number}</p>
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
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{tierOption}</span>
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

      {/* Add to Event modal -- any manager, regardless of division, can
          link this ticket to an existing open Event (see AdminEvents.jsx) */}
      {addToEventModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Add to Event — Ticket #{addToEventModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{addToEventModalTicket.property?.address}</p>

            {openEventOptions.length === 0 ? (
              <p style={{ margin: '16px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>
                No open Events yet -- create one from the Events page first.
              </p>
            ) : (
              <>
                <label style={modalLabelStyle}>Event</label>
                <select
                  value={selectedEventIdForTicket}
                  onChange={(e) => setSelectedEventIdForTicket(e.target.value)}
                  style={filterSelectStyle}
                >
                  <option value="">Select an Event...</option>
                  {openEventOptions.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
              </>
            )}

            {addToEventError && <p style={modalErrorStyle}>{addToEventError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeAddToEventModal} style={modalCancelBtnStyle}>Cancel</button>
              {openEventOptions.length > 0 && (
                <button onClick={submitAddToEvent} disabled={addToEventSubmitting} style={{ ...modalConfirmBtnStyle, opacity: addToEventSubmitting ? 0.6 : 1, cursor: addToEventSubmitting ? 'not-allowed' : 'pointer' }}>
                  {addToEventSubmitting ? 'Saving...' : 'Save'}
                </button>
              )}
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
                <p style={modalTitleStyle}>History — Ticket #{historyModalTicket.ticket_number}</p>
                <p style={modalSubtitleStyle}>{historyModalTicket.property?.address}</p>
              </div>
              <button onClick={closeHistoryModal} style={{ background: 'none', border: 'none', fontSize: '20px', color: COLORS.slate400, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {historyEvents.length === 0 && (
                <p style={{ fontSize: '13px', color: COLORS.slate400 }}>No status changes recorded for this ticket yet.</p>
              )}
              {historyEvents.map(e => (
                <div key={e.id} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 800, color: COLORS.blue700, background: COLORS.blue50, padding: '2px 8px', borderRadius: '20px' }}>{e.action}</span>
                    <span style={{ fontSize: '11px', color: COLORS.slate400, whiteSpace: 'nowrap' }}>{formatUKDateTime(e.created_at)}</span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', color: COLORS.slate600 }}>{e.summary}</p>
                  <span style={{ fontSize: '11px', color: COLORS.slate400 }}>by {e.actor_name}</span>
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
                <p style={modalTitleStyle}>Comments — Ticket #{commentsModalTicket.ticket_number}</p>
                <p style={modalSubtitleStyle}>{commentsModalTicket.property?.address}</p>
              </div>
              <button onClick={closeCommentsModal} style={{ background: 'none', border: 'none', fontSize: '20px', color: COLORS.slate400, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            <p style={{ margin: '16px 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments ({comments.length})</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '320px', overflowY: 'auto' }}>
              {comments.length === 0 && (
                <p style={{ fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>No comments yet. Start the conversation about this job.</p>
              )}
              {comments.map(c => {
                const badge = roleBadgeStyle(c.role)
                return (
                  <div key={c.id} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '10px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>{c.author_name}</span>
                        {c.role && (
                          <span style={{ fontSize: '10px', fontWeight: 800, color: badge.color, background: badge.bg, padding: '2px 8px', borderRadius: '20px', textTransform: 'uppercase' }}>{c.role}</span>
                        )}
                      </div>
                      <span style={{ fontSize: '11px', color: COLORS.slate400, whiteSpace: 'nowrap' }}>{formatUKDateTime(c.created_at)}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600 }}>{c.body}</p>
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
