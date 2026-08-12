import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { priorityTierLabel, fetchFlaggedClockingCount, isTicketStuck, KpiTiles, fetchComplianceAgingCounts, fetchVoidAgingCounts, fetchGardenReviewAging, computeAvgResponseMs, formatDuration, fetchPriorityThresholds, fetchAssignableBuilders, fetchAssignableStaffForDivision, fetchLastEndedSessionsToday, ukDateKey, formatUKDateTime, minutesLate, SHORT_TRIP_REASONS } from './shared'
import { NavIcon } from '../../lib/icons'
import { googleMapsLink } from '../../lib/geo'

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
          padding: '10px 20px', cursor: 'pointer', userSelect: 'none',
          background: COLORS.sectionHeaderBg, borderBottom: `1px solid ${COLORS.slate200}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{title}</p>
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
          <div style={{ background, display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '20px' }}>
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
const DASHBOARD_TOP_CARD_HEIGHT = '420px'

function DailyBriefing({ lines }) {
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

  const toneColour = { critical: COLORS.red600, warning: COLORS.amber600, quiet: COLORS.slate400 }

  return (
    <div style={{
      borderRadius: '16px', padding: '18px 20px', background: COLORS.white,
      border: `1px solid ${COLORS.slate200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      height: DASHBOARD_TOP_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ color: COLORS.indigo700, display: 'flex' }}><NavIcon name="sunrise" size={16} /></span>
        <span style={{ fontSize: '12px', fontWeight: 800, color: COLORS.indigo700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily Briefing</span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '11px', color: COLORS.slate500 }}>
        What's worth a look across the dashboard this morning.
      </p>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
