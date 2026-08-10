import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { distanceMetres, googleMapsEmbedLink, googleMapsRouteEmbedLink, metresToMiles, formatDistanceMetres, ensurePropertyCoords, ensureStaffHomeCoords } from '../../lib/geo'
import { attachProperties } from '../../lib/properties'
import {
  thStyle, tdStyle, actionBtnStyle, filterSelectStyle, formatUKDate, formatUKDateTime, toUkDateTimeInputValue, ukDateTimeInputValueToMs,
  ukDateKey, ukTimeHHMM, minutesLate, shiftDateKey,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle,
  modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle, fetchAssignableBuilders, fetchAssignableStaffForDivision,
} from './shared'

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
const DEFAULT_CLOCK_DISTANCE_THRESHOLD_M = 250

// Straight-line (haversine) distance always undercounts real road miles --
// actual roads bend, one-way systems detour, etc. This is a rough UK rule-
// of-thumb multiplier to approximate driving distance without needing a
// paid routing API (Google Distance Matrix/Directions). It's an
// approximation, labelled as such in the UI, not a claim to match Google's
// actual route mileage exactly.
const ROAD_DISTANCE_MULTIPLIER = 1.3

// Compact map-pin button + optional "too far" flag shown under a clock-in
// or clock-out time in the timesheet, when that event has a recorded
// location. Opens the in-app map modal instead of a new browser tab.
// dismissal (a clocking_flag_dismissals row, or null) swaps the red
// warning + "Dismiss" for a quieter "Reviewed" tag + "Undo" once a manager
// has checked it -- see handleDismissFlag/handleUndoDismiss. onDismiss/
// onUndoDismiss are already bound to this specific job by the caller
// (dismissing/undoing always acts on the whole job, both clock-in and
// clock-out together -- see handleDismissFlag's own comment), so this
// component just calls them with no arguments.
function LocationCell({ distance, thresholdM, lat, lng, onOpenMap, dismissal, onDismiss, onUndoDismiss }) {
  // getCurrentPositionSafe() (lib/geo.js) never blocks clocking in/out --
  // it resolves to null on denial/timeout/no GPS lock rather than making
  // the builder wait or fail. That's silent by design at the point of
  // clocking in, but silently blank here (no button, no text) read as a
  // rendering glitch rather than "location wasn't captured" -- found live
  // on a real record with a clock-out location but no clock-in one.
  if (lat == null || lng == null) {
    return <span style={{ display: 'block', marginTop: '2px', fontSize: '11px', color: COLORS.slate300, fontStyle: 'italic' }}>No location captured</span>
  }
  const tooFar = distance != null && distance > thresholdM
  return (
    <div style={{ fontFamily: 'system-ui', marginTop: '2px' }}>
      <button onClick={() => onOpenMap(lat, lng)} style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}>
        📍 Map
      </button>
      {tooFar && (
        dismissal ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: COLORS.slate400 }}>✓ Reviewed</span>
            <button onClick={onUndoDismiss} style={{ background: 'none', border: 'none', padding: 0, fontSize: '10px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}>
              Undo
            </button>
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
            <span style={{ fontSize: '10px', fontWeight: 800, color: COLORS.red600 }}>
              ⚠ {formatDistanceMetres(distance)} away
            </span>
            <button onClick={onDismiss} style={{ background: 'none', border: 'none', padding: 0, fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textDecoration: 'underline', cursor: 'pointer' }}>
              Dismiss
            </button>
          </span>
        )
      )}
    </div>
  )
}

function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0
  const totalMinutes = Math.round(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}

// One-glance punctuality summary for Today's Attendance -- late_flag and
// early_leave_reason already exist on the shift (used inline under
// Clocked In/Out below), this just collapses both into a single badge so
// a manager doesn't have to read two cells to know if today was clean.
function dailyStatusFor(shift) {
  if (!shift) return { label: 'Not Clocked In', color: COLORS.slate400, bg: COLORS.slate100 }
  if (shift.late_flag && shift.early_leave_reason) return { label: 'Late & Left Early', color: COLORS.red600, bg: COLORS.red100 }
  if (shift.late_flag) return { label: 'Late', color: COLORS.amber700, bg: COLORS.amber100 }
  if (shift.early_leave_reason) return { label: 'Left Early', color: COLORS.amber700, bg: COLORS.amber100 }
  return { label: 'On Time', color: COLORS.green600, bg: COLORS.green100 }
}

