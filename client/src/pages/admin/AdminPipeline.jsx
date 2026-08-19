import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import BuilderProfileModal from './BuilderProfileModal'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import { fetchAllMaintenanceCategoryNames } from '../../lib/maintenanceCategories'
import { fetchDivisions } from '../../lib/divisions'
import PrintableTicketReport from '../../components/PrintableTicketReport'
import TicketAttachmentGallery from '../../components/TicketAttachmentGallery'
import PhotoLightbox from '../../components/PhotoLightbox'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'
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

// An unlisted-category issue_tag is stored as a plain string, e.g.
// "[Unlisted: Plumbing] burst pipe under the sink" (see
// unlistedTagFor/handleSubmit in SubmitterDashboard.jsx and
// AdminRaiseTicket.jsx) -- flagged in amber/bold so it's obvious at a
// glance this ticket didn't match a real catalogued subcategory, without
// needing to open the row to find out.
const UNLISTED_TAG_PATTERN = /^(\[Unlisted:[^\]]*\])\s*(.*)$/
function renderIssueTag(tag) {
  if (!tag) return '—'
  const match = tag.match(UNLISTED_TAG_PATTERN)
  if (!match) return tag
  const [, bracket, rest] = match
  return (
    <>
      <span style={{ color: COLORS.amber700, fontWeight: 800 }}>{bracket}</span>
      {rest ? ` ${rest}` : ''}
    </>
  )
}

// No human raised these -- check-office-cleaning-due (the 08:30 weekday
// cron) inserts them directly with no raised_by/raised_by_name at all
// (see scripts/add_office_cleaning_cron.sql), so they'd otherwise show
// the same "Unknown" a genuinely missing raiser would -- misleading,
// since there's nothing actually wrong with these, they just don't have
// a person behind them. Matched on the exact category/issue_tag/
// assign_type combination that function writes, not just "no raiser",
// so a real ticket with a missing raiser for some other reason still
// correctly reads "Unknown".
function raisedByLabel(t) {
  if (t.raised_by_name) return t.raised_by_name
  if (t.category === 'Cleaning Rota' && t.issue_tag === 'Office Daily Clean' && t.assign_type === 'Auto') return 'Daily Cleaning Rota'
  return 'Unknown'
}

// Actual hands-on-the-job time, not wall-clock turnaround -- same
// work_sessions-summed definition as the Clocking page's "Total Time"
// column and Sign-Off's workedMsByTicket, so this always matches what a
// manager finds on either of those. Fetches for itself only when its
// ticket's row is actually expanded, rather than bloating the main
// ticket list query with a join every Pipeline load never needed.
function TicketWorkedTime({ ticketId }) {
  const [workedMs, setWorkedMs] = useState(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .schema('pmms')
      .from('work_sessions')
      .select('started_at, ended_at')
      .eq('ticket_id', ticketId)
      .not('ended_at', 'is', null)
      .then(({ data }) => {
        if (cancelled) return
        const totalMs = (data || []).reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0)
        setWorkedMs(totalMs)
      })
    return () => { cancelled = true }
  }, [ticketId])

  if (workedMs === null) return <p style={expandValueStyle}>Loading…</p>
  if (workedMs === 0) return <p style={expandValueStyle}>No clocked time recorded</p>
  return <p style={expandValueStyle}>{formatDuration(workedMs)}</p>
}