function TeamWhereabouts({ profile, onNavigate }) {
  const [loading, setLoading] = useState(true)
  const [builders, setBuilders] = useState([])
  const [statusByStaffId, setStatusByStaffId] = useState({})
  const [logEntries, setLogEntries] = useState([])
  const [filterStaffId, setFilterStaffId] = useState('All')
  const [divisionFilter, setDivisionFilter] = useState('All')

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
    setBuilders(assignableBuilders)

    const todayKey = ukDateKey()

    const { data: deadlineRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'daily_clock_in_deadline')
      .maybeSingle()
    const deadline = deadlineRow?.setting_value || '09:00'

    const [{ data: attendanceData }, { data: activityData }, { data: openSessions }, { data: auditData }, { data: onHoldShortTrips }] = await Promise.all([
      supabase.schema('pmms').from('daily_attendance').select('id, staff_id, clock_in_at, late_flag, clock_out_at, early_leave_reason').or(`work_date.eq.${todayKey},clock_out_at.is.null`),
      supabase.schema('pmms').from('activity_log').select('id, staff_id, activity_type, note, started_at, ended_at, ticket_id, destination_ticket_id').or(`started_at.gte.${todayKey}T00:00:00,ended_at.is.null`),
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
        .in('actor_id', assignableBuilders.map(b => b.id)),
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
      const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, ticket_number').in('id', ticketIds)
      ticketsById = Object.fromEntries((ticketRows || []).map(t => [t.id, t]))
    }

    // "Available" on its own says nothing about how long, or where he was
    // last -- this is the same clock_out_lat/lng already saved the moment
    // any job ends (complete or pause), just not previously surfaced here.
    const lastEndedByBuilder = await fetchLastEndedSessionsToday(assignableBuilders.map(b => b.id), todayKey)

    const statuses = {}
    assignableBuilders.forEach(b => {
      const shift = (attendanceData || [])
        .filter(a => a.staff_id === b.id)
        .sort((x, y) => new Date(y.clock_in_at) - new Date(x.clock_in_at))[0]
      const openSession = (openSessions || []).find(s => s.builder_id === b.id)
      const openActivity = (activityData || []).find(a => a.staff_id === b.id && !a.ended_at)
      const shortTripTicket = (onHoldShortTrips || []).find(t => t.assigned_builder_id === b.id)

      let status = 'Off shift'
      let tone = 'off'
      if (shift && !shift.clock_out_at) {
        if (openActivity) {
          status = `${openActivity.activity_type === 'Travel' ? 'Travelling' : 'On break'}${openActivity.note ? `: ${openActivity.note}` : ''}`
          tone = 'away'
        } else if (shortTripTicket) {
          status = `${shortTripTicket.hold_reason} (Job #${shortTripTicket.ticket_number})`
          tone = 'away'
        } else if (openSession) {
          status = `On Job #${ticketsById[openSession.ticket_id]?.ticket_number ?? '?'}`
          tone = 'job'
        } else {
          status = 'Available'
          tone = 'available'
        }
      }

      let idleSince = null, idleLat = null, idleLng = null
      if (tone === 'available') {
        const lastEnded = lastEndedByBuilder[b.id]
        idleSince = lastEnded?.ended_at || shift?.clock_in_at || null
        idleLat = lastEnded?.clock_out_lat ?? null
        idleLng = lastEnded?.clock_out_lng ?? null
      }
      statuses[b.id] = { status, tone, idleSince, idleLat, idleLng }
    })
    setStatusByStaffId(statuses)

    const entries = []
    ;(attendanceData || []).forEach(a => {
      const b = assignableBuilders.find(x => x.id === a.staff_id)
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
      const b = assignableBuilders.find(x => x.id === a.staff_id)
      if (!b) return
      const ticket = a.ticket_id ? ticketsById[a.ticket_id] : null
      // The destination they're heading to is the more useful jump target
      // on the "left site" line than the job they just stepped away from.
      const destinationTicket = a.destination_ticket_id ? ticketsById[a.destination_ticket_id] : null
      entries.push({
        id: `${a.id}-start`, time: a.started_at, staffId: a.staff_id, staffName: b.name, tone: 'away',
        text: `${a.activity_type === 'Travel' ? 'left site' : 'started break'}${a.note ? `: ${a.note}` : ''}`,
        ticketNumber: (destinationTicket ?? ticket)?.ticket_number,
      })
      if (a.ended_at) {
        entries.push({
          id: `${a.id}-end`, time: a.ended_at, staffId: a.staff_id, staffName: b.name, tone: 'back',
          text: a.activity_type === 'Travel' ? 'returned to site' : 'back from break',
          ticketNumber: ticket?.ticket_number,
        })
      }
    })
    ;(auditData || []).forEach(a => {
      const b = assignableBuilders.find(x => x.id === a.actor_id)
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
  }
  const chipStyle = { off: { bg: COLORS.slate100, fg: COLORS.slate400 }, available: { bg: COLORS.blue50, fg: COLORS.blue700 }, job: { bg: COLORS.teal50, fg: COLORS.teal700 }, away: { bg: COLORS.violet100, fg: COLORS.violet600 } }

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

  return (
    <div style={{
      borderRadius: '16px', padding: '18px 20px', background: COLORS.white,
      border: `1px solid ${COLORS.slate200}`, boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
      height: DASHBOARD_TOP_CARD_HEIGHT, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: COLORS.teal700 }}>📍</span>
          <span style={{ fontSize: '12px', fontWeight: 800, color: COLORS.teal700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Where's the Team</span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {!profile.division && (
            <select
              value={divisionFilter}
              onChange={(e) => { setDivisionFilter(e.target.value); setFilterStaffId('All') }}
              style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}
            >
              <option value="All">All divisions</option>
              {divisionOptions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <select
            value={filterStaffId}
            onChange={(e) => setFilterStaffId(e.target.value)}
            style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}
          >
            <option value="All">All builders</option>
            {divisionScopedBuilders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>
      <p style={{ margin: '4px 0 12px 0', fontSize: '11px', color: COLORS.slate500 }}>Live status and every trip logged today.</p>

      {loading ? (
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontSize: '13px' }}>Loading...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px', marginBottom: '10px' }}>
            {visibleBuilders.map(b => {
              const s = statusByStaffId[b.id] || { status: 'Off shift', tone: 'off' }
              const c = chipStyle[s.tone]
              const idleMs = s.idleSince ? Date.now() - new Date(s.idleSince).getTime() : null
              return (
                <div key={b.id} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '2px', padding: '7px 12px', borderRadius: idleMs != null ? '14px' : '999px', background: c.bg, fontSize: '12px', fontWeight: 700 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c.fg }} />
                    <span
                      onClick={() => onNavigate?.('builders', { staffId: b.id })}
                      style={{ color: COLORS.slate900, cursor: onNavigate ? 'pointer' : 'default' }}
                    >
                      {b.name.split(' ')[0]}
                    </span>
                    <span style={{ color: c.fg }}>{s.status}</span>
                  </div>
                  {idleMs != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', fontWeight: 700, color: c.fg, opacity: 0.85 }}>
                      <span>idle {formatDuration(idleMs)}</span>
                      {s.idleLat != null && s.idleLng != null && (
                        <a href={googleMapsLink(s.idleLat, s.idleLng)} target="_blank" rel="noreferrer" style={{ color: c.fg }}>
                          📍 last seen
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
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
                </div>
              </div>
            ))}
          </div>
        </>
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
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [totalTicketsPeriod, setTotalTicketsPeriod] = useState('all_time')
  const [loading, setLoading] = useState(true)

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
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchTotalTicketsPeriod()
  }

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, status, created_at, completed_at, status_changed_at, first_assigned_at, priority_score, priority_override, mileage_logged, hold_reason')

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
    const { count } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id', { count: 'exact', head: true })

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

  const pendingSignOffCount = tickets.filter(t => t.status === 'Completed').length

  const fleetMileageThisMonth = tickets
    .filter(t => t.completed_at && new Date(t.completed_at) >= monthStart)
    .reduce((sum, t) => sum + (t.mileage_logged || 0), 0)

  const avgResponseMs = computeAvgResponseMs(tickets)

  // Same visibility rules as the sections themselves below -- a line for a
  // section this profile can't see (and couldn't click through to) would
  // just be confusing.
  const complianceVisible = !profile.division || profile.division === 'Compliance'
  const voidGardensVisible = !profile.division

  // Mirrors every red-coloured Pipeline KPI tile exactly (see kpis above)
  // rather than a narrower hand-picked metric -- a tile showing red on the
  // dashboard with no matching line here was exactly the gap that left a
  // real unassigned backlog invisible in the briefing (only its P1 subset
  // was ever checked).
  const unassignedCount = kpis.find(k => k.label === 'Unassigned')?.value || 0
  const p1CriticalCount = kpis.find(k => k.label === 'P1 Critical')?.value || 0
  const unableToDoCount = kpis.find(k => k.label === 'Unable to Do')?.value || 0
  const stuckCount = kpis.find(k => k.label === 'Stuck')?.value || 0
  const completedToday = completionKpis.find(k => k.label === 'Today')?.value || 0
  const completedThisMonth = completionKpis.find(k => k.label === 'This Month')?.value || 0

  const flaggedLines = []
  const quietLines = []

  if (stuckCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{stuckCount} ticket{stuckCount === 1 ? '' : 's'}</b> {stuckCount === 1 ? 'is' : 'are'} stuck — no update in longer than usual, worth a check.</> })
  if (unassignedCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{unassignedCount} ticket{unassignedCount === 1 ? '' : 's'}</b> {unassignedCount === 1 ? 'is' : 'are'} still unassigned.</> })
  if (p1CriticalCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{p1CriticalCount} P1 Critical ticket{p1CriticalCount === 1 ? '' : 's'}</b> {p1CriticalCount === 1 ? 'needs' : 'need'} attention.</> })
  if (unableToDoCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'warning', text: <><b>{unableToDoCount} job{unableToDoCount === 1 ? '' : 's'}</b> {unableToDoCount === 1 ? 'was' : 'were'} flagged as unable to do — needs reassigning.</> })
  if (stuckCount === 0 && unassignedCount === 0 && p1CriticalCount === 0 && unableToDoCount === 0) quietLines.push({ target: 'pipeline', tone: 'quiet', text: <>Ticket Pipeline — no updates. {totalTicketsCount} total, {completedToday} completed today.</> })

  if (complianceVisible) {
    if (complianceCounts.expired > 0) flaggedLines.push({ target: 'compliance', tone: 'warning', text: <><b>{complianceCounts.expired} compliance certificate{complianceCounts.expired === 1 ? '' : 's'}</b> {complianceCounts.expired === 1 ? 'has' : 'have'} expired.</> })
    else quietLines.push({ target: 'compliance', tone: 'quiet', text: <>Compliance — no updates. {complianceCounts.dueSoon} due soon.</> })
  }

  if (voidGardensVisible) {
    if (voidAgingCounts.overdue > 0) flaggedLines.push({ target: 'void-aging', tone: 'warning', text: <><b>{voidAgingCounts.overdue} void room{voidAgingCounts.overdue === 1 ? '' : 's'}</b> {voidAgingCounts.overdue === 1 ? 'is' : 'are'} overdue for turnaround.</> })
    else quietLines.push({ target: 'void-aging', tone: 'quiet', text: <>Void Aging — no updates. {voidAgingCounts.aging} aging, nothing overdue.</> })

    if (gardenAgingCounts.overdue > 0) flaggedLines.push({ target: 'gardens', tone: 'warning', text: <><b>{gardenAgingCounts.overdue} garden{gardenAgingCounts.overdue === 1 ? '' : 's'}</b> {gardenAgingCounts.overdue === 1 ? 'is' : 'are'} overdue for attention.</> })
    else quietLines.push({ target: 'gardens', tone: 'quiet', text: <>Gardens — no updates. {gardenAgingCounts.aging} due soon, nothing overdue.</> })
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '16px', alignItems: 'stretch', marginBottom: '16px' }}>
        <DailyBriefing lines={briefingLines} />
        <TeamWhereabouts profile={profile} onNavigate={onNavigate} />
      </div>

      <DashboardSection id="pipeline" title="Ticket Pipeline" background={COLORS.white} alertCount={kpis.find(k => k.label === 'Stuck')?.value || 0}>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={kpis}
            onTileClick={(kpi) => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter, priorityFilter: kpi.priorityFilter, stuckOnly: kpi.stuckOnly })}
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
        <button
          onClick={() => onNavigate?.('sign-off')}
          style={{
            flex: '1 1 220px', background: pendingSignOffCount > 0 ? COLORS.red600 : COLORS.blue600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending Sign-Off</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{pendingSignOffCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('builders')}
          style={{
            flex: '1 1 220px', background: COLORS.sky500, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fleet Mileage (This Month)</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{fleetMileageThisMonth.toFixed(1)}</p>
        </button>

        <button
          onClick={() => onNavigate?.('clocking')}
          style={{
            flex: '1 1 220px', background: COLORS.violet600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Currently Clocked In</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{clockedInCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('clocking')}
          style={{
            flex: '1 1 220px', background: COLORS.red600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Flagged Locations</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{flaggedLocationsCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('reports')}
          style={{
            flex: '1 1 220px', background: COLORS.teal600, borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg. Response Time</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.white }}>{avgResponseMs != null ? formatDuration(avgResponseMs) : 'N/A'}</p>
        </button>
      </DashboardSection>
    </div>
  )
}
