import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { priorityTierLabel, fetchFlaggedClockingCount, isTicketStuck, KpiTiles, fetchComplianceAgingCounts, fetchVoidAgingCounts, fetchGardenReviewAging, computeAvgResponseMs, formatDuration, fetchPriorityThresholds } from './shared'
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
function DailyBriefing({ lines }) {
  function handleLineClick(target) {
    const header = document.querySelector(`[data-dashboard-section="${target}"]`)
    header?.click()
    header?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const toneColour = { critical: COLORS.red600, warning: COLORS.amber600, quiet: COLORS.slate400 }

  return (
    <div style={{
      borderRadius: '14px', padding: '18px 20px', marginBottom: '16px',
      background: `linear-gradient(135deg, ${COLORS.indigo100} 0%, ${COLORS.violet100} 100%)`,
      border: `1px solid ${COLORS.indigo100}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <span style={{ color: COLORS.indigo700, display: 'flex' }}><NavIcon name="sunrise" size={16} /></span>
        <span style={{ fontSize: '12px', fontWeight: 800, color: COLORS.indigo700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Daily Briefing</span>
      </div>
      <p style={{ margin: '0 0 10px', fontSize: '11px', color: COLORS.indigo700, opacity: 0.75 }}>
        What's worth a look across the dashboard this morning.
      </p>
      {lines.map((line, i) => (
        <div
          key={i}
          onClick={() => handleLineClick(line.target)}
          style={{
            display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', cursor: 'pointer',
            borderTop: i === 0 ? 'none' : `1px solid rgba(67,56,202,0.1)`,
            opacity: line.tone === 'quiet' ? 0.6 : 1,
          }}
        >
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: toneColour[line.tone] }} />
          <span style={{ flex: 1, fontSize: '13px', color: '#1e1b4b', fontWeight: line.tone === 'quiet' ? 400 : 500 }}>{line.text}</span>
          <span style={{ fontSize: '12px', color: line.tone === 'quiet' ? COLORS.slate400 : COLORS.violet600, flexShrink: 0 }}>→</span>
        </div>
      ))}
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
    { label: 'Completed', value: tickets.filter(t => t.status === 'Completed').length, colour: COLORS.green600, statusFilter: 'Completed' },
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

  const completedTickets = tickets.filter(t => t.status === 'Completed' && t.completed_at)

  const completionKpis = [
    { label: 'Today', value: completedTickets.filter(t => isSameDay(new Date(t.completed_at), now)).length },
    { label: 'This Week', value: completedTickets.filter(t => new Date(t.completed_at) >= weekStart).length },
    { label: 'This Month', value: completedTickets.filter(t => new Date(t.completed_at) >= monthStart).length },
  ].map(kpi => ({ ...kpi, statusFilter: 'Completed' }))

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
      <DailyBriefing lines={briefingLines} />

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
