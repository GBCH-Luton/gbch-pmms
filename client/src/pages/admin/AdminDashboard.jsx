import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { priorityTierLabel, fetchFlaggedClockingCount, isTicketStuck, KpiTiles, fetchComplianceAgingCounts, fetchVoidAgingCounts, fetchGardenReviewAging, computeAvgResponseMs, formatDuration, fetchPriorityThresholds, fetchAssignableBuilders, fetchAssignableStaffForDivision, ukDateKey, formatUKDateTime, minutesLate } from './shared'
import { NavIcon } from '../../lib/icons'

const DEFAULT_NEW_PROPERTY_WINDOW_HOURS = 48

// Collapsed/expanded state persists per section in localStorage (keyed by
// `id`, not the title text, so a future title rename doesn't reset
// everyone's preference) -- every section starts expanded on first visit.
// alertCount only ever renders while collapsed: the point is to let an
// admin collapse a normally-quiet section without silently losing sight
// of it if something in it later needs attention.
// defaultCollapsed only applies the first time this browser ever sees this
// section (no localStorage key yet) -- the AI Daily Briefing below uses it
// to start quiet sections out of the way, but never fights a preference
// someone already set by clicking a section themselves.
function DashboardSection({ id, title, background, alertCount = 0, defaultCollapsed = false, children }) {
  const storageKey = `pmms_dashboard_collapsed_${id}`
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored === null ? defaultCollapsed : stored === 'true'
    } catch { return defaultCollapsed }
  })

  function toggle() {
    setCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem(storageKey, String(next)) } catch { /* ignore */ }
      return next
    })
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
    header?.click()
    header?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
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

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
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

    const [{ data: attendanceData }, { data: activityData }, { data: openSessions }] = await Promise.all([
      supabase.schema('pmms').from('daily_attendance').select('id, staff_id, clock_in_at, late_flag, clock_out_at, early_leave_reason').or(`work_date.eq.${todayKey},clock_out_at.is.null`),
      supabase.schema('pmms').from('activity_log').select('id, staff_id, activity_type, note, started_at, ended_at, ticket_id').or(`started_at.gte.${todayKey}T00:00:00,ended_at.is.null`),
      supabase.schema('pmms').from('work_sessions').select('id, ticket_id, builder_id').is('ended_at', null),
    ])

    const ticketIds = [...new Set([
      ...(activityData || []).map(a => a.ticket_id).filter(Boolean),
      ...(openSessions || []).map(s => s.ticket_id),
    ])]
    let ticketsById = {}
    if (ticketIds.length > 0) {
      const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, ticket_number').in('id', ticketIds)
      ticketsById = Object.fromEntries((ticketRows || []).map(t => [t.id, t]))
    }

    const statuses = {}
    assignableBuilders.forEach(b => {
      const shift = (attendanceData || [])
        .filter(a => a.staff_id === b.id)
        .sort((x, y) => new Date(y.clock_in_at) - new Date(x.clock_in_at))[0]
      const openSession = (openSessions || []).find(s => s.builder_id === b.id)
      const openActivity = (activityData || []).find(a => a.staff_id === b.id && !a.ended_at)

      let status = 'Off shift'
      let tone = 'off'
      if (shift && !shift.clock_out_at) {
        if (openActivity) {
          status = `${openActivity.activity_type === 'Travel' ? 'Travelling' : 'On break'}${openActivity.note ? `: ${openActivity.note}` : ''}`
          tone = 'away'
        } else if (openSession) {
          status = `On Job #${ticketsById[openSession.ticket_id]?.ticket_number ?? '?'}`
          tone = 'job'
        } else {
          status = 'Available'
          tone = 'available'
        }
      }
      statuses[b.id] = { status, tone }
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
      entries.push({
        id: `${a.id}-start`, time: a.started_at, staffId: a.staff_id, staffName: b.name, tone: 'away',
        text: `${a.activity_type === 'Travel' ? 'left site' : 'started break'}${a.note ? `: ${a.note}` : ''}`,
        ticketNumber: ticket?.ticket_number,
      })
      if (a.ended_at) {
        entries.push({
          id: `${a.id}-end`, time: a.ended_at, staffId: a.staff_id, staffName: b.name, tone: 'back',
          text: a.activity_type === 'Travel' ? 'returned to site' : 'back from break',
          ticketNumber: ticket?.ticket_number,
        })
      }
    })
    entries.sort((x, y) => new Date(y.time) - new Date(x.time))
    setLogEntries(entries.slice(0, 40))

    setLoading(false)
  }

  const toneDot = { in: COLORS.green600, out: COLORS.slate900, away: COLORS.violet600, back: COLORS.slate900, early: COLORS.amber700 }
  const chipStyle = { off: { bg: COLORS.slate100, fg: COLORS.slate400 }, available: { bg: COLORS.blue50, fg: COLORS.blue700 }, job: { bg: COLORS.teal50, fg: COLORS.teal700 }, away: { bg: COLORS.violet100, fg: COLORS.violet600 } }

  const visibleBuilders = filterStaffId === 'All' ? builders : builders.filter(b => b.id === filterStaffId)
  const visibleEntries = filterStaffId === 'All' ? logEntries : logEntries.filter(e => e.staffId === filterStaffId)

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
        <select
          value={filterStaffId}
          onChange={(e) => setFilterStaffId(e.target.value)}
          style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '8px', padding: '6px 10px', cursor: 'pointer' }}
        >
          <option value="All">All builders</option>
          {builders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
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
              return (
                <div key={b.id} style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', borderRadius: '999px', background: c.bg, fontSize: '12px', fontWeight: 700 }}>
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: c.fg }} />
                  <span style={{ color: COLORS.slate900 }}>{b.name.split(' ')[0]}</span>
                  <span style={{ color: c.fg }}>{s.status}</span>
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
                  <span style={{ fontSize: '12.5px', fontWeight: 700, color: COLORS.slate900 }}>{e.staffName}</span>
                  <span style={{ fontSize: '12.5px', color: e.tone === 'early' ? COLORS.amber700 : COLORS.slate600, fontWeight: e.tone === 'early' ? 700 : 400 }}> — {e.text}</span>
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

  useEffect(() => {
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
  }, [])

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, status, created_at, completed_at, status_changed_at, first_assigned_at, priority_score, priority_override, mileage_logged')

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
  const totalTicketsCount = (
    totalTicketsPeriod === 'today' ? tickets.filter(t => isSameDay(new Date(t.created_at), now)) :
    totalTicketsPeriod === 'week' ? tickets.filter(t => new Date(t.created_at) >= weekStart) :
    totalTicketsPeriod === 'month' ? tickets.filter(t => new Date(t.created_at) >= monthStart) :
    totalTicketsPeriod === 'year' ? tickets.filter(t => new Date(t.created_at) >= yearStart) :
    tickets
  ).length

  const kpis = [
    { label: `Total Tickets (${TOTAL_TICKETS_PERIOD_LABELS[totalTicketsPeriod] || 'All Time'})`, value: totalTicketsCount, colour: COLORS.slate500, statusFilter: 'All' },
    { label: 'Unassigned', value: tickets.filter(t => t.status === 'Pending').length, colour: COLORS.red600, statusFilter: 'Pending' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, colour: COLORS.teal600, statusFilter: 'In Progress' },
    { label: 'On Hold', value: tickets.filter(t => t.status === 'On Hold').length, colour: COLORS.amber500, statusFilter: 'On Hold' },
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

  const p1UnassignedCount = tickets.filter(t => (
    t.status === 'Pending' && (t.priority_override || priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)) === 'P1 Critical'
  )).length
  const stuckCount = kpis.find(k => k.label === 'Stuck')?.value || 0
  const completedToday = completionKpis.find(k => k.label === 'Today')?.value || 0
  const completedThisMonth = completionKpis.find(k => k.label === 'This Month')?.value || 0

  const flaggedLines = []
  const quietLines = []

  if (stuckCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{stuckCount} ticket{stuckCount === 1 ? '' : 's'}</b> {stuckCount === 1 ? 'is' : 'are'} stuck — no update in longer than usual, worth a check.</> })
  if (p1UnassignedCount > 0) flaggedLines.push({ target: 'pipeline', tone: 'critical', text: <><b>{p1UnassignedCount} P1 Critical ticket{p1UnassignedCount === 1 ? '' : 's'}</b> {p1UnassignedCount === 1 ? 'is' : 'are'} still unassigned.</> })
  if (stuckCount === 0 && p1UnassignedCount === 0) quietLines.push({ target: 'pipeline', tone: 'quiet', text: <>Ticket Pipeline — no updates. {totalTicketsCount} total, {completedToday} completed today.</> })

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

  if (flaggedLocationsCount > 0) flaggedLines.push({ target: 'sign-off-mileage', tone: 'warning', text: <><b>{flaggedLocationsCount} clocking location{flaggedLocationsCount === 1 ? '' : 's'}</b> flagged for review.</> })
  else quietLines.push({ target: 'sign-off-mileage', tone: 'quiet', text: <>Sign-Off &amp; Mileage — no updates. {pendingSignOffCount} pending sign-off, nothing flagged.</> })

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
            flex: '1 1 220px', background: COLORS.blue600, borderRadius: '16px', padding: '16px',
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