export default function AdminClocking({ profile, onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [liveSessions, setLiveSessions] = useState([])
  const [completedRows, setCompletedRows] = useState([])
  const [builders, setBuilders] = useState([])
  const [builderFilter, setBuilderFilter] = useState('All')
  const [completedSortColumn, setCompletedSortColumn] = useState(null)
  const [completedSortDirection, setCompletedSortDirection] = useState('asc')
  const [distanceThresholdM, setDistanceThresholdM] = useState(DEFAULT_CLOCK_DISTANCE_THRESHOLD_M)
  const [, setTick] = useState(0)
  // Lets a manager say "I checked this, it's fine" on a flagged clock-in/
  // out from this page -- the Dashboard's Flagged Locations count then
  // excludes it (see fetchFlaggedClockingCount, shared.jsx). This page
  // itself still shows every flag regardless of dismissal (an audit
  // trail, not just a to-do list) -- dismissing just swaps the red
  // warning for a quieter "Reviewed" tag with an Undo.
  const [dismissals, setDismissals] = useState([])

  const [editRow, setEditRow] = useState(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const [mapModal, setMapModal] = useState(null)

  const [attendanceRows, setAttendanceRows] = useState([])
  const [dailyClockInDeadline, setDailyClockInDeadline] = useState('09:00')
  const [overrideModal, setOverrideModal] = useState(null) // { mode: 'in' | 'out', staffId, staffName, rowId }
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideError, setOverrideError] = useState('')
  const [overrideSaving, setOverrideSaving] = useState(false)
  // History modal: identity only (staffId/staffName) -- the actual events
  // shown are fetched fresh for whichever date is selected, not derived
  // from the Today's Attendance row, so a manager can page back to any
  // past day, not just today.
  const [historyModal, setHistoryModal] = useState(null) // { staffId, staffName }
  const [historyDate, setHistoryDate] = useState(ukDateKey())
  const [historyShifts, setHistoryShifts] = useState([])
  const [historyActivity, setHistoryActivity] = useState([])
  const [historyJobEvents, setHistoryJobEvents] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [monthlyMonth, setMonthlyMonth] = useState(ukDateKey().slice(0, 7))
  const [monthlyRows, setMonthlyRows] = useState([])
  const [monthlyLoading, setMonthlyLoading] = useState(true)

  function openPinMap(lat, lng) {
    setMapModal({ mode: 'pin', embedUrl: googleMapsEmbedLink(lat, lng) })
  }

  function openRouteMap(inLat, inLng, outLat, outLng) {
    const distanceMiles = metresToMiles(distanceMetres(inLat, inLng, outLat, outLng))
    setMapModal({ mode: 'route', embedUrl: googleMapsRouteEmbedLink(inLat, inLng, outLat, outLng), distanceMiles })
  }

  function findDismissal(ticketId, kind) {
    return dismissals.find(d => d.ticket_id === ticketId && d.kind === kind) || null
  }

  // Dismiss/undo act on the whole job, not one field at a time -- the
  // Flagged Locations count treats a job as "1 flagged" if EITHER its
  // clock-in OR clock-out was too far (see fetchFlaggedClockingCount,
  // shared.jsx), so dismissing only one side of a job flagged on both
  // would silently leave it still counted. flaggedKinds is whichever of
  // 'clock_in'/'clock_out' actually needs reviewing for this ticket right
  // now -- usually one, sometimes both.
  async function handleDismissFlag(ticketId, flaggedKinds) {
    if (flaggedKinds.length === 0) return
    const { data, error } = await supabase
      .schema('pmms')
      .from('clocking_flag_dismissals')
      .insert(flaggedKinds.map(kind => ({ ticket_id: ticketId, kind, dismissed_by: profile.id })))
      .select('id, ticket_id, kind')
    if (!error) setDismissals(prev => [...prev, ...data])
  }

  async function handleUndoDismiss(ticketId) {
    setDismissals(prev => prev.filter(d => d.ticket_id !== ticketId))
    await supabase.schema('pmms').from('clocking_flag_dismissals').delete().eq('ticket_id', ticketId)
  }

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  // Waits on `builders` (populated by fetchAll) so the rollup always has
  // the same assignable-builder list Today's Attendance uses, rather than
  // re-deriving it -- refires whenever that list loads in, and again
  // whenever the month picker changes.
  useEffect(() => {
    if (builders.length > 0) fetchMonthlyHours()
  }, [monthlyMonth, builders])

  async function fetchMonthlyHours() {
    setMonthlyLoading(true)
    const [year, month] = monthlyMonth.split('-').map(Number)
    const firstDay = `${monthlyMonth}-01`
    const lastDayDate = new Date(year, month, 0)
    const lastDay = `${lastDayDate.getFullYear()}-${String(lastDayDate.getMonth() + 1).padStart(2, '0')}-${String(lastDayDate.getDate()).padStart(2, '0')}`

    const { data } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .select('staff_id, work_date, clock_in_at, clock_out_at')
      .gte('work_date', firstDay)
      .lte('work_date', lastDay)

    setMonthlyRows(builders.map(b => {
      const shifts = (data || []).filter(s => s.staff_id === b.id)
      // Still-open shifts (forgotten clock-out, or today if viewing the
      // current month) are excluded from the total and flagged instead,
      // rather than silently counted as zero or guessed at.
      const totalMs = shifts.reduce((sum, s) => s.clock_out_at ? sum + (new Date(s.clock_out_at) - new Date(s.clock_in_at)) : sum, 0)
      return {
        staffId: b.id,
        staffName: b.name,
        daysWorked: new Set(shifts.map(s => s.work_date)).size,
        totalMs,
        hasIncomplete: shifts.some(s => !s.clock_out_at),
      }
    }))
    setMonthlyLoading(false)
  }

  useEffect(() => {
    if (editRow) {
      setEditClockIn(toUkDateTimeInputValue(new Date(editRow.firstIn).getTime()))
      setEditClockOut(toUkDateTimeInputValue(new Date(editRow.lastOut).getTime()))
      setEditError('')
    }
  }, [editRow])

  async function fetchAll() {
    setLoading(true)

    const { data: settingsRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'clock_distance_threshold_meters')
      .maybeSingle()
    const thresholdM = settingsRow?.setting_value != null ? Number(settingsRow.setting_value) : DEFAULT_CLOCK_DISTANCE_THRESHOLD_M
    setDistanceThresholdM(thresholdM)

    const { data: dismissalRows } = await supabase
      .schema('pmms')
      .from('clocking_flag_dismissals')
      .select('id, ticket_id, kind')
    setDismissals(dismissalRows || [])

    // Two different builder lists, same distinction AdminPipeline draws: an
    // unfiltered staff lookup to resolve names for ANY historical assignee
    // (even someone since deactivated or moved off the Builder role), and
    // fetchAssignableBuilders() -- active PMMS Builders only -- for the
    // filter dropdown, so it matches what Pipeline/Reassign actually offer.
    const { data: builderData } = await supabase
      .from('staff')
      .select('id, name, home_postcode, home_latitude, home_longitude')
    const assignableBuilders = await (profile.division ? fetchAssignableStaffForDivision(profile.division) : fetchAssignableBuilders())
    setBuilders(assignableBuilders)

    const { data: deadlineRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'daily_clock_in_deadline')
      .maybeSingle()
    setDailyClockInDeadline(deadlineRow?.setting_value || '09:00')

    // --- Today's Attendance (day-level clock in/out, separate
    // from the per-job sessions below) -- one row per assignable builder,
    // whether or not they've clocked in yet, so a manager can override
    // either direction. `.or(...)` pulls in today's rows by work_date PLUS
    // any still-open row regardless of date, so a forgotten clock-out from
    // a previous day doesn't just silently vanish from view. Merged with
    // activity_log and the live work_sessions fetched just below into the
    // full attendanceRows (current status, hours today) further down,
    // once all three are available.
    const todayKey = ukDateKey()
    const { data: attendanceData } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .select('id, staff_id, work_date, clock_in_at, clock_in_lat, clock_in_lng, late_flag, clock_out_at, clock_out_lat, clock_out_lng, clock_in_override, clock_out_override, early_leave_reason')
      .or(`work_date.eq.${todayKey},clock_out_at.is.null`)
      .order('clock_in_at', { ascending: false })

    const { data: activityData } = await supabase
      .schema('pmms')
      .from('activity_log')
      .select('id, staff_id, activity_type, note, started_at, ended_at')
      .or(`started_at.gte.${todayKey}T00:00:00,ended_at.is.null`)
      .order('started_at', { ascending: true })

    // --- Section 1: currently clocked in (open work_sessions) ---
    const { data: openSessions } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('id, ticket_id, builder_id, started_at, clock_in_lat, clock_in_lng')
      .is('ended_at', null)

    let liveTicketData = []
    if (openSessions && openSessions.length > 0) {
      const ticketIds = openSessions.map(s => s.ticket_id)
      const { data } = await supabase
        .schema('pmms')
        .from('tickets')
        .select('id, ticket_number, category, description, room, property_id')
        .in('id', ticketIds)
      liveTicketData = await attachProperties(data || [], 'address, postcode, latitude, longitude')
    }

    // --- Sections 2 & 3: completed tickets with recorded work sessions ---
    const { data: completedTicketsRaw } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, description, room, mileage_logged, estimated_minutes, assigned_builder_id, property_id')
      .in('status', ['Completed', 'Archived'])
    const completedTickets = await attachProperties(completedTicketsRaw || [], 'address, postcode, latitude, longitude')

    // Geocode every property involved (live + completed) in one batch,
    // caching results so this only ever hits postcodes.io for properties
    // that don't already have coordinates saved.
    const allProperties = [...liveTicketData, ...completedTickets].map(t => t.property).filter(Boolean)
    const coordsByPropertyId = await ensurePropertyCoords(allProperties)

    let live = []
    if (openSessions && openSessions.length > 0) {
      live = openSessions
        .map(s => {
          const ticket = liveTicketData.find(t => t.id === s.ticket_id)
          if (!ticket) return null
          const propertyCoords = ticket.property ? coordsByPropertyId[ticket.property.id] : null
          const distance = (propertyCoords && s.clock_in_lat != null && s.clock_in_lng != null)
            ? distanceMetres(s.clock_in_lat, s.clock_in_lng, propertyCoords.latitude, propertyCoords.longitude)
            : null
          return {
            session: s,
            ticket,
            builderName: builderData?.find(b => b.id === s.builder_id)?.name || 'Unknown',
            clockInDistance: distance,
          }
        })
        .filter(Boolean)
    }
    setLiveSessions(live)

    // Merge daily_attendance + activity_log + the live work_sessions just
    // fetched above into one row per builder: their shift, a derived
    // "where are they right now" status, and today's total hours (summed
    // across however many separate shifts they had today, in case of an
    // early clock-out corrected by clocking back in).
    setAttendanceRows(assignableBuilders.map(b => {
      const shift = (attendanceData || []).find(a => a.staff_id === b.id) || null
      const openSession = (openSessions || []).find(s => s.builder_id === b.id)
      const openSessionTicket = openSession ? liveTicketData.find(t => t.id === openSession.ticket_id) : null
      const openActivityForBuilder = (activityData || []).find(a => a.staff_id === b.id && !a.ended_at)

      let currentStatus = 'Off shift'
      if (shift && !shift.clock_out_at) {
        if (openActivityForBuilder) {
          currentStatus = `${openActivityForBuilder.activity_type === 'Travel' ? 'Travelling' : 'On break'}${openActivityForBuilder.note ? `: ${openActivityForBuilder.note}` : ''}`
        } else if (openSessionTicket) {
          currentStatus = `On Job #${openSessionTicket.ticket_number}`
        } else {
          currentStatus = 'Available'
        }
      }

      const todaysShifts = (attendanceData || []).filter(a => a.staff_id === b.id && a.work_date === todayKey)
      const hoursTodayMs = todaysShifts.reduce((sum, s) => {
        const end = s.clock_out_at ? new Date(s.clock_out_at).getTime() : Date.now()
        return sum + (end - new Date(s.clock_in_at).getTime())
      }, 0)

      return { staffId: b.id, staffName: b.name, shift, currentStatus, hoursTodayMs }
    }))

    let rows = []
    if (completedTickets.length > 0) {
      const ids = completedTickets.map(t => t.id)
      const { data: sessionData } = await supabase
        .schema('pmms')
        .from('work_sessions')
        .select('id, ticket_id, started_at, ended_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng')
        .in('ticket_id', ids)
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: true })

      rows = completedTickets
        .map(t => {
          const sessions = (sessionData || []).filter(s => s.ticket_id === t.id)
          if (sessions.length === 0) return null
          const firstSession = sessions[0]
          const lastSession = sessions[sessions.length - 1]
          const firstIn = firstSession.started_at
          const lastOut = lastSession.ended_at
          const totalMs = sessions.reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0)

          const propertyCoords = t.property ? coordsByPropertyId[t.property.id] : null
          const clockInDistance = (propertyCoords && firstSession.clock_in_lat != null && firstSession.clock_in_lng != null)
            ? distanceMetres(firstSession.clock_in_lat, firstSession.clock_in_lng, propertyCoords.latitude, propertyCoords.longitude)
            : null
          const clockOutDistance = (propertyCoords && lastSession.clock_out_lat != null && lastSession.clock_out_lng != null)
            ? distanceMetres(lastSession.clock_out_lat, lastSession.clock_out_lng, propertyCoords.latitude, propertyCoords.longitude)
            : null

          return {
            ticket: t,
            sessions,
            firstIn,
            lastOut,
            totalMs,
            builderName: builderData?.find(b => b.id === t.assigned_builder_id)?.name || 'Unassigned',
            firstSession,
            lastSession,
            clockInDistance,
            clockOutDistance,
            propertyCoords,
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.lastOut) - new Date(a.lastOut))
    }

    // Estimated mileage: straight-line distance (times a road-distance
    // multiplier, see ROAD_DISTANCE_MULTIPLIER above) from wherever the
    // builder plausibly started their trip -- home for their first job of
    // a given UK calendar day, otherwise their own previous job that same
    // day -- to this job's property. Nothing in the system records an
    // actual trip origin, so this is deliberately an approximation to
    // compare the builder's self-reported figure against, not a claim to
    // reproduce Google's real route mileage.
    const homeCoordsByStaffId = await ensureStaffHomeCoords((builderData || []).filter(b => b.home_postcode))
    const rowsByBuilder = {}
    rows.forEach(r => {
      const id = r.ticket.assigned_builder_id
      if (!id) return
      ;(rowsByBuilder[id] ||= []).push(r)
    })
    Object.values(rowsByBuilder).forEach(builderRows => {
      builderRows.sort((a, b) => new Date(a.firstIn) - new Date(b.firstIn))
      let prevRow = null
      let prevDateStr = null
      builderRows.forEach(r => {
        const dateStr = formatUKDate(r.firstIn)
        const origin = (prevRow && prevDateStr === dateStr) ? prevRow.propertyCoords : homeCoordsByStaffId[r.ticket.assigned_builder_id]
        r.estimatedMiles = (origin && r.propertyCoords)
          ? metresToMiles(distanceMetres(origin.latitude, origin.longitude, r.propertyCoords.latitude, r.propertyCoords.longitude)) * ROAD_DISTANCE_MULTIPLIER
          : null
        prevRow = r
        prevDateStr = dateStr
      })
    })

    setCompletedRows(rows)

    setLoading(false)
  }

  function openEditModal(row) { setEditRow(row) }
  function closeEditModal() { setEditRow(null) }

  function openOverrideModal(mode, attendanceRow) {
    setOverrideModal({ mode, staffId: attendanceRow.staffId, staffName: attendanceRow.staffName, rowId: attendanceRow.shift?.id, workDate: attendanceRow.shift?.work_date })
    setOverrideNote('')
    setOverrideError('')
  }
  function closeOverrideModal() { setOverrideModal(null) }

  function openHistoryModal(staffId, staffName) {
    setHistoryModal({ staffId, staffName })
    setHistoryDate(ukDateKey())
  }
  function closeHistoryModal() { setHistoryModal(null) }

  useEffect(() => {
    if (!historyModal) return
    fetchHistoryForDate(historyModal.staffId, historyDate)
  }, [historyModal, historyDate])

  // A day can have more than one shift (e.g. an early clock-out corrected
  // by clocking back in), so activity_log is bounded by the FIRST shift's
  // clock-in through the LAST shift's clock-out (or now, if still open) --
  // not a plain date match, since activity_log has no work_date column of
  // its own and only ever happens while clocked in.
  async function fetchHistoryForDate(staffId, dateKey) {
    setHistoryLoading(true)
    const { data: shifts } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .select('id, clock_in_at, clock_in_lat, clock_in_lng, clock_out_at, clock_out_lat, clock_out_lng, late_flag, early_leave_reason, clock_in_override, clock_out_override')
      .eq('staff_id', staffId)
      .eq('work_date', dateKey)
      .order('clock_in_at', { ascending: true })

    let activity = []
    let jobEvents = []
    if (shifts && shifts.length > 0) {
      const lastShift = shifts[shifts.length - 1]
      const lowerBound = shifts[0].clock_in_at
      const upperBound = lastShift.clock_out_at || new Date().toISOString()

      const [{ data }, { data: auditData }] = await Promise.all([
        supabase
          .schema('pmms')
          .from('activity_log')
          .select('id, activity_type, note, started_at, ended_at, destination_ticket_id')
          .eq('staff_id', staffId)
          .gte('started_at', lowerBound)
          .lte('started_at', upperBound)
          .order('started_at', { ascending: true }),
        // Job start/resume/complete/pause/no-access -- previously invisible
        // in this modal entirely, even though every one of them already
        // gets a human-readable audit_events row from BuilderDashboard.jsx's
        // own postAuditEvent() calls. Filtered to 'Status Changed' so a
        // ticket comment doesn't show up as an attendance event.
        supabase
          .schema('pmms')
          .from('audit_events')
          .select('id, ticket_id, summary, created_at')
          .eq('actor_id', staffId)
          .eq('action', 'Status Changed')
          .gte('created_at', lowerBound)
          .lte('created_at', upperBound)
          .order('created_at', { ascending: true }),
      ])

      const ticketIds = [...new Set([
        ...(auditData || []).map(a => a.ticket_id).filter(Boolean),
        ...(data || []).map(a => a.destination_ticket_id).filter(Boolean),
      ])]
      let ticketsById = {}
      if (ticketIds.length > 0) {
        const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, ticket_number').in('id', ticketIds)
        ticketsById = Object.fromEntries((ticketRows || []).map(t => [t.id, t]))
      }
      activity = (data || []).map(a => ({ ...a, destinationTicketNumber: a.destination_ticket_id ? ticketsById[a.destination_ticket_id]?.ticket_number : null }))
      jobEvents = (auditData || []).map(a => ({ ...a, ticketNumber: a.ticket_id ? ticketsById[a.ticket_id]?.ticket_number : null }))
    }

    setHistoryShifts(shifts || [])
    setHistoryActivity(activity)
    setHistoryJobEvents(jobEvents)
    setHistoryLoading(false)
  }

  // Escape hatch for when a builder genuinely can't clock themselves in or
  // out (dead phone, no signal, etc.) and the dashboard gate would
  // otherwise strand them all day -- a manager can do it for them, with a
  // required note so there's always a reason on record for why a shift
  // wasn't self-reported.
  async function submitOverride() {
    if (!overrideNote.trim()) { setOverrideError('Please add a note explaining the override.'); return }
    setOverrideSaving(true)

    if (overrideModal.mode === 'in') {
      const now = new Date()
      const { error } = await supabase
        .schema('pmms')
        .from('daily_attendance')
        .insert({
          staff_id: overrideModal.staffId,
          work_date: ukDateKey(now.getTime()),
          clock_in_at: now.toISOString(),
          late_flag: ukTimeHHMM(now.getTime()) > dailyClockInDeadline,
          clock_in_override: true,
          override_note: overrideNote.trim(),
          override_by: profile.id,
        })
      setOverrideSaving(false)
      if (error) { setOverrideError(error.message); return }
    } else {
      // A correction applied to a PAST day's shift (not today's) means it
      // sat open, unclosed, into a later day before anyone caught it --
      // that's a genuinely missed clock-out, not a live same-day assist,
      // and stays on record even once this fixes it. See
      // add_daily_attendance_missed_clock_out.sql for the full reasoning.
      const missedClockOut = overrideModal.workDate != null && overrideModal.workDate !== ukDateKey()
      const { error } = await supabase
        .schema('pmms')
        .from('daily_attendance')
        .update({
          clock_out_at: new Date().toISOString(),
          clock_out_override: true,
          missed_clock_out: missedClockOut,
          override_note: overrideNote.trim(),
          override_by: profile.id,
        })
        .eq('id', overrideModal.rowId)
      setOverrideSaving(false)
      if (error) { setOverrideError(error.message); return }
    }

    closeOverrideModal()
    await fetchAll()
  }

  async function submitEdit() {
    if (!editClockIn || !editClockOut) { setEditError('Please fill in both times.'); return }

    const newIn = ukDateTimeInputValueToMs(editClockIn)
    const newOut = ukDateTimeInputValueToMs(editClockOut)
    if (isNaN(newIn) || isNaN(newOut)) { setEditError("Couldn't read those times."); return }
    if (newOut <= newIn) { setEditError('Clock-out must be after clock-in.'); return }

    const row = editRow
    const firstSession = row.sessions[0]
    const lastSession = row.sessions[row.sessions.length - 1]

    setEditSaving(true)

    const { error: err1 } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ started_at: new Date(newIn).toISOString() })
      .eq('id', firstSession.id)

    const { error: err2 } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: new Date(newOut).toISOString() })
      .eq('id', lastSession.id)

    if (err1 || err2) {
      setEditSaving(false)
      setEditError((err1 || err2).message)
      return
    }

    const middleMs = row.sessions.slice(1, -1).reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0)
    const newTotalMs = row.sessions.length === 1
      ? (newOut - newIn)
      : (new Date(firstSession.ended_at) - newIn) + middleMs + (newOut - new Date(lastSession.started_at))

    await supabase
      .schema('pmms')
      .from('comments')
      .insert({
        ticket_id: row.ticket.id,
        author_id: profile.id,
        author_name: profile.name,
        role: profile.role,
        body: `Clock times corrected. New clock-in ${formatUKDateTime(new Date(newIn).toISOString())}, clock-out ${formatUKDateTime(new Date(newOut).toISOString())}. Total ${formatDuration(row.totalMs)} → ${formatDuration(newTotalMs)}.`,
      })

    setEditSaving(false)
    closeEditModal()
    await fetchAll()
  }

  const categoryStats = {}
  completedRows.forEach(r => {
    const cat = r.ticket.category || 'Other'
    if (!categoryStats[cat]) categoryStats[cat] = { totalMs: 0, count: 0 }
    categoryStats[cat].totalMs += r.totalMs
    categoryStats[cat].count += 1
  })
  const categoryEntries = Object.entries(categoryStats)

  const filteredCompletedRows = builderFilter === 'All'
    ? completedRows
    : completedRows.filter(r => r.ticket.assigned_builder_id === builderFilter)

  // "Correct" (the Edit button) isn't in here -- there's nothing to sort
  // an action column by. Route sorts by whether a pin-to-pin route
  // actually exists (both clock events have GPS), not anything more
  // specific -- that's the only orderable thing about it.
  const COMPLETED_SORT_ACCESSORS = {
    job: (r) => r.ticket.ticket_number,
    builder: (r) => (r.builderName || '').toLowerCase(),
    clockIn: (r) => new Date(r.firstIn).getTime(),
    clockOut: (r) => new Date(r.lastOut).getTime(),
    total: (r) => r.totalMs,
    miles: (r) => r.ticket.mileage_logged || 0,
    route: (r) => (r.firstSession.clock_in_lat != null && r.firstSession.clock_in_lng != null && r.lastSession.clock_out_lat != null && r.lastSession.clock_out_lng != null) ? 1 : 0,
  }

  function handleCompletedSort(column) {
    if (completedSortColumn === column) {
      setCompletedSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setCompletedSortColumn(column)
      setCompletedSortDirection('asc')
    }
  }

  const sortedCompletedRows = completedSortColumn
    ? [...filteredCompletedRows].sort((a, b) => {
        const accessor = COMPLETED_SORT_ACCESSORS[completedSortColumn]
        const av = accessor(a)
        const bv = accessor(b)
        const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
        return completedSortDirection === 'asc' ? cmp : -cmp
      })
    : filteredCompletedRows

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading clocking data...</p>
    </div>
  )

  return (
    <div>

      {/* Section 0: Average Time by Job Type */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Average Time by Job Type</h2>
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: COLORS.slate500 }}>Based on completed jobs with recorded clock times. {onNavigate ? 'Click a job type to see those jobs in Pipeline.' : ''}</p>

        {categoryEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No completed jobs with recorded time yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {categoryEntries.map(([category, stats]) => (
              <div
                key={category}
                onClick={onNavigate ? () => onNavigate('pipeline', { category, statusFilter: 'Completed' }) : undefined}
                style={{
                  background: COLORS.teal600, borderRadius: '16px', padding: '16px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  cursor: onNavigate ? 'pointer' : 'default', transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                }}
                onMouseEnter={onNavigate ? (e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.12)' } : undefined}
                onMouseLeave={onNavigate ? (e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' } : undefined}
              >
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{category}</span>
                <strong style={{ display: 'block', fontSize: '28px', fontWeight: 800, color: COLORS.white, marginTop: '8px' }}>{formatDuration(stats.totalMs / stats.count)}</strong>
                <span style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.75)', marginTop: '4px' }}>avg over {stats.count} job{stats.count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 1: Currently Clocked In */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Currently Clocked In</h2>
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: COLORS.slate500 }}>Live running timers. A red row means the job has been running past 8 hours — the builder may have forgotten to clock out.</p>

        {liveSessions.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Nobody is clocked in right now.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {liveSessions.map(row => {
            const elapsedMs = Date.now() - new Date(row.session.started_at).getTime()
            const overrun = elapsedMs > EIGHT_HOURS_MS
            const tooFar = row.clockInDistance != null && row.clockInDistance > distanceThresholdM
            const hasPin = row.session.clock_in_lat != null && row.session.clock_in_lng != null
            return (
              <div
                key={row.session.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                  borderRadius: '12px', padding: '12px 14px',
                  background: overrun ? COLORS.red50 : COLORS.teal50,
                  border: overrun ? `1px solid ${COLORS.red200}` : `1px solid ${COLORS.teal300}`,
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '13px', color: COLORS.slate900 }}>{row.builderName}</strong>
                  <span
                    onClick={onNavigate ? () => onNavigate('pipeline', { ticketNumber: row.ticket.ticket_number }) : undefined}
                    style={{ fontSize: '12px', color: onNavigate ? COLORS.blue700 : COLORS.slate500, cursor: onNavigate ? 'pointer' : 'default', fontWeight: onNavigate ? 600 : 400 }}
                  >
                    #{row.ticket.ticket_number} · {row.ticket.property?.address} — {row.ticket.room || '—'} → {row.ticket.description}
                  </span>
                  {overrun && (
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', fontWeight: 800, color: COLORS.red600 }}>
                      ⏱ Over 8h — check builder hasn't forgotten to clock out
                    </span>
                  )}
                  {tooFar && (
                    findDismissal(row.ticket.id, 'clock_in') ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: COLORS.slate400 }}>✓ Reviewed</span>
                        <button onClick={() => handleUndoDismiss(row.ticket.id)} style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}>
                          Undo
                        </button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: COLORS.red600 }}>
                          ⚠ Clocked in {formatDistanceMetres(row.clockInDistance)} from the property
                        </span>
                        <button onClick={() => handleDismissFlag(row.ticket.id, ['clock_in'])} style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textDecoration: 'underline', cursor: 'pointer' }}>
                          Dismiss
                        </button>
                      </span>
                    )
                  )}
                  {hasPin && (
                    <button
                      onClick={() => openPinMap(row.session.clock_in_lat, row.session.clock_in_lng)}
                      style={{ display: 'inline-block', marginTop: '4px', background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}
                    >
                      📍 View clock-in location
                    </button>
                  )}
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 800, color: overrun ? COLORS.red600 : COLORS.teal600, whiteSpace: 'nowrap' }}>
                  {formatDuration(elapsedMs)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Section 2: Today's Attendance -- the day-level shift, separate
          from the per-job sessions in Section 1 above. */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Today's Attendance</h2>
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: COLORS.slate500 }}>Day-level clock in/out. Builders can't see their jobs at all until they clock in for the day.</p>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
                <th style={thStyle}>Builder</th>
                <th style={thStyle}>Clocked In</th>
                <th style={thStyle}>Clocked Out</th>
                <th style={thStyle}>Daily Status</th>
                <th style={thStyle}>Right Now</th>
                <th style={thStyle}>Hours Today</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {attendanceRows.map(row => (
                <tr key={row.staffId} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <td style={tdStyle}>
                    {onNavigate ? (
                      <span
                        onClick={() => onNavigate('builders', { staffId: row.staffId })}
                        style={{ color: COLORS.blue700, fontWeight: 600, cursor: 'pointer' }}
                      >
                        {row.staffName}
                      </span>
                    ) : row.staffName}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {row.shift ? (
                      <>
                        {formatUKDateTime(row.shift.clock_in_at)}
                        {row.shift.late_flag && <span style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: COLORS.amber700 }}>⚠ {minutesLate(row.shift.clock_in_at, dailyClockInDeadline)}m late</span>}
                        {row.shift.clock_in_override && <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.slate400 }}>Manager override</span>}
                        {row.shift.clock_in_lat != null && row.shift.clock_in_lng != null && (
                          <button
                            onClick={() => openPinMap(row.shift.clock_in_lat, row.shift.clock_in_lng)}
                            style={{ display: 'block', marginTop: '2px', background: 'none', border: 'none', padding: 0, fontSize: '10px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer', fontFamily: 'system-ui' }}
                          >
                            📍 View location
                          </button>
                        )}
                      </>
                    ) : (
                      <span style={{ color: COLORS.slate300 }}>Not clocked in</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {row.shift?.clock_out_at
                      ? (
                        <>
                          {formatUKDateTime(row.shift.clock_out_at)}
                          {row.shift.early_leave_reason && (
                            <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.amber700, fontFamily: 'system-ui' }}>
                              ⚠ Left early: {row.shift.early_leave_reason}
                            </span>
                          )}
                          {row.shift.clock_out_override && <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.slate400 }}>Manager override</span>}
                          {row.shift.clock_out_lat != null && row.shift.clock_out_lng != null && (
                            <button
                              onClick={() => openPinMap(row.shift.clock_out_lat, row.shift.clock_out_lng)}
                              style={{ display: 'block', marginTop: '2px', background: 'none', border: 'none', padding: 0, fontSize: '10px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer', fontFamily: 'system-ui' }}
                            >
                              📍 View location
                            </button>
                          )}
                        </>
                      )
                      : row.shift
                        ? <span style={{ color: COLORS.teal600, fontWeight: 700, fontFamily: 'system-ui' }}>Still clocked in</span>
                        : <span style={{ color: COLORS.slate300 }}>—</span>}
                  </td>
                  <td style={tdStyle}>
                    {(() => {
                      const status = dailyStatusFor(row.shift)
                      return (
                        <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', color: status.color, background: status.bg }}>
                          {status.label}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={tdStyle}>
                    <span style={{
                      fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '999px',
                      color: row.currentStatus === 'Off shift' ? COLORS.slate400 : row.currentStatus.startsWith('On Job') ? COLORS.teal700 : row.currentStatus === 'Available' ? COLORS.blue700 : COLORS.violet600,
                      background: row.currentStatus === 'Off shift' ? COLORS.slate100 : row.currentStatus.startsWith('On Job') ? COLORS.teal50 : row.currentStatus === 'Available' ? COLORS.blue50 : COLORS.violet100,
                    }}>
                      {row.currentStatus}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 700, fontFamily: 'monospace' }}>{formatDuration(row.hoursTodayMs)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                      <button onClick={() => openHistoryModal(row.staffId, row.staffName)} style={actionBtnStyle}>History</button>
                      {row.shift && !row.shift.clock_out_at ? (
                        <button onClick={() => openOverrideModal('out', row)} style={actionBtnStyle}>Clock Out For Them</button>
                      ) : (
                        <button onClick={() => openOverrideModal('in', row)} style={actionBtnStyle}>Clock In For Them</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Completed Job Timesheet */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Completed Job Timesheet</h2>
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Clock-in, clock-out, total worked time and mileage per finished job. "Est." mileage is an approximate straight-line estimate (home, or the builder's previous job that day, to the property) -- not an exact route match.</p>
          </div>
          <select value={builderFilter} onChange={(e) => setBuilderFilter(e.target.value)} style={filterSelectStyle}>
            <option value="All">All builders</option>
            {builders.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
                {[
                  { key: 'job', label: 'Job' },
                  { key: 'builder', label: 'Builder' },
                  { key: 'clockIn', label: 'Clock-In' },
                  { key: 'clockOut', label: 'Clock-Out' },
                  { key: 'total', label: 'Total Time' },
                  { key: 'miles', label: 'Miles' },
                  { key: 'route', label: 'Route' },
                ].map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleCompletedSort(col.key)}
                    style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                  >
                    {col.label}
                    <span style={{ color: completedSortColumn === col.key ? COLORS.slate600 : COLORS.slate300 }}>
                      {' '}{completedSortColumn === col.key ? (completedSortDirection === 'asc' ? '▲' : '▼') : '↕'}
                    </span>
                  </th>
                ))}
                <th style={{ ...thStyle, textAlign: 'right' }}>Correct</th>
              </tr>
            </thead>
            <tbody>
              {sortedCompletedRows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: COLORS.slate400, fontWeight: 600 }}>
                    No completed jobs to show.
                  </td>
                </tr>
              )}
              {sortedCompletedRows.map(row => {
                const flaggedKinds = [
                  row.clockInDistance != null && row.clockInDistance > distanceThresholdM && 'clock_in',
                  row.clockOutDistance != null && row.clockOutDistance > distanceThresholdM && 'clock_out',
                ].filter(Boolean)
                const dismissRow = () => handleDismissFlag(row.ticket.id, flaggedKinds)
                const undoRow = () => handleUndoDismiss(row.ticket.id)
                return (
                <tr key={row.ticket.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <td
                    style={{ ...tdStyle, ...(onNavigate ? { cursor: 'pointer' } : {}) }}
                    onClick={onNavigate ? () => onNavigate('pipeline', { ticketNumber: row.ticket.ticket_number }) : undefined}
                  >
                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{row.ticket.ticket_number}</span>
                    <span style={{ display: 'block', fontWeight: 700, color: onNavigate ? COLORS.blue700 : COLORS.slate900 }}>{row.ticket.property?.address}</span>
                    <span style={{ display: 'block', fontSize: '12px', color: COLORS.slate500 }}>{row.ticket.room || '—'} → {row.ticket.description}</span>
                  </td>
                  <td style={tdStyle}>{row.builderName}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {formatUKDateTime(row.firstIn)}
                    <LocationCell
                      distance={row.clockInDistance} thresholdM={distanceThresholdM}
                      lat={row.firstSession.clock_in_lat} lng={row.firstSession.clock_in_lng} onOpenMap={openPinMap}
                      dismissal={findDismissal(row.ticket.id, 'clock_in')}
                      onDismiss={dismissRow}
                      onUndoDismiss={undoRow}
                    />
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {formatUKDateTime(row.lastOut)}
                    <LocationCell
                      distance={row.clockOutDistance} thresholdM={distanceThresholdM}
                      lat={row.lastSession.clock_out_lat} lng={row.lastSession.clock_out_lng} onOpenMap={openPinMap}
                      dismissal={findDismissal(row.ticket.id, 'clock_out')}
                      onDismiss={dismissRow}
                      onUndoDismiss={undoRow}
                    />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 800, color: COLORS.teal600, fontFamily: 'monospace' }}>
                    {formatDuration(row.totalMs)}
                    {row.sessions.length > 1 && (
                      <span style={{ display: 'block', fontSize: '10px', color: COLORS.slate400, fontWeight: 600 }}>{row.sessions.length} sessions</span>
                    )}
                    {row.ticket.estimated_minutes != null && (() => {
                      const estimatedMs = row.ticket.estimated_minutes * 60000
                      const over = row.totalMs > estimatedMs
                      // A job clocked in only right before finishing (worked
                      // off the clock, then tapped Clock In/Out a minute
                      // apart at the end) passes the GPS/distance checks
                      // just fine -- both taps are real, at the real
                      // property. The only thing that can catch it is
                      // "this took far less time than a job like this
                      // should," same idea as flagging an over-run, just
                      // the other direction. Under half the estimate is
                      // the same "clearly not just normal variation"
                      // threshold in spirit as the over-run side already
                      // used (any overrun at all).
                      const suspiciouslyShort = row.totalMs < estimatedMs * 0.5
                      return (
                        <span style={{ display: 'block', marginTop: '2px', fontSize: '10px', fontWeight: 700, color: over || suspiciouslyShort ? COLORS.red600 : COLORS.slate400 }}>
                          Est. {formatDuration(estimatedMs)}
                          {suspiciouslyShort && ' — much shorter than estimated, check they were clocked in the whole job'}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={tdStyle}>
                    {(row.ticket.mileage_logged || 0).toFixed(1)}
                    {row.estimatedMiles != null && (() => {
                      const actual = row.ticket.mileage_logged || 0
                      // Same "clearly not just normal variation" framing as
                      // the estimated-time flag above -- a builder logging
                      // 0 against a non-trivial estimated trip is the exact
                      // "forgot to fill it in" signature (see ticket #12).
                      const mismatch = actual === 0 ? row.estimatedMiles > 0.3 : Math.abs(actual - row.estimatedMiles) > Math.max(1, row.estimatedMiles * 0.5)
                      return (
                        <span style={{ display: 'block', marginTop: '2px', fontSize: '10px', fontWeight: 700, color: mismatch ? COLORS.red600 : COLORS.slate400 }}>
                          Est. {row.estimatedMiles.toFixed(1)}mi
                          {mismatch && ' — check against logged mileage'}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={tdStyle}>
                    {row.firstSession.clock_in_lat != null && row.firstSession.clock_in_lng != null && row.lastSession.clock_out_lat != null && row.lastSession.clock_out_lng != null ? (
                      <button
                        onClick={() => openRouteMap(row.firstSession.clock_in_lat, row.firstSession.clock_in_lng, row.lastSession.clock_out_lat, row.lastSession.clock_out_lng)}
                        style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}
                      >
                        🧭 Route
                      </button>
                    ) : (
                      <span style={{ fontSize: '11px', color: COLORS.slate300 }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button onClick={() => openEditModal(row)} style={actionBtnStyle}>Edit</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 4: Monthly Hours -- payroll-style rollup, summed from
          daily_attendance across the whole selected month. */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginTop: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Monthly Hours</h2>
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Total daily-attendance hours per builder for the selected month.</p>
          </div>
          <input
            type="month"
            value={monthlyMonth}
            onChange={(e) => setMonthlyMonth(e.target.value)}
            style={{ ...filterSelectStyle, cursor: 'pointer' }}
          />
        </div>

        {monthlyLoading ? (
          <p style={{ color: COLORS.slate400, fontWeight: 600, fontSize: '13px' }}>Loading...</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
                  <th style={thStyle}>Builder</th>
                  <th style={thStyle}>Days Worked</th>
                  <th style={thStyle}>Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ padding: '32px', textAlign: 'center', color: COLORS.slate400, fontWeight: 600 }}>No attendance recorded this month.</td>
                  </tr>
                )}
                {monthlyRows.map(r => (
                  <tr key={r.staffId} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                    <td style={tdStyle}>{r.staffName}</td>
                    <td style={tdStyle}>{r.daysWorked}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, fontFamily: 'monospace' }}>
                      {formatDuration(r.totalMs)}
                      {r.hasIncomplete && <span style={{ display: 'block', fontSize: '10px', fontWeight: 700, color: COLORS.amber700 }}>⚠ Has a shift with no clock-out -- excluded from total</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit clock times modal */}
      {editRow && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Correct Clock Times — Job #{editRow.ticket.ticket_number}</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>{editRow.ticket.property?.address}</p>

            <label style={modalLabelStyle}>Clock-In</label>
            <input
              type="datetime-local"
              value={editClockIn}
              onChange={(e) => setEditClockIn(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
            />

            <label style={modalLabelStyle}>Clock-Out</label>
            <input
              type="datetime-local"
              value={editClockOut}
              onChange={(e) => setEditClockOut(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
            />

            {editRow.sessions.length > 1 && (
              <p style={{ margin: '10px 0 0 0', fontSize: '12px', color: COLORS.slate400 }}>
                This job has {editRow.sessions.length} separate work sessions (paused/resumed). Only the very first clock-in and the very last clock-out are corrected here.
              </p>
            )}

            {editError && <p style={modalErrorStyle}>{editError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeEditModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitEdit} disabled={editSaving} style={{ ...modalConfirmBtnStyle, opacity: editSaving ? 0.6 : 1, cursor: editSaving ? 'not-allowed' : 'pointer' }}>
                {editSaving ? 'Saving...' : 'Save Correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {overrideModal && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>{overrideModal.mode === 'in' ? 'Clock In' : 'Clock Out'} — {overrideModal.staffName}</p>
            <p style={{ margin: '2px 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>
              For when they genuinely can't do it themselves (dead phone, no signal, etc.) -- add a reason so there's a record of why.
            </p>

            <label style={modalLabelStyle}>Reason</label>
            <textarea
              value={overrideNote}
              onChange={(e) => setOverrideNote(e.target.value)}
              placeholder="e.g. Phone dead, called in at 8:50am"
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />

            {overrideError && <p style={modalErrorStyle}>{overrideError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeOverrideModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitOverride} disabled={overrideSaving} style={{ ...modalConfirmBtnStyle, opacity: overrideSaving ? 0.6 : 1, cursor: overrideSaving ? 'not-allowed' : 'pointer' }}>
                {overrideSaving ? 'Saving...' : `Confirm ${overrideModal.mode === 'in' ? 'Clock In' : 'Clock Out'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {historyModal && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Attendance Log — {historyModal.staffName}</p>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '10px 0 4px 0' }}>
              <button
                onClick={() => setHistoryDate(prev => shiftDateKey(prev, -1))}
                style={{ ...actionBtnStyle, padding: '6px 10px' }}
              >
                ← Prev day
              </button>
              <input
                type="date"
                value={historyDate}
                max={ukDateKey()}
                onChange={(e) => setHistoryDate(e.target.value)}
                style={{ flex: 1, height: '36px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
              />
              <button
                onClick={() => setHistoryDate(prev => shiftDateKey(prev, 1))}
                disabled={historyDate >= ukDateKey()}
                style={{ ...actionBtnStyle, padding: '6px 10px', opacity: historyDate >= ukDateKey() ? 0.4 : 1, cursor: historyDate >= ukDateKey() ? 'not-allowed' : 'pointer' }}
              >
                Next day →
              </button>
            </div>

            {historyLoading ? (
              <p style={{ margin: '14px 0', fontSize: '13px', color: COLORS.slate400, fontWeight: 600 }}>Loading...</p>
            ) : (() => {
              const events = []
              historyShifts.forEach(shift => {
                events.push({
                  time: shift.clock_in_at,
                  label: shift.clock_in_override ? 'Clocked in for the day (manager override)' : 'Clocked in for the day',
                  tone: shift.late_flag ? 'late' : 'in',
                  lat: shift.clock_in_lat,
                  lng: shift.clock_in_lng,
                })
                if (shift.late_flag) events[events.length - 1].label += ` — ${minutesLate(shift.clock_in_at, dailyClockInDeadline)}m late`
                if (shift.clock_out_at) {
                  events.push({
                    time: shift.clock_out_at,
                    label: shift.early_leave_reason
                      ? `Clocked out for the day — left early: ${shift.early_leave_reason}`
                      : shift.clock_out_override ? 'Clocked out for the day (manager override)' : 'Clocked out for the day',
                    tone: shift.early_leave_reason ? 'early' : 'out',
                    lat: shift.clock_out_lat,
                    lng: shift.clock_out_lng,
                  })
                }
              })
              historyActivity.forEach(a => {
                const verb = a.activity_type === 'Travel' ? 'Left site' : 'Started break'
                const backVerb = a.activity_type === 'Travel' ? 'Returned to site' : 'Back from break'
                events.push({ time: a.started_at, label: `${verb}${a.note ? `: ${a.note}` : ''}`, tone: 'away', ticketNumber: a.destinationTicketNumber })
                if (a.ended_at) events.push({ time: a.ended_at, label: backVerb, tone: 'back' })
              })
              historyJobEvents.forEach(a => {
                const tone = a.summary.includes('Completed') ? 'done'
                  : a.summary.includes('On Hold') ? 'hold'
                  : a.summary.includes("couldn't get access") ? 'noAccess'
                  : 'job'
                events.push({ time: a.created_at, label: a.summary, tone, ticketNumber: a.ticketNumber })
              })
              events.sort((a, b) => new Date(a.time) - new Date(b.time))

              if (events.length === 0) return <p style={{ margin: '14px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Nothing logged that day.</p>

              const toneColor = { away: COLORS.violet600, early: COLORS.amber700, late: COLORS.amber700, hold: COLORS.amber700, noAccess: COLORS.red600, done: COLORS.green600, job: COLORS.teal700 }

              return (
                <div style={{ margin: '14px 0', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {events.map((e, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'baseline' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px', color: COLORS.slate400, flexShrink: 0, width: '52px' }}>
                        {formatUKDateTime(e.time).split(' ').slice(-1)[0]}
                      </span>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: toneColor[e.tone] || COLORS.slate900 }}>
                        {e.label}
                        {e.ticketNumber != null && (
                          <span
                            onClick={onNavigate ? () => onNavigate('pipeline', { ticketNumber: e.ticketNumber }) : undefined}
                            style={{ color: COLORS.blue700, cursor: onNavigate ? 'pointer' : 'default' }}
                          >
                            {' '}(Job #{e.ticketNumber})
                          </span>
                        )}
                        {e.lat != null && e.lng != null && (
                          <button
                            onClick={() => openPinMap(e.lat, e.lng)}
                            style={{ display: 'block', marginTop: '2px', background: 'none', border: 'none', padding: 0, fontSize: '11px', fontWeight: 700, color: COLORS.blue700, cursor: 'pointer' }}
                          >
                            📍 View location
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })()}
            <button onClick={closeHistoryModal} style={{ ...modalConfirmBtnStyle, width: '100%' }}>Close</button>
          </div>
        </div>
      )}

      {/* Map / route modal -- Google's free query-string embed, no API
          key or billing, shown in-app instead of sending the manager to
          a new tab. */}
      {mapModal && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: '640px' }}>
            <p style={modalTitleStyle}>{mapModal.mode === 'route' ? 'Clock-In → Clock-Out Route' : 'Location'}</p>
            {mapModal.mode === 'route' && (
              <p style={{ margin: '2px 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>
                Estimated straight-line distance: <strong>{mapModal.distanceMiles.toFixed(2)} miles</strong>
              </p>
            )}
            <iframe
              title="Map"
              src={mapModal.embedUrl}
              width="100%"
              height="400"
              style={{ border: 0, borderRadius: '10px', marginTop: mapModal.mode === 'route' ? 0 : '12px' }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
            <div style={{ display: 'flex', marginTop: '16px' }}>
              <button onClick={() => setMapModal(null)} style={{ ...modalCancelBtnStyle, width: '100%' }}>Close</button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