export default function AdminPipeline({
  profile, onTicketsChanged, initialStatusFilter, initialPriorityFilter, initialStuckFilter, initialNeedsFollowupFilter, initialTicketNumberSearch,
  initialCategoryFilter, initialDivisionFilter, initialBuilderFilter, initialPropertyFilter, initialFromDate, initialToDate,
  onInitialFilterConsumed,
}) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedTicketId, setExpandedTicketId] = useState(null)
  // Receipts (see add_activity_receipts_table.sql) -- keyed by ticket_id
  // since a materials trip is only ever attached to whichever job was in
  // progress when the builder left, if any. The section itself is closed
  // by default per ticket (a Set of ticket ids that have been expanded),
  // separate from expandedTicketId (the row itself) so re-expanding a row
  // doesn't lose which receipts sections were already open.
  const [receiptsByTicketId, setReceiptsByTicketId] = useState({})
  const [expandedReceiptTicketIds, setExpandedReceiptTicketIds] = useState(() => new Set())
  const [receiptLightbox, setReceiptLightbox] = useState(null) // { urls, index } | null
  // Materials Used (see add_ticket_materials_used_table.sql) -- what a
  // job actually consumed, logged at completion. Same "closed by default,
  // only shown at all when non-empty" pattern as Receipts above, but kept
  // as its own Set/map rather than reusing the receipts one -- a ticket
  // can have either, both, or neither, and each should remember its own
  // expanded state independently.
  const [materialsUsedByTicketId, setMaterialsUsedByTicketId] = useState({})
  const [expandedMaterialsTicketIds, setExpandedMaterialsTicketIds] = useState(() => new Set())
  // Captured into local state at mount rather than re-read from the prop
  // later -- the parent (AdminDashboard.jsx) nulls the prop out as soon as
  // onInitialFilterConsumed fires, which happens before tickets have even
  // loaded, so there'd be nothing left to match against once fetchTickets
  // resolves if this only ever read the prop directly.
  const [pendingExpandTicketNumber, setPendingExpandTicketNumber] = useState(null)
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
  const [assignTypeFilter, setAssignTypeFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('') // '' = All Properties -- PropertySearchSelect's own "cleared" state
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [builderFilter, setBuilderFilter] = useState('All')
  // Options derived straight from the loaded tickets (unique raised_by
  // ids, sorted by name) rather than a separate staff fetch -- "who's
  // ever raised a ticket" isn't one role/division, it's Admin, Manager,
  // Builder, and Ticket Submitter alike.
  const [submitterFilter, setSubmitterFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [ticketNumberSearch, setTicketNumberSearch] = useState('')
  const [stuckOnlyFilter, setStuckOnlyFilter] = useState(false)
  const [needsFollowupFilter, setNeedsFollowupFilter] = useState(false)
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
  const [reassignEstimatedMinutes, setReassignEstimatedMinutes] = useState('')
  const [reassignError, setReassignError] = useState('')
  const [reassignSendPush, setReassignSendPush] = useState(false)
  const [reassignIgnoreSkills, setReassignIgnoreSkills] = useState(false)

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
  const [bulkReassignIgnoreSkills, setBulkReassignIgnoreSkills] = useState(false)

  const [cancelModalTicket, setCancelModalTicket] = useState(null)
  const [cancelType, setCancelType] = useState('Mistake / not a real fault')
  const [cancelReason, setCancelReason] = useState('')
  const [cancelDuplicateRef, setCancelDuplicateRef] = useState('')
  const [cancelError, setCancelError] = useState('')

  // For jobs done by an external contractor with no PMMS login -- the
  // normal Complete button only exists inside the assigned builder's own
  // locked job view, so there was previously no way to close these out at
  // all. Photo is optional here (unlike the builder's own completion flow,
  // which requires one) since a manager acting on a contractor's behalf
  // often won't have one to upload.
  const [completeModalTicket, setCompleteModalTicket] = useState(null)
  const [completeNote, setCompleteNote] = useState('')
  const [completePhotoFile, setCompletePhotoFile] = useState(null)
  const [completePhotoPreview, setCompletePhotoPreview] = useState(null)
  const [completeError, setCompleteError] = useState('')
  const [completeSubmitting, setCompleteSubmitting] = useState(false)

  const [priorityModalTicket, setPriorityModalTicket] = useState(null)
  const [priorityTier, setPriorityTier] = useState('')
  const [priorityReason, setPriorityReason] = useState('')
  const [priorityError, setPriorityError] = useState('')

  // Separate from the Reassign modal on purpose -- correcting an estimate
  // on a ticket that's already correctly assigned (most commonly one the
  // Cleaners Rota cron auto-created) shouldn't require picking a builder
  // again and writing a reassignment reason for a no-op reassignment.
  const [editEstimateModalTicket, setEditEstimateModalTicket] = useState(null)
  const [editEstimateValue, setEditEstimateValue] = useState('')
  const [editEstimateError, setEditEstimateError] = useState('')
  const [editEstimateSaving, setEditEstimateSaving] = useState(false)

  // Same reasoning as editEstimateModalTicket above -- correcting mileage
  // a builder forgot (or mis-typed) shouldn't require a full reassign.
  const [editMileageModalTicket, setEditMileageModalTicket] = useState(null)
  const [editMileageValue, setEditMileageValue] = useState('')
  const [editMileageError, setEditMileageError] = useState('')
  const [editMileageSaving, setEditMileageSaving] = useState(false)

  // Lets a manager overturn the builder's own "this needs a follow-up
  // visit" flag from the completion form -- e.g. it was ticked in error,
  // or the follow-up has since been dealt with and the flag/note is stale.
  const [editFollowupModalTicket, setEditFollowupModalTicket] = useState(null)
  const [editFollowupNeeded, setEditFollowupNeeded] = useState(false)
  const [editFollowupNote, setEditFollowupNote] = useState('')
  const [editFollowupError, setEditFollowupError] = useState('')
  const [editFollowupSaving, setEditFollowupSaving] = useState(false)

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
    if (initialNeedsFollowupFilter) setNeedsFollowupFilter(true)
    if (initialTicketNumberSearch) {
      setTicketNumberSearch(String(initialTicketNumberSearch))
      setPendingExpandTicketNumber(initialTicketNumberSearch)
    }
    if (initialCategoryFilter) setCategoryFilter(initialCategoryFilter)
    if (initialDivisionFilter) setDivisionFilter(initialDivisionFilter)
    if (initialBuilderFilter) setBuilderFilter(initialBuilderFilter)
    if (initialPropertyFilter) setPropertyFilter(initialPropertyFilter)
    if (initialFromDate) setFromDate(initialFromDate)
    if (initialToDate) setToDate(initialToDate)
    if (
      initialStatusFilter || initialPriorityFilter || initialStuckFilter || initialNeedsFollowupFilter || initialTicketNumberSearch
      || initialCategoryFilter || initialDivisionFilter || initialBuilderFilter || initialPropertyFilter || initialFromDate || initialToDate
    ) onInitialFilterConsumed?.()
  }, [])

  // Runs once fetchTickets (triggered by the mount effect above) actually
  // resolves -- can't expand a row before its id is known.
  useEffect(() => {
    if (pendingExpandTicketNumber == null || tickets.length === 0) return
    const match = tickets.find(t => String(t.ticket_number) === String(pendingExpandTicketNumber))
    if (match) {
      setExpandedTicketId(match.id)
      // Row is in a filtered/sorted table that hasn't necessarily rendered
      // this row into the viewport yet -- wait a tick for that render, then
      // bring it into view so the highlight isn't buried off-screen among
      // whatever else is on the page.
      setTimeout(() => {
        document.getElementById(`ticket-row-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
    }
    setPendingExpandTicketNumber(null)
  }, [tickets, pendingExpandTicketNumber])

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
      setReassignEstimatedMinutes(reassignModalTicket.estimated_minutes != null ? String(reassignModalTicket.estimated_minutes) : '')
      setReassignError('')
      setReassignIgnoreSkills(false)
      setReassignOptions([])
      fetchAssignableStaffForCategory(reassignModalTicket.category).then(setReassignOptions)
    }
  }, [reassignModalTicket])

  // Separate from the modal-open effect above -- toggling "show all
  // builders" mid-modal should only refetch the option list, not wipe out
  // a reason the manager already started typing.
  useEffect(() => {
    if (!reassignModalTicket) return
    fetchAssignableStaffForCategory(reassignModalTicket.category, { ignoreSkills: reassignIgnoreSkills }).then(setReassignOptions)
  }, [reassignIgnoreSkills])

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
      setBulkReassignIgnoreSkills(false)
      setBulkReassignOptions([])
      fetchBulkReassignOptions(false)
    }
  }, [bulkReassignOpen])

  // Separate from the modal-open effect above -- toggling "show all
  // builders" mid-modal should only refetch the option list, not wipe out
  // a reason the manager already started typing.
  useEffect(() => {
    if (!bulkReassignOpen) return
    fetchBulkReassignOptions(bulkReassignIgnoreSkills)
  }, [bulkReassignIgnoreSkills])

  function fetchBulkReassignOptions(ignoreSkills) {
    const selected = tickets.filter(t => selectedTicketIds.has(t.id))
    const distinctCategories = [...new Set(selected.map(t => t.category))]

    Promise.all(distinctCategories.map(cat => fetchAssignableStaffForCategory(cat, { ignoreSkills }))).then(lists => {
      if (lists.length === 0) { setBulkReassignOptions([]); return }
      const [first, ...rest] = lists
      const intersected = first.filter(b => rest.every(list => list.some(x => x.id === b.id)))
      setBulkReassignOptions(intersected)
    })
  }

  useEffect(() => {
    if (editEstimateModalTicket) {
      setEditEstimateValue(editEstimateModalTicket.estimated_minutes != null ? String(editEstimateModalTicket.estimated_minutes) : '')
      setEditEstimateError('')
    }
  }, [editEstimateModalTicket])

  useEffect(() => {
    if (editMileageModalTicket) {
      setEditMileageValue(editMileageModalTicket.mileage_logged != null ? String(editMileageModalTicket.mileage_logged) : '')
      setEditMileageError('')
    }
  }, [editMileageModalTicket])

  useEffect(() => {
    if (editFollowupModalTicket) {
      setEditFollowupNeeded(!!editFollowupModalTicket.needs_followup)
      setEditFollowupNote(editFollowupModalTicket.followup_note || '')
      setEditFollowupError('')
    }
  }, [editFollowupModalTicket])

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
        id, ticket_number, status, category, issue_tag, description, room, priority_score, priority_override, mileage_logged,
        no_access_flag, no_access_note, hold_reason, hold_note, completion_note, photo_url, completion_photo_url,
        needs_followup, followup_note,
        signoff_flagged, signoff_note, signoff_resolved, signoff_good_standard, signoff_clean,
        completed_at, created_at, status_changed_at, first_assigned_at, assigned_builder_id, estimated_minutes, assign_type, property_id, event_id,
        raised_by, raised_by_name, cancel_type, cancel_reason, cancel_duplicate_ref
      `)
      .order('created_at', { ascending: false })

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name')

    // Grouped client-side into a ticket_id -> rows map, same "fetch once,
    // group locally" approach as staffData above -- the portfolio's total
    // receipt count is tiny, no reason to query this per-ticket.
    const { data: receiptsData } = await supabase
      .schema('pmms')
      .from('activity_receipts')
      .select('ticket_id, photo_url, amount, created_at')
      .not('ticket_id', 'is', null)
      .order('created_at', { ascending: true })
    const receiptsGrouped = {}
    ;(receiptsData || []).forEach(r => {
      if (!receiptsGrouped[r.ticket_id]) receiptsGrouped[r.ticket_id] = []
      receiptsGrouped[r.ticket_id].push(r)
    })
    setReceiptsByTicketId(receiptsGrouped)

    const { data: materialsUsedData } = await supabase
      .schema('pmms')
      .from('ticket_materials_used')
      .select('ticket_id, name, quantity, created_at')
      .order('created_at', { ascending: true })
    const materialsUsedGrouped = {}
    ;(materialsUsedData || []).forEach(m => {
      if (!materialsUsedGrouped[m.ticket_id]) materialsUsedGrouped[m.ticket_id] = []
      materialsUsedGrouped[m.ticket_id].push(m)
    })
    setMaterialsUsedByTicketId(materialsUsedGrouped)

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
    if (reassignEstimatedMinutes === '') { setReassignError('Please enter an estimated time for this job.'); return }

    const t = reassignModalTicket
    const promoteToAssigned = t.status === 'Pending'
    const fromName = t.builderName || 'Unassigned'
    const toName = reassignOptions.find(b => b.id === reassignBuilderId)?.name || reassignBuilderId

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        assigned_builder_id: reassignBuilderId,
        estimated_minutes: reassignEstimatedMinutes !== '' ? Number(reassignEstimatedMinutes) : null,
        // A manager choosing the builder here -- explicit, not just left at
        // its previous value, so taking over an auto-routed job (e.g. a
        // Cleaners Rota visit) correctly flips its Assign Type to Manual.
        assign_type: 'Manual',
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
          assign_type: 'Manual',
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

  function openCompleteModal(ticket) {
    setCompleteModalTicket(ticket)
    setCompleteNote('')
    setCompletePhotoFile(null)
    setCompletePhotoPreview(null)
    setCompleteError('')
  }
  function closeCompleteModal() {
    setCompleteModalTicket(null)
    if (completePhotoPreview) URL.revokeObjectURL(completePhotoPreview)
  }

  function handleCompletePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setCompletePhotoFile(file)
    setCompletePhotoPreview(URL.createObjectURL(file))
  }

  async function submitComplete() {
    if (!completeNote.trim()) { setCompleteError('Please describe the completed work.'); return }

    const t = completeModalTicket
    setCompleteSubmitting(true)
    setCompleteError('')

    let photoUrl = null
    if (completePhotoFile) {
      const compressed = await compressImage(completePhotoFile)
      const path = `${profile.id}/${Date.now()}-${compressed.name}`
      const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, compressed)
      if (uploadError) {
        setCompleteSubmitting(false)
        setCompleteError(`Photo upload failed: ${uploadError.message}`)
        return
      }
      photoUrl = await getSignedUrl('ticket-photos', path)
    }

    const now = new Date().toISOString()
    const previousStatus = t.status
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        status: 'Completed', status_changed_at: now, stuck_alert_sent_at: null, completed_at: now,
        completion_note: completeNote.trim(), ...(photoUrl ? { completion_photo_url: photoUrl } : {}),
      })
      .eq('id', t.id)

    if (error) {
      setCompleteSubmitting(false)
      setCompleteError(error.message)
      return
    }

    // Closes out any work_session left open under this ticket -- shouldn't
    // normally exist for an external job nobody ever clocked into, but
    // covers the case where an internal builder started it before handing
    // off to a contractor.
    await supabase.schema('pmms').from('work_sessions').update({ ended_at: now }).eq('ticket_id', t.id).is('ended_at', null)

    await postSystemComment(t.id, profile, `Marked Completed by ${profile.name} on behalf of the assignee (no PMMS access -- e.g. an external contractor). Note: ${completeNote.trim()}`)
    await postAuditEvent(t.id, profile, 'Status Changed', `${statusLabel(previousStatus)} → Completed (marked by ${profile.name} on behalf of the assignee)`)

    setCompleteSubmitting(false)
    await fetchTickets()
    closeCompleteModal()
  }

  function openEditEstimateModal(ticket) { setEditEstimateModalTicket(ticket) }
  function closeEditEstimateModal() { setEditEstimateModalTicket(null) }

  async function submitEditEstimate() {
    if (editEstimateValue === '') { setEditEstimateError('Please enter an estimated time.'); return }

    const t = editEstimateModalTicket
    const newMinutes = Number(editEstimateValue)

    setEditEstimateSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ estimated_minutes: newMinutes })
      .eq('id', t.id)
    setEditEstimateSaving(false)

    if (error) { setEditEstimateError(error.message); return }

    await postAuditEvent(t.id, profile, 'Estimate Updated', `Estimated time changed from ${t.estimated_minutes != null ? `${t.estimated_minutes}m` : 'not set'} to ${newMinutes}m.`)
    await fetchTickets()
    closeEditEstimateModal()
  }

  function openEditMileageModal(ticket) { setEditMileageModalTicket(ticket) }
  function closeEditMileageModal() { setEditMileageModalTicket(null) }

  async function submitEditMileage() {
    if (editMileageValue === '') { setEditMileageError('Please enter a mileage figure.'); return }

    const t = editMileageModalTicket
    const newMileage = Number(editMileageValue)

    setEditMileageSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ mileage_logged: newMileage })
      .eq('id', t.id)
    setEditMileageSaving(false)

    if (error) { setEditMileageError(error.message); return }

    await postAuditEvent(t.id, profile, 'Mileage Updated', `Mileage changed from ${t.mileage_logged ?? 0} to ${newMileage}.`)
    await fetchTickets()
    closeEditMileageModal()
  }

  function openEditFollowupModal(ticket) { setEditFollowupModalTicket(ticket) }
  function closeEditFollowupModal() { setEditFollowupModalTicket(null) }

  async function submitEditFollowup() {
    const t = editFollowupModalTicket
    const newNote = editFollowupNeeded ? (editFollowupNote.trim() || null) : null

    setEditFollowupSaving(true)
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ needs_followup: editFollowupNeeded, followup_note: newNote })
      .eq('id', t.id)
    setEditFollowupSaving(false)

    if (error) { setEditFollowupError(error.message); return }

    await postAuditEvent(t.id, profile, 'Follow-up Updated',
      editFollowupNeeded
        ? `Marked as needing follow-up.${newNote ? ` Note: ${newNote}` : ''}`
        : 'Follow-up flag cleared.')
    await fetchTickets()
    closeEditFollowupModal()
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
    // Cancelled tickets are a mistake/duplicate record, not active work --
    // hidden from the default "All" view so they don't clutter the list a
    // manager scans daily, but still fully visible by filtering Status to
    // Cancelled specifically (the option is still right there in the
    // dropdown), never actually removed from the data.
    if (statusFilter === 'All' && t.status === 'Cancelled') return false
    // Same treatment for Archived (signed-off, locked, done) -- same reason:
    // it's finished work, not something a manager scanning the default list
    // needs to see every day. Still reachable via Status > Archived, or via
    // CompletedAll (which deliberately includes it -- see below).
    if (statusFilter === 'All' && t.status === 'Archived') return false
    // Not a real ticket status -- a dropdown/KPI-tile value meaning
    // "Completed, whether or not it's since been signed off (Archived)",
    // so the Dashboard/Pipeline "Completed" tiles can count and link to
    // the same set of jobs instead of the tile undercounting anything
    // already signed off.
    if (statusFilter === 'CompletedAll' && t.status !== 'Completed' && t.status !== 'Archived') return false
    // Reports' "Currently Open" tile's exact definition (see AdminReports.jsx)
    // -- also a sentinel, not a real status.
    if (statusFilter === 'OpenAll' && (t.status === 'Completed' || t.status === 'Archived' || t.status === 'Cancelled')) return false
    if (statusFilter !== 'All' && statusFilter !== 'CompletedAll' && statusFilter !== 'OpenAll' && t.status !== statusFilter) return false
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
    if (divisionFilter !== 'All' && resolveCategoryDivision(t.category, categoriesSettingsRow) !== divisionFilter) return false
    if (builderFilter !== 'All' && t.assigned_builder_id !== builderFilter) return false
    if (submitterFilter !== 'All' && t.raised_by !== submitterFilter) return false
    if (assignTypeFilter !== 'All' && (t.assign_type || 'Manual') !== assignTypeFilter) return false
    if (priorityFilter !== 'All' && effectiveTier(t) !== priorityFilter) return false
    // Exact match, not substring -- ticket_number is an ID, not free text.
    // A substring match against "3" used to pull in every ticket numbered
    // 13, 23, 30-39 etc., which is exactly the kind of noise this search
    // exists to cut through when jumping to one specific job.
    if (ticketNumberSearch.trim() && String(t.ticket_number) !== ticketNumberSearch.trim()) return false
    if (stuckOnlyFilter && !isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)) return false
    if (needsFollowupFilter && !t.needs_followup) return false
    // Reports' date range means two different things depending which set
    // you're looking at -- "raised in range" (created_at) vs "completed in
    // range" (completed_at). Once the status filter has narrowed down to
    // completed-ish tickets, the date range that actually matches what a
    // Reports tile/chart bar shows is completed_at, not created_at -- e.g.
    // clicking a specific week's "Completed" bar should land on exactly
    // that week's completions, not whatever was merely created that week.
    const dateField = (statusFilter === 'Completed' || statusFilter === 'Archived' || statusFilter === 'CompletedAll') ? 'completed_at' : 'created_at'
    if (fromDate && (!t[dateField] || new Date(t[dateField]).getTime() < new Date(fromDate).getTime())) return false
    if (toDate && (!t[dateField] || new Date(t[dateField]).getTime() > new Date(toDate).getTime() + 86400000 - 1)) return false
    return true
  })

  const submitterOptions = [...new Map(
    tickets.filter(t => t.raised_by).map(t => [t.raised_by, t.raised_by_name || 'Unknown'])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]))

  function sortValue(t, column) {
    switch (column) {
      case 'ticketNumber': return t.ticket_number || 0
      case 'property': return (t.property?.address || '').toLowerCase()
      case 'issueTag': return (t.issue_tag || '').toLowerCase()
      case 'priority': return t.priority_score || 0
      case 'status': return (t.status || '').toLowerCase()
      case 'builder': return (t.builderName || '').toLowerCase()
      case 'assignType': return (t.assign_type || 'Manual').toLowerCase()
      // -1 groups "no estimate set" together at one end of the sort,
      // never mixed in among real minute values (which are always >= 0).
      case 'estimatedMinutes': return t.estimated_minutes ?? -1
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
    setSubmitterFilter('All')
    setAssignTypeFilter('All')
    setPriorityFilter('All')
    setTicketNumberSearch('')
    setStuckOnlyFilter(false)
    setNeedsFollowupFilter(false)
    setFromDate('')
    setToDate('')
  }

  // Mirrors the dashboard's "Ticket Pipeline" tiles exactly -- counts are
  // always off the full ticket list, never the currently filtered view,
  // so every tile stays a stable shortcut to that category regardless of
  // whatever filter combination happens to be applied right now.
  const kpis = [
    // Every other tile's count already matches exactly what clicking it
    // shows -- this one didn't: it counted literally everything, Cancelled
    // and Archived included, while its own "All" status filter deliberately
    // hides both from the table (see filteredTickets above). Matches that
    // same definition now, so the tile and the list it opens always agree
    // (found live 2026-08-12: tile said 144, the list under it showed 136).
    { label: 'Total tickets', value: tickets.filter(t => t.status !== 'Cancelled' && t.status !== 'Archived').length, colour: COLORS.slate500, statusFilter: 'All' },
    { label: 'Unassigned', value: tickets.filter(t => t.status === 'Pending').length, colour: COLORS.red600, statusFilter: 'Pending' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, colour: COLORS.teal600, statusFilter: 'In Progress' },
    { label: 'On Hold', value: tickets.filter(t => t.status === 'On Hold').length, colour: COLORS.amber500, statusFilter: 'On Hold' },
    { label: 'Completed', value: tickets.filter(t => t.status === 'Completed' || t.status === 'Archived').length, colour: COLORS.green600, statusFilter: 'CompletedAll' },
    { label: 'P1 Critical', value: tickets.filter(t => effectiveTier(t) === 'P1 Critical').length, colour: COLORS.red600, statusFilter: 'All', priorityFilter: 'P1 Critical' },
    { label: 'Stuck', value: tickets.filter(t => isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)).length, colour: COLORS.red600, statusFilter: 'All', stuckOnly: true },
    { label: 'Needs Follow-up', value: tickets.filter(t => t.needs_followup).length, colour: COLORS.violet500, statusFilter: 'All', needsFollowupOnly: true },
  ]

  // Clicking a tile is a "jump to this category" shortcut, same as
  // arriving fresh from the dashboard -- resets every other filter first
  // so the result always matches the tile's count exactly.
  function applyKpiFilter(kpi) {
    clearFilters()
    setStatusFilter(kpi.statusFilter || 'All')
    if (kpi.priorityFilter) setPriorityFilter(kpi.priorityFilter)
    if (kpi.stuckOnly) setStuckOnlyFilter(true)
    if (kpi.needsFollowupOnly) setNeedsFollowupFilter(true)
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
          constantly stay in their own row; date range/export are a distinct
          "generate a report" action, not something reached for on every
          visit, so they get their own labeled section below rather than
          being crammed into the same row. Division moved up here (out of
          that section) -- it's a real day-to-day triage filter for Admin
          and an unscoped manager (e.g. Maintenance Manager) once more than
          one division exists, not just a report parameter; a
          division-scoped manager never needs it, since their own tickets
          are already the only ones they can see. */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Statuses</option>
          <option value="OpenAll">Open (excl. completed/cancelled)</option>
          <option value="Pending">Unassigned</option>
          <option value="Assigned">Assigned</option>
          <option value="In Progress">In Progress</option>
          <option value="On Hold">On Hold</option>
          <option value="Completed">Completed (awaiting sign-off)</option>
          <option value="Archived">Archived (signed off)</option>
          <option value="CompletedAll">Completed (all, incl. signed off)</option>
          <option value="Cancelled">Cancelled</option>
        </select>
        {!profile.division && (
          <select value={divisionFilter} onChange={(e) => setDivisionFilter(e.target.value)} style={filterSelectStyle}>
            <option value="All">All Divisions</option>
            {divisionOptions.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
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
        <select value={submitterFilter} onChange={(e) => setSubmitterFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Submitters</option>
          {submitterOptions.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Priorities</option>
          <option value="P1 Critical">P1 Critical</option>
          <option value="P2 Urgent">P2 Urgent</option>
          <option value="P3 Routine">P3 Routine</option>
        </select>
        <select value={assignTypeFilter} onChange={(e) => setAssignTypeFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">Auto + Manual</option>
          <option value="Auto">Auto-assigned only</option>
          <option value="Manual">Manually assigned only</option>
        </select>
        {/* Same fromDate/toDate the "Generate a report" section below also
            uses for the export -- it's a real filter on the list too (see
            dateField in the filter above), not just a report parameter, so
            it belongs up here where it's actually reached for day to day. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>
            {(statusFilter === 'Completed' || statusFilter === 'Archived' || statusFilter === 'CompletedAll') ? 'Completed' : 'Raised'}
          </span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={filterSelectStyle} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>to</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={filterSelectStyle} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px', border: `1px solid ${COLORS.amber200}`, background: COLORS.amber50, color: COLORS.amber800, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          <input type="checkbox" checked={stuckOnlyFilter} onChange={(e) => setStuckOnlyFilter(e.target.checked)} />
          ⚠ Stuck only
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', borderRadius: '10px', border: `1px solid ${COLORS.violet500}`, background: `${COLORS.violet500}14`, color: COLORS.violet600, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          <input type="checkbox" checked={needsFollowupFilter} onChange={(e) => setNeedsFollowupFilter(e.target.checked)} />
          ⚑ Needs follow-up only
        </label>
        <button onClick={clearFilters} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
          Clear filters
        </button>
      </div>

      {/* Given its own accent colour (indigo) rather than the neutral
          slate every other section on this page uses -- it was previously
          easy to miss entirely sitting flush against the filter row above
          it, both grey-on-grey. */}
      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={() => setReportSectionOpen(prev => !prev)}
          style={{
            display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
            padding: '12px 16px', background: COLORS.indigo100, border: `1px solid ${COLORS.indigo700}`, borderRadius: '12px',
            cursor: 'pointer', fontSize: '12.5px', fontWeight: 800, color: COLORS.indigo700, textTransform: 'uppercase', letterSpacing: '0.05em',
            boxShadow: '0 1px 3px rgba(67,56,202,0.15)',
          }}
        >
          <span>🖨️ Generate a Report</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.indigo700, textTransform: 'none', letterSpacing: 0 }}>
            {reportSectionOpen ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>
        {reportSectionOpen && (
          <div style={{
            display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center',
            marginTop: '8px', padding: '12px 16px', borderRadius: '12px',
            border: `1px solid ${COLORS.indigo100}`, background: COLORS.white,
          }}>
            <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>Uses the status, division, date range, and other filters set above.</p>
            <button onClick={() => setReportOpen(true)} style={{ padding: '9px 16px', borderRadius: '10px', border: 'none', background: COLORS.indigo700, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
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

      {/* KPI tiles above are deliberately always off the full, unfiltered
          ticket list (see their own comment) -- so filtering (division or
          otherwise) narrowed the table with no count anywhere reflecting
          it, leaving "how many tickets is that" only answerable by
          manually counting rows. */}
      <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate500 }}>
        {sortedTickets.length} ticket{sortedTickets.length === 1 ? '' : 's'}{divisionFilter !== 'All' ? ` in ${divisionFilter}` : ''}
      </p>

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
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('issueTag')}>Subcategory{sortArrow('issueTag')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('priority')}>Priority{sortArrow('priority')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('builder')}>Builder{sortArrow('builder')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('assignType')}>Assign Type{sortArrow('assignType')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('estimatedMinutes')}>Est. Time{sortArrow('estimatedMinutes')}</th>
                <th style={{ ...thStyle, cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('logDate')}>Log Date{sortArrow('logDate')}</th>
                <th style={{ ...thStyle, width: '32px' }} />
              </tr>
            </thead>
            <tbody>
              {sortedTickets.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: '32px', textAlign: 'center', color: COLORS.slate400, fontWeight: 600 }}>
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
                      id={`ticket-row-${t.id}`}
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
                        <span style={{ color: COLORS.slate600 }}>{renderIssueTag(t.issue_tag)}</span>
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
                        {t.assigned_builder_id ? (
                          <span
                            onClick={(e) => { e.stopPropagation(); setBuilderProfileId(t.assigned_builder_id) }}
                            style={{ color: COLORS.blue700, fontWeight: 600, cursor: 'pointer' }}
                          >
                            {t.builderName || 'Unknown'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: COLORS.slate300 }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {t.assigned_builder_id ? (
                          <span style={{
                            display: 'inline-block', fontSize: '11px', fontWeight: 700,
                            color: t.assign_type === 'Auto' ? COLORS.teal700 : COLORS.slate500,
                            background: t.assign_type === 'Auto' ? COLORS.teal100 : COLORS.slate100,
                            padding: '3px 10px', borderRadius: '20px',
                          }}>
                            {t.assign_type === 'Auto' ? 'Auto' : 'Manual'}
                          </span>
                        ) : (
                          <span style={{ fontSize: '11px', color: COLORS.slate300 }}>—</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        {t.estimated_minutes != null ? (
                          <span style={{ color: COLORS.slate600 }}>{formatDuration(t.estimated_minutes * 60000)}</span>
                        ) : (
                          <span style={{ fontSize: '11px', color: COLORS.slate300 }}>—</span>
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
                        <td colSpan={11} style={{ padding: 0, background: COLORS.red50, boxShadow: `inset 4px 0 0 ${COLORS.red600}` }}>
                          <div style={{ padding: '18px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

                            <div style={expandSectionStyle}>
                              <p style={expandSectionTitleStyle}>Ticket Details</p>
                              <p style={expandLabelStyle}>Ticket</p>
                              <p style={expandValueStyle}>#{t.ticket_number} — {t.category}</p>

                              <p style={expandLabelStyle}>Raised By</p>
                              <p style={expandValueStyle}>{raisedByLabel(t)}</p>

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
                              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={{ minWidth: '140px' }}>
                                  <p style={expandLabelStyle}>Reported Photos / Videos</p>
                                  <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.photo_url} mediaHeight="140px" emptyLabel="No photos or videos attached" />
                                </div>
                                <div style={{ minWidth: '140px' }}>
                                  <p style={expandLabelStyle}>Completion Photos / Videos</p>
                                  <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.completion_photo_url} mediaHeight="140px" stage="completed" />
                                </div>
                              </div>
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

                              {t.estimated_minutes != null && (
                                <>
                                  <p style={expandLabelStyle}>Estimated Time</p>
                                  <p style={expandValueStyle}>{formatDuration(t.estimated_minutes * 60000)}</p>
                                </>
                              )}

                              {(t.status === 'Completed' || t.status === 'Archived' || t.status === 'In Progress' || t.status === 'On Hold') && (
                                <>
                                  <p style={expandLabelStyle}>Time Worked</p>
                                  <TicketWorkedTime ticketId={t.id} />
                                </>
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
                              {!t.no_access_flag && !(t.status === 'On Hold' && t.hold_reason) && !t.completion_note && !t.cancel_reason && !t.needs_followup && !t.signoff_flagged && (
                                <p style={{ fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', margin: 0 }}>No notes on this ticket</p>
                              )}

                              {/* Submitter's 3-question sign-off check came back
                                  with at least one "No" -- see
                                  add_submitter_signoff_quality_check.sql. Blocks
                                  the submitter from archiving until this is
                                  addressed; they were already notified in-app +
                                  push, this is the persistent record. */}
                              {t.signoff_flagged && (
                                <div style={{ padding: '8px 10px', background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.red600 }}>⚠ Sign-off Flagged by Submitter</p>
                                  {t.signoff_note && <p style={{ margin: '2px 0 4px 0', fontSize: '12px', color: COLORS.red900 }}>{t.signoff_note}</p>}
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.red600 }}>
                                    {[
                                      t.signoff_resolved === false && 'Not resolved',
                                      t.signoff_good_standard === false && 'Not to a good standard',
                                      t.signoff_clean === false && 'Not left clean',
                                    ].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                              )}

                              {t.needs_followup && (
                                <div style={{ padding: '8px 10px', background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.violet600 }}>Needs Follow-up</p>
                                  {t.followup_note && <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.slate900 }}>{t.followup_note}</p>}
                                </div>
                              )}

                              {t.status === 'Cancelled' && t.cancel_reason && (
                                <div style={{ padding: '8px 10px', background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', marginBottom: '8px' }}>
                                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.red600 }}>
                                    Cancelled — {t.cancel_type}{t.cancel_duplicate_ref ? ` (duplicate of #${t.cancel_duplicate_ref})` : ''}
                                  </p>
                                  <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.red900 }}>{t.cancel_reason}</p>
                                </div>
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

                            {/* Receipts -- only from a "Buying Materials" trip
                                logged while this ticket was in progress (see
                                add_activity_receipts_table.sql). Closed by
                                default. Always shown, even with zero receipts,
                                so the feature itself is visible/demoable, not
                                just its results. */}
                            {(() => {
                              const receipts = receiptsByTicketId[t.id] || []
                              return (
                                <div style={expandSectionStyle}>
                                  <button
                                    onClick={() => setExpandedReceiptTicketIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(t.id)) next.delete(t.id); else next.add(t.id)
                                      return next
                                    })}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  >
                                    <p style={{ ...expandSectionTitleStyle, margin: 0 }}>🧾 Receipts ({receipts.length})</p>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>{expandedReceiptTicketIds.has(t.id) ? '▲ Hide' : '▼ Show'}</span>
                                  </button>
                                  {expandedReceiptTicketIds.has(t.id) && (() => {
                                    if (receipts.length === 0) {
                                      return <p style={{ margin: '12px 0 0 0', fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>No receipts logged for this job.</p>
                                    }
                                    const photoUrls = receipts.filter(r => r.photo_url).map(r => r.photo_url)
                                    return (
                                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {receipts.map((r, i) => (
                                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px', background: COLORS.slate50, borderRadius: '10px' }}>
                                            {r.photo_url ? (
                                              <img
                                                src={r.photo_url} alt="Receipt"
                                                onClick={() => setReceiptLightbox({ urls: photoUrls, index: photoUrls.indexOf(r.photo_url) })}
                                                style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: '8px', cursor: 'pointer', flexShrink: 0 }}
                                              />
                                            ) : (
                                              <div style={{ width: '48px', height: '48px', borderRadius: '8px', background: COLORS.slate200, flexShrink: 0 }} />
                                            )}
                                            <div style={{ flex: 1 }}>
                                              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{r.amount != null ? `£${Number(r.amount).toFixed(2)}` : 'No amount entered'}</p>
                                              <p style={{ margin: 0, fontSize: '11px', color: COLORS.slate400 }}>{formatUKDateTime(r.created_at)}</p>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  })()}
                                </div>
                              )
                            })()}

                            {/* Materials Used -- what this job actually
                                consumed, logged by the builder at completion
                                (see add_ticket_materials_used_table.sql).
                                Separate section from Receipts above -- a
                                receipt is proof of spend on a shopping trip,
                                not necessarily for this one job; this is the
                                other side, what THIS job used. Always shown,
                                even with nothing logged, same reasoning as
                                Receipts above. */}
                            {(() => {
                              const materialsUsed = materialsUsedByTicketId[t.id] || []
                              return (
                                <div style={expandSectionStyle}>
                                  <button
                                    onClick={() => setExpandedMaterialsTicketIds(prev => {
                                      const next = new Set(prev)
                                      if (next.has(t.id)) next.delete(t.id); else next.add(t.id)
                                      return next
                                    })}
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                                  >
                                    <p style={{ ...expandSectionTitleStyle, margin: 0 }}>🧱 Materials Used ({materialsUsed.length})</p>
                                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>{expandedMaterialsTicketIds.has(t.id) ? '▲ Hide' : '▼ Show'}</span>
                                  </button>
                                  {expandedMaterialsTicketIds.has(t.id) && (
                                    materialsUsed.length === 0 ? (
                                      <p style={{ margin: '12px 0 0 0', fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>No materials logged for this job.</p>
                                    ) : (
                                      <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        {materialsUsed.map((m, i) => (
                                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 10px', background: COLORS.slate50, borderRadius: '10px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{m.name}</span>
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate500, flexShrink: 0 }}>{m.quantity}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )
                                  )}
                                </div>
                              )
                            })()}

                            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                              <button onClick={() => openCommentsModal(t)} style={actionBtnStyle}>Comments</button>
                              <button onClick={() => openHistoryModal(t)} style={actionBtnStyle}>History</button>
                              <button onClick={() => openPriorityModal(t)} style={actionBtnStyle}>Priority</button>
                              {/* Same Archived-is-locked rule as Edit Estimate/Edit
                                  Mileage below -- once signed off, only the raiser
                                  can still edit a ticket, so a manager's update
                                  here would silently fail past that point. */}
                              {t.status !== 'Archived' && (
                                <button onClick={() => openEditFollowupModal(t)} style={actionBtnStyle}>{t.needs_followup ? 'Edit Follow-up' : 'Flag Follow-up'}</button>
                              )}
                              {EVENTS_FEATURE_ENABLED && (
                                <button onClick={() => openAddToEventModal(t)} style={actionBtnStyle}>{t.event_id ? 'Change Event' : 'Add to Event'}</button>
                              )}
                              {t.status !== 'Cancelled' && (
                                <button onClick={() => openCancelModal(t)} style={{ ...actionBtnStyle, color: COLORS.red600, borderColor: COLORS.red200 }}>Cancel Ticket</button>
                              )}
                              {/* For jobs done by an external contractor
                                  with no PMMS login -- the normal Complete
                                  button lives inside the assigned builder's
                                  own locked job view, which they can never
                                  reach. */}
                              {!['Completed', 'Archived', 'Cancelled'].includes(t.status) && (
                                <button onClick={() => openCompleteModal(t)} style={{ ...actionBtnStyle, color: COLORS.green600, borderColor: COLORS.green200 }}>Mark Complete</button>
                              )}
                              {/* Archived tickets are locked (RLS: once
                                  signed off, only the raiser can still edit
                                  a ticket -- same rule behind raiser-only
                                  sign-off). Hidden here to match, rather
                                  than showing a button that fails on save. */}
                              {t.assigned_builder_id && t.status !== 'Archived' && (
                                <button onClick={() => openEditEstimateModal(t)} style={actionBtnStyle}>{t.estimated_minutes != null ? 'Edit Estimate' : 'Add Estimate'}</button>
                              )}
                              {t.assigned_builder_id && t.status !== 'Archived' && (
                                <button onClick={() => openEditMileageModal(t)} style={actionBtnStyle}>Edit Mileage</button>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: COLORS.slate500, cursor: 'pointer' }}>
              <input type="checkbox" checked={reassignIgnoreSkills} onChange={(e) => setReassignIgnoreSkills(e.target.checked)} />
              Show all builders (ignore skills)
            </label>
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

            {/* Manager-only -- never shown on the builder's side of the
                app. Compared against actual time worked later on the
                Clocking page, so a small job that quietly ran long stands
                out instead of blending into the timesheet. */}
            <label style={modalLabelStyle}>Estimated time (minutes, required)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={reassignEstimatedMinutes}
              onChange={(e) => setReassignEstimatedMinutes(e.target.value)}
              placeholder="e.g. 30"
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
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
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 10px 0', fontSize: '12px', fontWeight: 600, color: COLORS.slate500, cursor: 'pointer' }}>
                    <input type="checkbox" checked={bulkReassignIgnoreSkills} onChange={(e) => setBulkReassignIgnoreSkills(e.target.checked)} />
                    Show all builders (ignore skills)
                  </label>
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

      {/* Mark Complete modal -- manager-side completion for jobs done by
          someone with no PMMS login (typically an external contractor). */}
      {completeModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Mark Complete — Ticket #{completeModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{completeModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>What was done (required — mention the contractor if this was external)</label>
            <textarea
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              rows={3}
              placeholder="e.g. Completed by ABC Roofing on 12/08 -- replaced 3 broken tiles."
              style={modalTextareaStyle}
            />

            <label style={modalLabelStyle}>Photo (optional)</label>
            {completePhotoPreview
              ? (
                <div style={{ marginBottom: '10px' }}>
                  <img src={completePhotoPreview} alt="" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '10px', marginBottom: '6px' }} />
                  <button
                    type="button"
                    onClick={() => { setCompletePhotoFile(null); if (completePhotoPreview) URL.revokeObjectURL(completePhotoPreview); setCompletePhotoPreview(null) }}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '12px', fontWeight: 700, color: COLORS.red600, cursor: 'pointer' }}
                  >
                    Remove photo
                  </button>
                </div>
              )
              : (
                <input type="file" accept="image/*" onChange={handleCompletePhoto} style={{ marginBottom: '10px', fontSize: '13px' }} />
              )}

            {completeError && <p style={modalErrorStyle}>{completeError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeCompleteModal} style={modalCancelBtnStyle} disabled={completeSubmitting}>Cancel</button>
              <button
                onClick={submitComplete}
                disabled={completeSubmitting}
                style={{ ...modalConfirmBtnStyle, background: COLORS.green600, opacity: completeSubmitting ? 0.6 : 1, cursor: completeSubmitting ? 'not-allowed' : 'pointer' }}
              >
                {completeSubmitting ? 'Saving...' : 'Mark Complete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Priority override modal */}
      {editEstimateModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Estimated Time — Ticket #{editEstimateModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{editEstimateModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Estimated time (minutes)</label>
            <input
              type="number"
              min="0"
              step="5"
              value={editEstimateValue}
              onChange={(e) => setEditEstimateValue(e.target.value)}
              placeholder="e.g. 30"
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
            />

            {editEstimateError && <p style={modalErrorStyle}>{editEstimateError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeEditEstimateModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitEditEstimate} disabled={editEstimateSaving} style={{ ...modalConfirmBtnStyle, opacity: editEstimateSaving ? 0.6 : 1, cursor: editEstimateSaving ? 'not-allowed' : 'pointer' }}>
                {editEstimateSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editMileageModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Mileage — Ticket #{editMileageModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{editMileageModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Miles driven to get here</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={editMileageValue}
              onChange={(e) => setEditMileageValue(e.target.value)}
              placeholder="e.g. 4.5"
              style={{ width: '100%', height: '40px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
            />

            {editMileageError && <p style={modalErrorStyle}>{editMileageError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeEditMileageModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitEditMileage} disabled={editMileageSaving} style={{ ...modalConfirmBtnStyle, opacity: editMileageSaving ? 0.6 : 1, cursor: editMileageSaving ? 'not-allowed' : 'pointer' }}>
                {editMileageSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editFollowupModalTicket && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Follow-up — Ticket #{editFollowupModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{editFollowupModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Needs a follow-up visit?</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={radioRowStyle(editFollowupNeeded)}>
                <input type="radio" name="edit-followup" checked={editFollowupNeeded} onChange={() => setEditFollowupNeeded(true)} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>Yes</span>
              </label>
              <label style={radioRowStyle(!editFollowupNeeded)}>
                <input type="radio" name="edit-followup" checked={!editFollowupNeeded} onChange={() => setEditFollowupNeeded(false)} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>No</span>
              </label>
            </div>

            {editFollowupNeeded && (
              <>
                <label style={modalLabelStyle}>Note (optional)</label>
                <textarea
                  value={editFollowupNote}
                  onChange={(e) => setEditFollowupNote(e.target.value)}
                  rows={2}
                  placeholder="e.g. Needs a second visit once the part arrives..."
                  style={modalTextareaStyle}
                />
              </>
            )}

            {editFollowupError && <p style={modalErrorStyle}>{editFollowupError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeEditFollowupModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitEditFollowup} disabled={editFollowupSaving} style={{ ...modalConfirmBtnStyle, opacity: editFollowupSaving ? 0.6 : 1, cursor: editFollowupSaving ? 'not-allowed' : 'pointer' }}>
                {editFollowupSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {receiptLightbox && (
        <PhotoLightbox
          urls={receiptLightbox.urls}
          index={receiptLightbox.index}
          onNavigate={(i) => setReceiptLightbox(prev => ({ ...prev, index: i }))}
          onClose={() => setReceiptLightbox(null)}
        />
      )}

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
