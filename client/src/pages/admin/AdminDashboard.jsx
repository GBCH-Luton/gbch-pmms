import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { priorityTierLabel, fetchFlaggedClockingCount, isTicketStuck, KpiTiles, fetchComplianceAgingCounts, fetchVoidAgingCounts, fetchGardenReviewAging, fetchHousekeepingCounts, computeAvgResponseMs, formatDuration, fetchPriorityThresholds, fetchAssignableBuilders, fetchAssignableStaffForDivision, fetchAssignableStaffForRole, fetchLastEndedSessionsToday, ukDateKey, formatUKDateTime, minutesLate, SHORT_TRIP_REASONS, activityCategoryMeta, ACTIVITY_CATEGORY_META, LANDLORD_LIAISON_PAGE_ENABLED } from './shared'
import { NavIcon } from '../../lib/icons'
import { googleMapsLink } from '../../lib/geo'

// Lazy -- pulls in Leaflet (a real map-tile/JS dependency), only worth
// loading once someone actually clicks the map pin, not on every visit to
// a dashboard every admin/manager sees by default.
const StaffLocationsMapModal = lazy(() => import('../../components/StaffLocationsMapModal'))

const DEFAULT_NEW_PROPERTY_WINDOW_HOURS = 48

// Collapsed/expanded state is deliberately session-only, not persisted --
// every page load/refresh always comes back to the same layout (Ticket
// Pipeline open, everything else collapsed), regardless of what an admin
// clicked open or closed last time they were here.
// alertCount only ever renders while collapsed: the point is to let an
// admin collapse a normally-quiet section without silently losing sight
// of it if something in it later needs attention.
function DashboardSection({ id, title, background, alertCount = 0, defaultCollapsed = false, children }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  function toggle() {
    setCollapsed(prev => !prev)
  }

  return (
    <div style={{ borderRadius: '16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
      <div
        onClick={toggle}
        data-dashboard-section={id}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
          padding: 'clamp(8px, 1vw, 10px) clamp(14px, 2vw, 20px)', cursor: 'pointer', userSelect: 'none',
          background: COLORS.sectionHeaderBg, borderBottom: `1px solid ${COLORS.slate200}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <p style={{ margin: 0, fontSize: 'clamp(12px, 1vw, 13px)', fontWeight: 600, color: COLORS.slate900 }}>{title}</p>
          {collapsed && alertCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '20px', height: '20px',
              padding: '0 6px', borderRadius: '20px', background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
            }}>
              {alertCount}
            </span>
          )}
        </div>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', flexShrink: 0,
          color: COLORS.slate500, transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(-90deg)' : 'none',
        }}>▾</span>
      </div>
      <div style={{ display: 'grid', gridTemplateRows: collapsed ? '0fr' : '1fr', transition: 'grid-template-rows 0.22s ease' }}>
        <div style={{ overflow: 'hidden' }}>
          {/* alignItems: flex-start, explicit -- flex's own default
              (stretch) will inflate a single child to match whatever
              height this row's cross-axis ends up computing to, rather
              than the child's own natural content height, if anything
              upstream (the grid-rows transition wrapper above included)
              ever resolves an ambiguous/taller height. flex-start pins
              this to always be exactly the content's real height,
              regardless of what's going on further up the tree (found
              live -- a tall empty gap sat under Ticket Pipeline's tiles
              that no padding/margin value here could account for). */}
          <div style={{ background, display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', padding: 'clamp(12px, 2vw, 20px)' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

// Ranks flagged items first so what needs attention doesn't require
// scanning every section below; clicking any line jumps to and opens/closes
// that section by simply re-clicking its own header (see
// data-dashboard-section on DashboardSection above) rather than duplicating
// its toggle state here. Built entirely from the same numbers those
// sections already compute.
// Fixed height shared with TeamWhereabouts below, via the grid these two
// sit in together -- CSS Grid's stretch alignment only pads the SHORTER
// column up to match the taller one, it never caps the taller one, so a
// long team log needs an explicit height on both cards (not just grid
// stretch) to actually scroll internally instead of growing the row.
// Fallback only, used before the `dashboard_top_card_height_px` setting
// (AdminSettings.jsx's Dashboard Metrics section) has loaded -- both
// DailyBriefing and TeamWhereabouts below take an explicit `height` prop
// from the main AdminDashboard component once that setting resolves.
const DASHBOARD_TOP_CARD_HEIGHT = '250px'

// Shared fixed height for both cards' grey header band. Without this, the
// two bands render different heights (Where's the Team's header row also
// holds two <select> filters, which are taller than Daily Briefing's plain
// title text), so the border line under each header sits at a different
// vertical position even though the padding values match -- a fixed height
// plus centering the content inside it is what actually keeps the two
// borders level with each other.
const DASHBOARD_CARD_HEADER_HEIGHT = '58px'

// `height` defaults to matching TeamWhereabouts's fixed card height for the
// normal side-by-side split. When TeamWhereabouts is hidden entirely (see
// its Landlord Liaison gating below), there's nothing to match anymore --
// callers pass height="auto" instead so the card shrinks to fit its own
// content rather than staying stretched to a now-meaningless fixed height.
function DailyBriefing({ lines, height = DASHBOARD_TOP_CARD_HEIGHT }) {
  function handleLineClick(target) {
    const header = document.querySelector(`[data-dashboard-section="${target}"]`)
    if (!header) return
    header.click()
    // The section's expand is a CSS transition (see DashboardSection's
    // grid-template-rows), not instant -- scrolling right away measures
    // the still-collapsed height and lands exactly at the title, with the
    // content that's about to appear still below the fold. Wait for the
    // 220ms transition to finish, then scroll the header to the TOP of
    // the viewport (not 'nearest') so there's actually room below it to
    // see what's inside, even when the section sits at the bottom of the
    // page.
    setTimeout(() => {
      header.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 260)
  }

  const toneColour = { critical: COLORS.red600, warning: COLORS.amber600, followup: COLORS.violet600, quiet: COLORS.slate400 }

  return (
    <div style={{
      borderRadius: '16px', background: COLORS.white, overflow: 'hidden',
      border: `1px solid ${COLORS.slate200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      height, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: DASHBOARD_CARD_HEADER_HEIGHT, boxSizing: 'border-box', padding: '0 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <span style={{ color: COLORS.indigo700, display: 'flex' }}><NavIcon name="sunrise" size={16} /></span>
          <span style={{ fontSize: 'clamp(11px, 1vw, 12px)', fontWeight: 800, color: COLORS.indigo700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily Briefing</span>
        </div>
        <p style={{ margin: 0, fontSize: 'clamp(10px, 0.9vw, 11px)', color: COLORS.slate500 }}>
          What's worth a look across the dashboard this morning.
        </p>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 20px 12px' }}>
        {lines.map((line, i) => (
          <div
            key={i}
            onClick={() => handleLineClick(line.target)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', cursor: 'pointer',
              borderTop: i === 0 ? 'none' : `1px solid ${COLORS.slate100}`,
              opacity: line.tone === 'quiet' ? 0.6 : 1,
            }}
          >
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: toneColour[line.tone] }} />
            <span style={{ flex: 1, fontSize: '13px', color: COLORS.slate900, fontWeight: line.tone === 'quiet' ? 400 : 500 }}>{line.text}</span>
            <span style={{ fontSize: '12px', color: line.tone === 'quiet' ? COLORS.slate400 : COLORS.violet600, flexShrink: 0 }}>→</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Portfolio-wide "where is everyone right now, and what have they done
// today" -- sits alongside Daily Briefing rather than replacing anything
// on the Clocking page (AdminClocking.jsx's Today's Attendance table is
// the detailed/manager-override view; this is the at-a-glance dashboard
// version). Reads pmms.daily_attendance (day-level shift), pmms.work_sessions
// (per-job, for "On Job #N"), and pmms.activity_log (Leaving Site/I'm Back,
// each now carrying the ticket_id that was In Progress when the builder
// stepped away, so "left site"/"returned" can show which job it was).
function TeamWhereabouts({ profile, onNavigate, height = DASHBOARD_TOP_CARD_HEIGHT }) {
  const [loading, setLoading] = useState(true)
  const [builders, setBuilders] = useState([])
  const [statusByStaffId, setStatusByStaffId] = useState({})
  const [logEntries, setLogEntries] = useState([])
  const [filterStaffId, setFilterStaffId] = useState('All')
  const [divisionFilter, setDivisionFilter] = useState('All')
  const [mapModalOpen, setMapModalOpen] = useState(false)

  // Polled every 45s, same cadence and reasoning as BuilderDashboard.jsx's
  // own notifications/available-jobs polling -- nothing here pushes, so
  // this is the only way a manager sees a status change (a builder
  // starting a break, clocking in, etc.) without manually reloading the
  // page. isBackground skips the loading flip on repeat ticks so the whole
  // card doesn't flash back to "Loading..." every 45 seconds -- only the
  // very first load should ever show that.
  // Also refetches on tab-visibility change: Chrome/Edge throttle or fully
  // freeze setInterval in a backgrounded tab, so someone who leaves this
  // tab open and idle for a while won't see the 45s timer fire at all --
  // this catches it up the moment they switch back, without needing a
  // manual reload.
  useEffect(() => {
    fetchData()
    const interval = setInterval(() => fetchData(true), 45000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchData(true) }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  async function fetchData(isBackground = false) {
    if (!isBackground) setLoading(true)
    const assignableBuilders = await (profile.division ? fetchAssignableStaffForDivision(profile.division) : fetchAssignableBuilders())

    // Landlord Liaison Manager has her own daily clock-in/out (see
    // AdminDashboard.jsx's requiresDailyClocking gate) but no builder-level
    // role, so fetchAssignableStaffForDivision/fetchAssignableBuilders
    // above never include her -- merged in here instead. Everything below
    // (status computation, the attendance-derived log entries) already
    // works for her with zero further changes: she'll simply never have a
    // work_sessions/activity_log/on-hold-ticket row, so her status falls
    // straight through to the existing "clocked in, nothing else open" ->
    // Available branch, same as any builder between jobs.
    const clockingManagers = (!profile.division || profile.division === 'Landlord Liaison')
      ? (await fetchAssignableStaffForRole('Landlord Liaison Manager')).map(s => ({ ...s, division: 'Landlord Liaison' }))
      : []
    const allStaff = [...assignableBuilders, ...clockingManagers]
    setBuilders(allStaff)

    const todayKey = ukDateKey()

    const { data: deadlineRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'daily_clock_in_deadline')
      .maybeSingle()
    const deadline = deadlineRow?.setting_value || '09:00'

    const [{ data: attendanceData }, { data: activityData }, { data: openSessions }, { data: auditData }, { data: onHoldShortTrips }] = await Promise.all([
      supabase.schema('pmms').from('daily_attendance').select('id, staff_id, clock_in_at, late_flag, clock_out_at, early_leave_reason, clock_in_lat, clock_in_lng').or(`work_date.eq.${todayKey},clock_out_at.is.null`),
      supabase.schema('pmms').from('activity_log').select('id, staff_id, activity_type, activity_category, note, end_note, started_at, started_lat, started_lng, arrived_at, ended_at, ticket_id, destination_ticket_id, destination_property_id, mileage_logged').or(`started_at.gte.${todayKey}T00:00:00,ended_at.is.null`),
      supabase.schema('pmms').from('work_sessions').select('id, ticket_id, builder_id').is('ended_at', null),
      // Job start/resume/complete/pause/no-access events -- these were
      // previously invisible here entirely (this panel only ever read
      // daily_attendance + activity_log), even though every one of them
      // already gets a human-readable audit_events row from
      // BuilderDashboard.jsx's own postAuditEvent() calls. Filtered to
      // 'Status Changed' so a ticket comment doesn't show up as a
      // whereabouts event.
      supabase.schema('pmms').from('audit_events').select('id, actor_id, ticket_id, summary, created_at')
        .eq('action', 'Status Changed')
        .gte('created_at', `${todayKey}T00:00:00`)
        .in('actor_id', allStaff.map(b => b.id)),
      // Builder v2's Stop-sheet short trips (Lunch Break / Going to the
      // Office / Getting materials myself) end the work_session and don't
      // touch activity_log -- without this, a builder on one of these reads
      // as "Available" below instead of actually away.
      supabase.schema('pmms').from('tickets').select('id, ticket_number, assigned_builder_id, hold_reason, status_changed_at')
        .eq('status', 'On Hold')
        .in('hold_reason', SHORT_TRIP_REASONS),
    ])

    const ticketIds = [...new Set([
      ...(activityData || []).map(a => a.ticket_id).filter(Boolean),
      ...(activityData || []).map(a => a.destination_ticket_id).filter(Boolean),
      ...(openSessions || []).map(s => s.ticket_id),
      ...(auditData || []).map(a => a.ticket_id).filter(Boolean),
    ])]
    let ticketsById = {}
    if (ticketIds.length > 0) {
      const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, ticket_number, status, property_id').in('id', ticketIds)
      ticketsById = Object.fromEntries((ticketRows || []).map(t => [t.id, t]))
    }

    // Property coordinates, for the map -- covers both "on a job right
    // now" (that ticket's property) and "arrived at a property visit"
    // (Kathryn's Log a Visit destination_property_id). Everyone else's
    // location comes from a GPS fix already captured elsewhere (clock-in,
    // trip start, last job's clock-out), no property lookup needed.
    const propertyIds = [...new Set([
      ...Object.values(ticketsById).map(t => t.property_id).filter(Boolean),
      ...(activityData || []).map(a => a.destination_property_id).filter(Boolean),
    ])]
    let propertiesById = {}
    if (propertyIds.length > 0) {
      const { data: propertyRows } = await supabase.schema('pmms').from('properties').select('id, address, latitude, longitude').in('id', propertyIds)
      propertiesById = Object.fromEntries((propertyRows || []).map(p => [p.id, p]))
    }

    // "Available" on its own says nothing about how long, or where he was
    // last -- this is the same clock_out_lat/lng already saved the moment
    // any job ends (complete or pause), just not previously surfaced here.
    const lastEndedByBuilder = await fetchLastEndedSessionsToday(allStaff.map(b => b.id), todayKey)

    const statuses = {}
    allStaff.forEach(b => {
      const shift = (attendanceData || [])
        .filter(a => a.staff_id === b.id)
        .sort((x, y) => new Date(y.clock_in_at) - new Date(x.clock_in_at))[0]
      const openSession = (openSessions || []).find(s => s.builder_id === b.id)
      const openActivity = (activityData || []).find(a => a.staff_id === b.id && !a.ended_at)
      const shortTripTicket = (onHoldShortTrips || []).find(t => t.assigned_builder_id === b.id)

      let status = 'Off shift'
      let tone = 'off'
      // Availability overrides everything below, same reasoning as
      // computeDutyStatus (shared.jsx) -- someone marked On Leave/Sick
      // can't actually be working, even if an old shift/session is still
      // sitting open because nobody closed it out before they went off.
      if (b.availability === 'On Leave' || b.availability === 'Sick') {
        status = b.availability
        tone = 'leave'
      } else if (shift && !shift.clock_out_at) {
        if (openActivity) {
          // The pill itself only ever needs to say "Away" -- which
          // property/job/note they're away for is already in the
          // timeline log below, so cramming it into the pill too (as
          // this used to) just made it wrap/overflow. Tone still varies
          // by category (see toneDot/chipStyle below), so the colour
          // still hints at what kind of "away" it is even though the
          // text doesn't.
          status = 'Away'
          tone = openActivity.activity_category ? `away-${openActivity.activity_category}` : 'away'
        } else if (shortTripTicket) {
          status = 'Away'
          tone = 'away'
        } else if (openSession) {
          status = 'On Job'
          tone = 'job'
        } else {
          // "Idle" not "Available" -- this chip only ever appears for
          // someone already known to be on shift with nothing open (see
          // chipBuilders' off/leave filter below), so "Available" was
          // redundant with the section itself. How long and where they
          // were last seen now surface as an annotation on their most
          // recent log entry below instead of a second line on the chip.
          status = 'Idle'
          tone = 'available'
        }
      }

      let idleSince = null, idleLat = null, idleLng = null
      const lastEnded = lastEndedByBuilder[b.id]
      if (tone === 'available') {
        idleSince = lastEnded?.ended_at || shift?.clock_in_at || null
        idleLat = lastEnded?.clock_out_lat ?? null
        idleLng = lastEnded?.clock_out_lng ?? null
      }

      // Best available "where are they right now" for the map -- there's
      // no live tracking, so this is always a last-known fix: the
      // property they're actively on a job at, the property they've
      // arrived at on a visit, where their current trip started from, or
      // (idle) wherever their last job/clock-in put them. Falls back to
      // clock_in coordinates when idle and no job has ended yet today --
      // idleLat/idleLng above deliberately don't do this (that's the
      // "how long has he been idle" line, clock-in isn't an idle moment),
      // but the map still wants a pin for someone who's simply not done
      // anything yet.
      // mapAddress only ever comes from an actual property lookup (on a
      // job, or arrived at a visit) -- a GPS fix from clock-in/trip-start
      // is just coordinates, no address to show without reverse-geocoding
      // it, so it stays null and the map just won't show an address line.
      let mapLat = null, mapLng = null, mapAddress = null
      if (tone === 'job' && openSession) {
        const ticket = ticketsById[openSession.ticket_id]
        const property = ticket?.property_id ? propertiesById[ticket.property_id] : null
        mapLat = property?.latitude ?? null
        mapLng = property?.longitude ?? null
        mapAddress = property?.address ?? null
      } else if (openActivity) {
        const isOnSite = openActivity.activity_category === 'visit' && openActivity.arrived_at
        const destinationProperty = isOnSite && openActivity.destination_property_id ? propertiesById[openActivity.destination_property_id] : null
        mapLat = destinationProperty?.latitude ?? openActivity.started_lat ?? null
        mapLng = destinationProperty?.longitude ?? openActivity.started_lng ?? null
        mapAddress = destinationProperty?.address ?? null
      } else if (tone === 'available') {
        mapLat = idleLat ?? shift?.clock_in_lat ?? null
        mapLng = idleLng ?? shift?.clock_in_lng ?? null
      }

      statuses[b.id] = { status, tone, idleSince, idleLat, idleLng, mapLat, mapLng, mapAddress }
    })
    setStatusByStaffId(statuses)

    const entries = []
    ;(attendanceData || []).forEach(a => {
      const b = allStaff.find(x => x.id === a.staff_id)
      if (!b) return
      entries.push({
        id: `${a.id}-in`, time: a.clock_in_at, staffId: a.staff_id, staffName: b.name, tone: 'in',
        text: a.late_flag ? `clocked in (${minutesLate(a.clock_in_at, deadline)}m late)` : 'clocked in',
      })
      if (a.clock_out_at) {
        entries.push({
          id: `${a.id}-out`, time: a.clock_out_at, staffId: a.staff_id, staffName: b.name,
          tone: a.early_leave_reason ? 'early' : 'out',
          text: a.early_leave_reason ? `clocked out — left early: ${a.early_leave_reason}` : 'clocked out',
        })
      }
    })
    ;(activityData || []).forEach(a => {
      const b = allStaff.find(x => x.id === a.staff_id)
      if (!b) return
      const ticket = a.ticket_id ? ticketsById[a.ticket_id] : null
      // The destination they're heading to is the more useful jump target
      // on the "left site" line than the job they just stepped away from.
      const destinationTicket = a.destination_ticket_id ? ticketsById[a.destination_ticket_id] : null
      const meta = activityCategoryMeta(a.activity_type, a.activity_category)
      const entryTone = a.activity_category ? `away-${a.activity_category}` : 'away'
      entries.push({
        id: `${a.id}-start`, time: a.started_at, staffId: a.staff_id, staffName: b.name, tone: entryTone,
        text: `${meta.leftVerb}${a.note ? `: ${a.note}` : ''}`,
        ticketNumber: (destinationTicket ?? ticket)?.ticket_number,
      })
      // Property visits split into travel -> arrival -> finish -- arriveVerb
      // only exists on the 'visit' category meta, so this is a no-op for
      // every other category (builders' own included). Mileage is logged
      // at this exact moment (see Log a Visit's arrival step) but was
      // only ever surfaced in Clocking's own Travel & Visits rollup --
      // shown here too now so it's visible in the live feed, not just
      // the monthly summary.
      if (a.arrived_at && meta.arriveVerb) {
        entries.push({
          id: `${a.id}-arrive`, time: a.arrived_at, staffId: a.staff_id, staffName: b.name, tone: entryTone,
          text: `${meta.arriveVerb}${a.mileage_logged != null ? ` (${a.mileage_logged} mi)` : ''}`,
          ticketNumber: (destinationTicket ?? ticket)?.ticket_number,
        })
      }
      if (a.ended_at) {
        // "Going to Another Job" closes the same way whether he actually
        // tapped "I've arrived -- start work" (destination ticket moves
        // off Assigned/Pending) or just tapped the generic "I'm back"
        // also used for materials/lunch/office trips (ticket never
        // moves) -- both only ever set ended_at, so this used to always
        // read as "arrived on site" even when no work ever happened.
        // Distinguish using the destination ticket's current status
        // rather than assuming arrival always meant work started.
        const endText = a.activity_category === 'job'
          ? (destinationTicket && destinationTicket.status !== 'Assigned' && destinationTicket.status !== 'Pending'
            ? 'arrived and started work' : "came back — didn't start the job")
          : `${meta.backVerb}${a.end_note ? `: ${a.end_note}` : ''}`
        entries.push({
          id: `${a.id}-end`, time: a.ended_at, staffId: a.staff_id, staffName: b.name, tone: 'back',
          text: endText,
          // Same preference as the "left site" line above -- for a
          // 'job'-category trip the destination is the job they actually
          // arrived at, not whatever job (if any) they left from. Using
          // `ticket` alone here meant "arrived on site" showed no job
          // number at all whenever they'd been idle (not mid another job)
          // before heading out, since a.ticket_id is only ever set when a
          // job was in progress at the moment the trip started.
          ticketNumber: (destinationTicket ?? ticket)?.ticket_number,
        })
      }
    })
    ;(auditData || []).forEach(a => {
      const b = allStaff.find(x => x.id === a.actor_id)
      if (!b) return
      const ticket = a.ticket_id ? ticketsById[a.ticket_id] : null
      const tone = a.summary.includes('Completed') ? 'done'
        : a.summary.includes('On Hold') ? 'hold'
        : a.summary.includes("couldn't get access") ? 'noAccess'
        : 'job'
      entries.push({
        id: `${a.id}-audit`, time: a.created_at, staffId: a.actor_id, staffName: b.name, tone,
        text: a.summary, ticketNumber: ticket?.ticket_number,
      })
    })
    entries.sort((x, y) => new Date(y.time) - new Date(x.time))
    setLogEntries(entries.slice(0, 40))

    setLoading(false)
  }

  const toneDot = {
    in: COLORS.green600, out: COLORS.slate900, away: COLORS.violet600, back: COLORS.slate900, early: COLORS.amber700,
    job: COLORS.teal600, done: COLORS.green600, hold: COLORS.amber700, noAccess: COLORS.red600,
    ...Object.fromEntries(Object.entries(ACTIVITY_CATEGORY_META).map(([k, v]) => [`away-${k}`, v.dot])),
  }
  const chipStyle = {
    off: { bg: COLORS.slate100, fg: COLORS.slate400 }, available: { bg: COLORS.blue50, fg: COLORS.blue700 }, job: { bg: COLORS.teal50, fg: COLORS.teal700 }, away: { bg: COLORS.violet100, fg: COLORS.violet600 }, leave: { bg: COLORS.amber100, fg: COLORS.amber600 },
    ...Object.fromEntries(Object.entries(ACTIVITY_CATEGORY_META).map(([k, v]) => [`away-${k}`, { bg: v.chipBg, fg: v.chipFg }])),
  }

  // Division filter only makes sense for an unscoped viewer (Admin or a
  // manager with no division) -- a division-scoped manager's `builders`
  // list is already just their one division, same as Pipeline's own
  // division filter being hidden for scoped viewers.
  const divisionOptions = profile.division ? [] : [...new Set(builders.map(b => b.division).filter(Boolean))].sort()
  const divisionScopedBuilders = (!profile.division && divisionFilter !== 'All')
    ? builders.filter(b => b.division === divisionFilter)
    : builders

  const visibleBuilders = filterStaffId === 'All' ? divisionScopedBuilders : divisionScopedBuilders.filter(b => b.id === filterStaffId)
  const divisionScopedStaffIds = new Set(divisionScopedBuilders.map(b => b.id))
  const visibleEntries = filterStaffId === 'All'
    ? logEntries.filter(e => divisionScopedStaffIds.has(e.staffId))
    : logEntries.filter(e => e.staffId === filterStaffId)

  // The chip no longer shows idle duration/last-seen -- it now surfaces as
  // an annotation on whichever log entry made that person idle in the
  // first place (their last completed job, or their clock-in if they
  // haven't done a job yet today). logEntries is already sorted newest
  // first, so the first entry matching a given idle staffId is exactly
  // that entry, by construction -- idleSince is computed from the same
  // two sources (fetchLastEndedSessionsToday / shift.clock_in_at) that
  // produce those entries.
  const idleAnnotationByEntryId = {}
  visibleBuilders.forEach(b => {
    const s = statusByStaffId[b.id]
    if (s?.tone !== 'available' || !s.idleSince) return
    const match = logEntries.find(e => e.staffId === b.id)
    if (match) idleAnnotationByEntryId[match.id] = s
  })

  // The status-chip row is meant as "who's actually on shift right now" --
  // Off shift (never clocked in / already clocked out) and On Leave/Sick
  // clutter that with people who aren't part of today's picture. Only
  // applied to the passive "All builders" view -- explicitly picking one
  // person from the filter still shows them even if they're off/sick,
  // since that's a deliberate lookup, not the ambient overview.
  const chipBuilders = filterStaffId === 'All'
    ? visibleBuilders.filter(b => { const tone = (statusByStaffId[b.id] || {}).tone; return tone !== 'off' && tone !== 'leave' })
    : visibleBuilders

  // Same "who's actually on shift" set the chips already use -- the map
  // is a visualisation of that exact list, not a different scope. Staff
  // with no known fix yet (mapLat/mapLng null) are still included here;
  // the modal itself is what filters those out of the pin count.
  const staffLocations = chipBuilders.map(b => {
    const s = statusByStaffId[b.id] || { status: 'Off shift' }
    return { id: b.id, name: b.name, status: s.status, lat: s.mapLat, lng: s.mapLng, address: s.mapAddress }
  })

  return (
    <div style={{
      borderRadius: '16px', background: COLORS.white, overflow: 'hidden',
      border: `1px solid ${COLORS.slate200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      height, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ height: DASHBOARD_CARD_HEADER_HEIGHT, boxSizing: 'border-box', padding: '0 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center', background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
        {/* Title+subtitle live in their own column, kept separate from the
            filter dropdowns -- the selects render taller than the plain
            title text, and having them share one flex row with the title
            (like before) let their height push the title-to-subtitle gap
            open wider than Daily Briefing's. Nesting the subtitle under
            just the title here keeps that 4px gap identical regardless of
            what the selects do. */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <button
                onClick={() => setMapModalOpen(true)}
                title="See everyone's last known location on a map"
                style={{ background: 'none', border: 'none', padding: 0, margin: 0, color: COLORS.teal700, fontSize: '14px', lineHeight: 1, cursor: 'pointer' }}
              >
                📍
              </button>
              <span style={{ fontSize: 'clamp(11px, 1vw, 12px)', fontWeight: 800, color: COLORS.teal700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Where's the Team</span>
            </div>
            <p style={{ margin: 0, fontSize: 'clamp(10px, 0.9vw, 11px)', color: COLORS.slate500 }}>Live status and every trip logged today.</p>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {!profile.division && (
              <select
                value={divisionFilter}
                onChange={(e) => { setDivisionFilter(e.target.value); setFilterStaffId('All') }}
                style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}
              >
                <option value="All">All divisions</option>
                {divisionOptions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
            <select
              value={filterStaffId}
              onChange={(e) => setFilterStaffId(e.target.value)}
              style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}
            >
              <option value="All">All staff</option>
              {divisionScopedBuilders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '12px 20px 0' }}>
      {loading ? (
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontSize: '13px' }}>Loading...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '10px' }}>
            {chipBuilders.length === 0 && (
              <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>No one currently on shift.</p>
            )}
            {chipBuilders.map(b => {
              const s = statusByStaffId[b.id] || { status: 'Off shift', tone: 'off' }
              const c = chipStyle[s.tone]
              return (
                <div key={b.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '999px', background: c.bg, fontSize: '12px', fontWeight: 700 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c.fg }} />
                  <span
                    onClick={() => onNavigate?.('builders', { staffId: b.id })}
                    style={{ color: COLORS.slate900, cursor: onNavigate ? 'pointer' : 'default' }}
                  >
                    {b.name.split(' ')[0]}
                  </span>
                  <span style={{ color: c.fg }}>{s.status}</span>
                </div>
              )
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: '12px' }}>
            {visibleEntries.length === 0 && (
              <p style={{ fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>Nothing logged yet today.</p>
            )}
            {visibleEntries.map(e => (
              <div key={e.id} style={{ display: 'flex', gap: '10px', padding: '9px 0', borderTop: `1px solid ${COLORS.slate100}`, alignItems: 'flex-start' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '11px', color: COLORS.slate400, flexShrink: 0, width: '38px', paddingTop: '1px' }}>
                  {formatUKDateTime(e.time).split(' ').slice(-1)[0]}
                </span>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', marginTop: '5px', flexShrink: 0, background: toneDot[e.tone] }} />
                <div style={{ flex: 1 }}>
                  <span
                    onClick={() => onNavigate?.('builders', { staffId: e.staffId })}
                    style={{ fontSize: '12.5px', fontWeight: 700, color: COLORS.slate900, cursor: onNavigate ? 'pointer' : 'default' }}
                  >
                    {e.staffName}
                  </span>
                  <span style={{
                    fontSize: '12.5px',
                    color: (e.tone === 'early' || e.tone === 'hold') ? COLORS.amber700 : e.tone === 'noAccess' ? COLORS.red600 : COLORS.slate600,
                    fontWeight: (e.tone === 'early' || e.tone === 'hold' || e.tone === 'noAccess') ? 700 : 400,
                  }}> — {e.text}</span>
                  {e.ticketNumber != null && (
                    <span
                      onClick={() => onNavigate?.('pipeline', { ticketNumber: e.ticketNumber })}
                      style={{ fontSize: '12.5px', fontWeight: 700, color: COLORS.blue700, cursor: onNavigate ? 'pointer' : 'default' }}
                    >
                      {' '}(Job #{e.ticketNumber})
                    </span>
                  )}
                  {idleAnnotationByEntryId[e.id] && (
                    <span style={{ fontSize: '12px', color: COLORS.slate400, fontWeight: 600 }}>
                      {' '}&middot; idle {formatDuration(Date.now() - new Date(idleAnnotationByEntryId[e.id].idleSince).getTime())}
                      {idleAnnotationByEntryId[e.id].idleLat != null && idleAnnotationByEntryId[e.id].idleLng != null && (
                        <>
                          {' '}&middot;{' '}
                          <a
                            href={googleMapsLink(idleAnnotationByEntryId[e.id].idleLat, idleAnnotationByEntryId[e.id].idleLng)}
                            target="_blank" rel="noreferrer" style={{ color: COLORS.slate400 }}
                          >
                            📍 last seen
                          </a>
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      </div>

      {mapModalOpen && (
        <Suspense fallback={null}>
          <StaffLocationsMapModal open={mapModalOpen} onClose={() => setMapModalOpen(false)} staff={staffLocations} />
        </Suspense>
      )}
    </div>
  )
}

export default function AdminDashboard({ profile, onNavigate }) {
  const [tickets, setTickets] = useState([])
  const [newPropertiesCount, setNewPropertiesCount] = useState(0)
  const [totalPropertiesCount, setTotalPropertiesCount] = useState(0)
  const [procuredPropertiesCount, setProcuredPropertiesCount] = useState(0)
  const [livePropertiesCount, setLivePropertiesCount] = useState(0)
  const [clockedInCount, setClockedInCount] = useState(0)
  const [flaggedLocationsCount, setFlaggedLocationsCount] = useState(0)
  const [stuckThresholds, setStuckThresholds] = useState(null)
  const [complianceCounts, setComplianceCounts] = useState({ expired: 0, dueSoon: 0, noRecord: 0, valid: 0 })
  const [voidAgingCounts, setVoidAgingCounts] = useState({ overdue: 0, aging: 0, recent: 0 })
  const [gardenAgingCounts, setGardenAgingCounts] = useState({ overdue: 0, aging: 0, recent: 0 })
  const [housekeepingCounts, setHousekeepingCounts] = useState({ overdue: 0, dueSoon: 0, ok: 0, pendingDelays: 0 })
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [totalTicketsPeriod, setTotalTicketsPeriod] = useState('all_time')
  // Controls Daily Briefing/Where's the Team's shared card height (see
  // AdminSettings.jsx's Dashboard Metrics section) -- 250px default,
  // configurable so a division that barely uses one of the two cards
  // (e.g. Landlord Liaison, whose briefing/team list is short) isn't
  // stuck scrolling a mostly-empty tall card.
  const [topCardHeightPx, setTopCardHeightPx] = useState(250)
  const [loading, setLoading] = useState(true)

  // Daily Briefing / Where's the Team split, dragged via the handle
  // between them below -- persisted the same way the sidebar's collapsed
  // state already is (see client/src/pages/AdminDashboard.jsx), per
  // browser rather than per profile since it's a screen-layout preference,
  // not something that should follow someone between devices.
  const [briefingSplitPct, setBriefingSplitPct] = useState(() => {
    try { return Number(localStorage.getItem('pmms_dashboard_split_pct')) || 50 } catch { return 50 }
  })
  const [splitDragging, setSplitDragging] = useState(false)
  const splitContainerRef = useRef(null)

  function applySplitPct(pct) {
    const clamped = Math.max(30, Math.min(70, pct))
    setBriefingSplitPct(clamped)
    try { localStorage.setItem('pmms_dashboard_split_pct', String(clamped)) } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!splitDragging) return
    function onMove(clientX) {
      const rect = splitContainerRef.current?.getBoundingClientRect()
      if (!rect) return
      applySplitPct(((clientX - rect.left) / rect.width) * 100)
    }
    function onMouseMove(e) { onMove(e.clientX) }
    function onTouchMove(e) { if (e.touches[0]) onMove(e.touches[0].clientX) }
    function onUp() { setSplitDragging(false) }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('touchmove', onTouchMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchend', onUp)
    }
  }, [splitDragging])

  // Polled every 45s, same cadence and reasoning as BuilderDashboard.jsx's
  // own notifications/available-jobs polling -- nothing here pushes, so
  // this is the only way Daily Briefing (built entirely from this state)
  // reflects a change without a manual page reload. Doesn't re-flip
  // `loading` back to true on repeat ticks -- only fetchTickets ever sets
  // it, once, on the very first call.
  // Also refetches on tab-visibility change -- see the matching comment in
  // TeamWhereabouts above; a backgrounded/idle tab can silently miss every
  // 45s tick, so this catches it up the moment the tab is looked at again.
  useEffect(() => {
    refreshDashboardData()
    const interval = setInterval(refreshDashboardData, 45000)
    const onVisible = () => { if (document.visibilityState === 'visible') refreshDashboardData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  function refreshDashboardData() {
    fetchTickets()
    fetchPropertiesMetrics()
    fetchTotalPropertiesCount()
    fetchProcuredPropertiesCount()
    fetchLivePropertiesCount()
    fetchClockedInCount()
    fetchFlaggedClockingCount().then(setFlaggedLocationsCount)
    fetchStuckThresholds()
    fetchComplianceAgingCounts().then(setComplianceCounts)
    fetchVoidAgingCounts().then(setVoidAgingCounts)
    fetchGardenReviewAging().then(setGardenAgingCounts)
    fetchHousekeepingCounts().then(setHousekeepingCounts)
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchTotalTicketsPeriod()
    fetchTopCardHeight()
  }

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, status, category, created_at, completed_at, status_changed_at, first_assigned_at, priority_score, priority_override, mileage_logged, hold_reason, needs_followup')

    if (!error) setTickets(data)
    setLoading(false)
  }

  async function fetchStuckThresholds() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'stuck_ticket_thresholds')
      .maybeSingle()
    if (data?.setting_value) setStuckThresholds(data.setting_value)
  }

  async function fetchTotalTicketsPeriod() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'dashboard_total_tickets_period')
      .maybeSingle()
    if (data?.setting_value) setTotalTicketsPeriod(data.setting_value)
  }

  async function fetchTopCardHeight() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'dashboard_top_card_height_px')
      .maybeSingle()
    if (data?.setting_value != null) setTopCardHeightPx(Number(data.setting_value))
  }

  async function fetchPropertiesMetrics() {
    const { data: settingsRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'new_property_window_hours')
      .maybeSingle()

    const windowHours = settingsRow?.setting_value != null ? Number(settingsRow.setting_value) : DEFAULT_NEW_PROPERTY_WINDOW_HOURS
    const cutoff = new Date(Date.now() - windowHours * 3600000).toISOString()

    const { count } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', cutoff)

    setNewPropertiesCount(count || 0)
  }

  async function fetchTotalPropertiesCount() {
    // Excludes Internal (GBCH's own non-rental locations, e.g. the office)
    // -- not part of the rental portfolio this headline number represents.
    const { count } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'Internal')

    setTotalPropertiesCount(count || 0)
  }

  async function fetchProcuredPropertiesCount() {
    const { count } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Procured')

    setProcuredPropertiesCount(count || 0)
  }

  async function fetchLivePropertiesCount() {
    const { count } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Live')

    setLivePropertiesCount(count || 0)
  }

  async function fetchClockedInCount() {
    // Joins through tickets!inner rather than a plain count so this
    // naturally respects the same division-scoped RLS the Clocking page's
    // own "currently clocked in" list already goes through -- a
    // division-scoped manager can't read another division's ticket rows,
    // so a work_session tied to one drops out of the inner join instead
    // of inflating this tile's number with sessions the linked page won't
    // actually show them.
    const { count } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('id, tickets!inner(id)', { count: 'exact', head: true })
      .is('ended_at', null)

    setClockedInCount(count || 0)
  }

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  const getMonday = (d) => {
    const date = new Date(d)
    const day = date.getDay()
    const diff = date.getDate() - day + (day === 0 ? -6 : 1)
    date.setDate(diff)
    date.setHours(0, 0, 0, 0)
    return date
  }

  const now = new Date()
  const weekStart = getMonday(now)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const yearStart = new Date(now.getFullYear(), 0, 1)

  // Settings-controlled so "Total tickets" doesn't grow into an unwieldy
  // all-time number as the ticket history builds up -- see AdminSettings.jsx's
  // "Dashboard Metrics" section (dashboard_total_tickets_period).
  const TOTAL_TICKETS_PERIOD_LABELS = { today: 'Today', week: 'This Week', month: 'This Month', year: 'This Year', all_time: 'All Time' }
  // Excludes Cancelled/Archived same as Pipeline's own "All" status filter
  // does -- this tile's own statusFilter: 'All' below navigates straight
  // into that same filtered view, so counting them here just meant the
  // tile's number never matched what you landed on after clicking it
  // (found live 2026-08-12, via the same mismatch on Pipeline's own tile).
  const openTickets = tickets.filter(t => t.status !== 'Cancelled' && t.status !== 'Archived')
  const totalTicketsCount = (
    totalTicketsPeriod === 'today' ? openTickets.filter(t => isSameDay(new Date(t.created_at), now)) :
    totalTicketsPeriod === 'week' ? openTickets.filter(t => new Date(t.created_at) >= weekStart) :
    totalTicketsPeriod === 'month' ? openTickets.filter(t => new Date(t.created_at) >= monthStart) :
    totalTicketsPeriod === 'year' ? openTickets.filter(t => new Date(t.created_at) >= yearStart) :
    openTickets
  ).length

  const kpis = [
    { label: `Total Tickets (${TOTAL_TICKETS_PERIOD_LABELS[totalTicketsPeriod] || 'All Time'})`, value: totalTicketsCount, colour: COLORS.slate500, statusFilter: 'All' },
    { label: 'Unassigned', value: tickets.filter(t => t.status === 'Pending').length, colour: COLORS.red600, statusFilter: 'Pending' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, colour: COLORS.teal600, statusFilter: 'In Progress' },
    { label: 'On Hold', value: tickets.filter(t => t.status === 'On Hold').length, colour: COLORS.amber500, statusFilter: 'On Hold' },
    // Builder v.2's "Stop" sheet flags a job this way when a builder can't
    // do it for any reason -- it's still just an On Hold ticket underneath
    // (hold_reason is the only thing that marks it out), but it needs its
    // own tile so it can't get lost among ordinary materials/lunch pauses:
    // this is the one On Hold reason that needs a manager to actually act
    // (reassign), not just wait.
    { label: 'Unable to Do', value: tickets.filter(t => t.status === 'On Hold' && t.hold_reason === 'Unable to Do the Job').length, colour: COLORS.red600, statusFilter: 'On Hold' },
    // 'Completed' alone undercounts -- a signed-off job moves to 'Archived',
    // so a job finished this morning and signed off by lunchtime would drop
    // out of this tile entirely even though it's very much still completed
    // (found live: 2 real completions, tile showed 1 because one had
    // already been signed off). 'CompletedAll' is a Pipeline-only sentinel
    // status value (see AdminPipeline.jsx) that matches both, so the number
    // shown here always equals what you land on after clicking the tile.
    { label: 'Completed', value: tickets.filter(t => t.status === 'Completed' || t.status === 'Archived').length, colour: COLORS.green600, statusFilter: 'CompletedAll' },
    {
      // Matches the Pipeline page's own "effective tier" logic exactly
      // (priority_override wins over the raw score) so this count always
      // equals the number of rows you land on after clicking the tile.
      label: 'P1 Critical',
      value: tickets.filter(t => (t.priority_override || priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)) === 'P1 Critical').length,
      colour: COLORS.red600,
      statusFilter: 'All',
      priorityFilter: 'P1 Critical',
    },
    {
      label: 'Stuck',
      value: tickets.filter(t => isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)).length,
      colour: COLORS.red600,
      statusFilter: 'All',
      stuckOnly: true,
    },
    {
      label: 'Needs Follow-up',
      value: tickets.filter(t => t.needs_followup).length,
      colour: COLORS.violet500,
      statusFilter: 'All',
      needsFollowupOnly: true,
    },
  ]

  const completedTickets = tickets.filter(t => (t.status === 'Completed' || t.status === 'Archived') && t.completed_at)

  const completionKpis = [
    { label: 'Today', value: completedTickets.filter(t => isSameDay(new Date(t.completed_at), now)).length },
    { label: 'This Week', value: completedTickets.filter(t => new Date(t.completed_at) >= weekStart).length },
    { label: 'This Month', value: completedTickets.filter(t => new Date(t.completed_at) >= monthStart).length },
  ].map(kpi => ({ ...kpi, statusFilter: 'CompletedAll' }))

  const complianceKpis = [
    { label: 'Expired Certs', value: complianceCounts.expired, colour: COLORS.red600, tierFilter: 'Expired' },
    { label: 'Due Soon', value: complianceCounts.dueSoon, colour: COLORS.amber600, tierFilter: 'Due Soon' },
    { label: 'No Record', value: complianceCounts.noRecord, colour: COLORS.slate400, tierFilter: 'No Record' },
  ]

  const voidAgingKpis = [
    { label: 'Overdue Voids', value: voidAgingCounts.overdue, colour: COLORS.red600, tierFilter: 'Overdue' },
    { label: 'Aging Voids', value: voidAgingCounts.aging, colour: COLORS.amber600, tierFilter: 'Aging' },
    { label: 'Recent Voids', value: voidAgingCounts.recent, colour: COLORS.green600, tierFilter: 'Recent' },
  ]

  const gardenAgingKpis = [
    { label: 'Overdue Gardens', value: gardenAgingCounts.overdue, colour: COLORS.red600 },
    { label: 'Due Soon', value: gardenAgingCounts.aging, colour: COLORS.amber600 },
    { label: 'Recently Attended', value: gardenAgingCounts.recent, colour: COLORS.green600 },
  ]

  const housekeepingKpis = [
    { label: 'Overdue Visits', value: housekeepingCounts.overdue, colour: COLORS.red600 },
    { label: 'Due Soon', value: housekeepingCounts.dueSoon, colour: COLORS.amber600 },
    { label: 'Pending Delay Reasons', value: housekeepingCounts.pendingDelays, colour: COLORS.amber600 },
  ]

  const landlordLiaisonTickets = tickets.filter(t => t.category === 'Landlord Liaison')
  const landlordLiaisonOpenCount = landlordLiaisonTickets.filter(t => t.status !== 'Completed' && t.status !== 'Archived' && t.status !== 'Cancelled').length
  const landlordLiaisonUnassignedCount = landlordLiaisonTickets.filter(t => t.status === 'Pending').length

  const landlordLiaisonKpis = [
    { label: 'Open', value: landlordLiaisonOpenCount, colour: COLORS.indigo700 },
    { label: 'Unassigned', value: landlordLiaisonUnassignedCount, colour: COLORS.red600 },
  ]

  const pendingSignOffCount = tickets.filter(t => t.status === 'Completed').length

  const fleetMileageThisMonth = tickets
    .filter(t => t.completed_at && new Date(t.completed_at) >= monthStart)
    .reduce((sum, t) => sum + (t.mileage_logged || 0), 0)

  const avgResponseMs = computeAvgResponseMs(tickets)

  // Same visibility rules as the sections themselves below -- a line for a
  // section this profile can't see (and couldn't click through to) would
  // just be confusing.
  const complianceVisible = !profile.division || profile.division === 'Compliance'
  // Admin/unscoped Maintenance Manager oversight only, not the Landlord
  // Liaison Manager herself -- same reasoning as housekeepingVisible below.
  const landlordLiaisonVisible = LANDLORD_LIAISON_PAGE_ENABLED && !profile.division
  const voidGardensVisible = !profile.division
  // Admin/unscoped Maintenance Manager oversight only -- the Housekeeping
  // Manager already gets this same information (plus much more detail) on
  // her own dedicated page, so it isn't repeated on her own dashboard,
  // same reasoning as Void Aging/Gardens being Maintenance-only.
  const housekeepingVisible = !profile.division

  // Mirrors every red-coloured Pipeline KPI tile exactly (see kpis above)
  // rather than a narrower hand-picked metric -- a tile showing red on the
  // dashboard with no matching line here was exactly the gap that left a
  // real unassigned backlog invisible in the briefing (only its P1 subset
  // was ever checked).
  const unassignedCount = kpis.find(k => k.label === 'Unassigned')?.value || 0
  const p1CriticalCount = kpis.find(k => k.label === 'P1 Critical')?.value || 0
  const unableToDoCount = kpis.find(k => k.label === 'Unable to Do')?.value || 0
  const stuckCount = kpis.find(k => k.label === 'Stuck')?.value || 0
  const needsFollowupCount = kpis.find(k => k.label === 'Needs Follow-up')?.value || 0
  const completedToday = completionKpis.find(k => k.label === 'Today')?.value || 0
  const completedThisMonth = completionKpis.find(k => k.label === 'This Month')?.value || 0

  const flaggedLines = []
  const quietLines = []

  if (stuckCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{stuckCount} ticket{stuckCount === 1 ? '' : 's'}</b> {stuckCount === 1 ? 'is' : 'are'} stuck — no update in longer than usual, worth a check.</> })
  if (unassignedCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{unassignedCount} ticket{unassignedCount === 1 ? '' : 's'}</b> {unassignedCount === 1 ? 'is' : 'are'} still unassigned.</> })
  if (p1CriticalCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{p1CriticalCount} P1 Critical ticket{p1CriticalCount === 1 ? '' : 's'}</b> {p1CriticalCount === 1 ? 'needs' : 'need'} attention.</> })
  if (unableToDoCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'warning', text: <><b>{unableToDoCount} job{unableToDoCount === 1 ? '' : 's'}</b> {unableToDoCount === 1 ? 'was' : 'were'} flagged as unable to do — needs reassigning.</> })
  if (needsFollowupCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'followup', text: <><b>{needsFollowupCount} completed job{needsFollowupCount === 1 ? '' : 's'}</b> {needsFollowupCount === 1 ? 'needs' : 'need'} a follow-up.</> })
  if (stuckCount === 0 && unassignedCount === 0 && p1CriticalCount === 0 && unableToDoCount === 0 && needsFollowupCount === 0) quietLines.push({ target: 'pipeline', tone: 'quiet', text: <>Ticket Pipeline — no updates. {totalTicketsCount} total, {completedToday} completed today.</> })

  if (complianceVisible) {
    if (complianceCounts.expired > 0) flaggedLines.push({ target: 'compliance', tone: 'warning', text: <><b>{complianceCounts.expired} compliance certificate{complianceCounts.expired === 1 ? '' : 's'}</b> {complianceCounts.expired === 1 ? 'has' : 'have'} expired.</> })
    else quietLines.push({ target: 'compliance', tone: 'quiet', text: <>Compliance — no updates. {complianceCounts.dueSoon} due soon.</> })
  }

  if (landlordLiaisonVisible) {
    if (landlordLiaisonUnassignedCount > 0) flaggedLines.push({ target: 'landlord-liaison', tone: 'warning', text: <><b>{landlordLiaisonUnassignedCount} Landlord Liaison ticket{landlordLiaisonUnassignedCount === 1 ? '' : 's'}</b> {landlordLiaisonUnassignedCount === 1 ? 'is' : 'are'} still unassigned.</> })
    else quietLines.push({ target: 'landlord-liaison', tone: 'quiet', text: <>Landlord Liaison — no updates. {landlordLiaisonOpenCount} open.</> })
  }

  if (voidGardensVisible) {
    if (voidAgingCounts.overdue > 0) flaggedLines.push({ target: 'void-aging', tone: 'warning', text: <><b>{voidAgingCounts.overdue} void room{voidAgingCounts.overdue === 1 ? '' : 's'}</b> {voidAgingCounts.overdue === 1 ? 'is' : 'are'} overdue for turnaround.</> })
    else quietLines.push({ target: 'void-aging', tone: 'quiet', text: <>Void Aging — no updates. {voidAgingCounts.aging} aging, nothing overdue.</> })

    if (gardenAgingCounts.overdue > 0) flaggedLines.push({ target: 'gardens', tone: 'warning', text: <><b>{gardenAgingCounts.overdue} garden{gardenAgingCounts.overdue === 1 ? '' : 's'}</b> {gardenAgingCounts.overdue === 1 ? 'is' : 'are'} overdue for attention.</> })
    else quietLines.push({ target: 'gardens', tone: 'quiet', text: <>Gardens — no updates. {gardenAgingCounts.aging} due soon, nothing overdue.</> })
  }

  if (housekeepingVisible) {
    if (housekeepingCounts.overdue > 0) flaggedLines.push({ target: 'housekeeping-summary', tone: 'warning', text: <><b>{housekeepingCounts.overdue} routine visit{housekeepingCounts.overdue === 1 ? '' : 's'}</b> {housekeepingCounts.overdue === 1 ? 'is' : 'are'} overdue.</> })
    else if (housekeepingCounts.pendingDelays > 0) flaggedLines.push({ target: 'housekeeping-summary', tone: 'warning', text: <><b>{housekeepingCounts.pendingDelays} delay reason{housekeepingCounts.pendingDelays === 1 ? '' : 's'}</b> {housekeepingCounts.pendingDelays === 1 ? 'needs' : 'need'} review.</> })
    else quietLines.push({ target: 'housekeeping-summary', tone: 'quiet', text: <>Housekeeping — no updates. {housekeepingCounts.dueSoon} due soon.</> })
  }

  quietLines.push({ target: 'properties', tone: 'quiet', text: <>Properties — no updates. {totalPropertiesCount} total, {newPropertiesCount} new recently.</> })
  quietLines.push({ target: 'jobs-completed', tone: 'quiet', text: <>Jobs Completed — no updates. {completedThisMonth} this month.</> })

  if (pendingSignOffCount > 0) flaggedLines.push({ target: 'sign-off-mileage', tone: 'warning', text: <><b>{pendingSignOffCount} job{pendingSignOffCount === 1 ? '' : 's'}</b> {pendingSignOffCount === 1 ? 'is' : 'are'} waiting to be signed off.</> })
  if (flaggedLocationsCount > 0) flaggedLines.push({ target: 'sign-off-mileage', tone: 'warning', text: <><b>{flaggedLocationsCount} clocking location{flaggedLocationsCount === 1 ? '' : 's'}</b> flagged for review.</> })
  if (pendingSignOffCount === 0 && flaggedLocationsCount === 0) quietLines.push({ target: 'sign-off-mileage', tone: 'quiet', text: <>Sign-Off &amp; Mileage — no updates.</> })

  const briefingLines = [...flaggedLines, ...quietLines]

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading tickets...</p>
    </div>
  )

  return (
    <div>
      {/* Where's the Team is builder-clocking/activity focused -- neither
          Landlord Liaison nor Compliance manage builders, so it's hidden
          (not removed) for those two divisions. If either division's
          headcount grows into managing staff of their own, drop this
          condition for that division. With nothing to split against,
          Daily Briefing runs standalone and height="auto" so it shrinks
          to its own content instead of staying stretched to the fixed
          height it used to share with TeamWhereabouts. */}
      {(profile.division === 'Compliance') ? (
        <div style={{ marginBottom: '16px' }}>
          <DailyBriefing lines={briefingLines} height="auto" />
        </div>
      ) : (
        // Below 900px there's no meaningful side-by-side left to adjust --
        // dashboard-split-panel/-handle in index.css switch this to a
        // stacked, full-width, un-draggable layout instead (same convention
        // as admin-sidebar-desktop/admin-mobile-topbar there: plain inline
        // styles can't express a breakpoint, so this one responsive toggle
        // lives in that stylesheet).
        <div ref={splitContainerRef} className="dashboard-split" style={{ display: 'flex', alignItems: 'stretch', gap: 0, marginBottom: '16px' }}>
          <div className="dashboard-split-panel" style={{ flex: `0 0 ${briefingSplitPct}%`, minWidth: 0 }}>
            <DailyBriefing lines={briefingLines} height={`${topCardHeightPx}px`} />
          </div>
          <div
            className="dashboard-split-handle"
            onMouseDown={() => setSplitDragging(true)}
            onTouchStart={() => setSplitDragging(true)}
            onDoubleClick={() => applySplitPct(50)}
            title="Drag to resize -- double-click to reset"
            style={{ flexShrink: 0, width: '14px', cursor: 'col-resize', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div style={{ width: '4px', height: '40px', borderRadius: '999px', background: splitDragging ? COLORS.teal700 : COLORS.slate200 }} />
          </div>
          <div className="dashboard-split-panel" style={{ flex: `1 1 ${100 - briefingSplitPct}%`, minWidth: 0 }}>
            <TeamWhereabouts profile={profile} onNavigate={onNavigate} height={`${topCardHeightPx}px`} />
          </div>
        </div>
      )}

      <DashboardSection id="pipeline" title="Ticket Pipeline" background={COLORS.white} alertCount={kpis.find(k => k.label === 'Stuck')?.value || 0}>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={kpis}
            columns={5}
            onTileClick={(kpi) => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter, priorityFilter: kpi.priorityFilter, stuckOnly: kpi.stuckOnly, needsFollowupOnly: kpi.needsFollowupOnly })}
          />
        </div>
      </DashboardSection>

      <DashboardSection id="properties" title="Properties" background={COLORS.white} defaultCollapsed>
        <button
          onClick={() => onNavigate?.('properties')}
          style={{
            flex: '1 1 220px', background: COLORS.blue600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Properties</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{totalPropertiesCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('properties', { filterMode: 'newProperties' })}
          style={{
            flex: '1 1 220px', background: COLORS.teal700, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Properties</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{newPropertiesCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('properties', { filterMode: 'procured' })}
          style={{
            flex: '1 1 220px', background: COLORS.slate500, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Procured</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{procuredPropertiesCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('properties', { filterMode: 'live' })}
          style={{
            flex: '1 1 220px', background: COLORS.green600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{livePropertiesCount}</p>
        </button>
      </DashboardSection>

      {/* Compliance is relevant to an unscoped (Maintenance) manager and to
          Compliance Manager alike -- only Housekeeping/other divisions
          don't need it. Void Aging and Gardens are Maintenance-only. */}
      {(!profile.division || profile.division === 'Compliance') && (
        <DashboardSection id="compliance" title="Compliance" background={COLORS.white} alertCount={complianceCounts.expired} defaultCollapsed>
          <div style={{ width: '100%' }}>
            <KpiTiles
              kpis={complianceKpis}
              onTileClick={(kpi) => onNavigate?.('compliance', { tierFilter: kpi.tierFilter })}
            />
          </div>
        </DashboardSection>
      )}

      {landlordLiaisonVisible && (
        <DashboardSection id="landlord-liaison" title="Landlord Liaison" background={COLORS.white} alertCount={landlordLiaisonUnassignedCount} defaultCollapsed>
          <div style={{ width: '100%' }}>
            <KpiTiles
              kpis={landlordLiaisonKpis}
              onTileClick={() => onNavigate?.('landlord-liaison')}
            />
          </div>
        </DashboardSection>
      )}

      {!profile.division && (
        <DashboardSection id="void-aging" title="Void Aging" background={COLORS.white} alertCount={voidAgingCounts.overdue} defaultCollapsed>
          <div style={{ width: '100%' }}>
            <KpiTiles
              kpis={voidAgingKpis}
              onTileClick={(kpi) => onNavigate?.('voids', { tierFilter: kpi.tierFilter })}
            />
          </div>
        </DashboardSection>
      )}

      {!profile.division && (
        <DashboardSection id="gardens" title="Gardens" background={COLORS.white} alertCount={gardenAgingCounts.overdue} defaultCollapsed>
          <div style={{ width: '100%' }}>
            <KpiTiles
              kpis={gardenAgingKpis}
              onTileClick={() => onNavigate?.('properties', { filterMode: 'gardensOverdue' })}
            />
          </div>
        </DashboardSection>
      )}

      {housekeepingVisible && (
        <DashboardSection id="housekeeping-summary" title="Housekeeping" background={COLORS.white} alertCount={housekeepingCounts.overdue} defaultCollapsed>
          <div style={{ width: '100%' }}>
            <KpiTiles
              kpis={housekeepingKpis}
              onTileClick={() => onNavigate?.('housekeeping')}
            />
          </div>
        </DashboardSection>
      )}

      <DashboardSection id="jobs-completed" title="Jobs Completed" background={COLORS.slate50} defaultCollapsed>
        {completionKpis.map(kpi => (
          <button
            key={kpi.label}
            onClick={() => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter })}
            style={{ flex: '1 1 160px', background: COLORS.greenDark, borderRadius: '16px', padding: '16px', border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center' }}
          >
            <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kpi.label}</p>
            <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{kpi.value}</p>
          </button>
        ))}
      </DashboardSection>

      <DashboardSection id="sign-off-mileage" title="Sign-Off & Mileage" background={COLORS.slate50} alertCount={flaggedLocationsCount} defaultCollapsed>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={[
              { label: 'Pending Sign-Off', value: pendingSignOffCount, colour: pendingSignOffCount > 0 ? COLORS.red600 : COLORS.blue600, navTo: 'sign-off' },
              { label: 'Fleet Mileage (This Month)', value: fleetMileageThisMonth.toFixed(1), colour: COLORS.sky500, navTo: 'builders' },
              { label: 'Currently Clocked In', value: clockedInCount, colour: COLORS.violet600, navTo: 'clocking' },
              { label: 'Flagged Locations', value: flaggedLocationsCount, colour: COLORS.red600, navTo: 'clocking' },
              { label: 'Avg. Response Time', value: avgResponseMs != null ? formatDuration(avgResponseMs) : 'N/A', colour: COLORS.teal600, navTo: 'reports' },
            ]}
            columns={5}
            onTileClick={(kpi) => onNavigate?.(kpi.navTo)}
          />
        </div>
      </DashboardSection>
    </div>
  )
}
