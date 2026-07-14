import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { priorityTierLabel, fetchFlaggedClockingCount, isTicketStuck, KpiTiles, fetchComplianceAgingCounts, fetchVoidAgingCounts, computeAvgResponseMs, formatDuration, fetchPriorityThresholds } from './shared'

const DEFAULT_NEW_PROPERTY_WINDOW_HOURS = 48

// Collapsed/expanded state persists per section in localStorage (keyed by
// `id`, not the title text, so a future title rename doesn't reset
// everyone's preference) -- every section starts expanded on first visit.
// alertCount only ever renders while collapsed: the point is to let an
// admin collapse a normally-quiet section without silently losing sight
// of it if something in it later needs attention.
function DashboardSection({ id, title, background, alertCount = 0, children }) {
  const storageKey = `pmms_dashboard_collapsed_${id}`
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(storageKey) === 'true' } catch { return false }
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
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
          padding: '10px 20px', cursor: 'pointer', userSelect: 'none',
          background: '#eef1f6', borderBottom: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{title}</p>
          {collapsed && alertCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: '20px', height: '20px',
              padding: '0 6px', borderRadius: '20px', background: '#dc2626', color: '#fff', fontSize: '11px', fontWeight: 800,
            }}>
              {alertCount}
            </span>
          )}
        </div>
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', width: '20px', height: '20px', flexShrink: 0,
          color: '#64748b', transition: 'transform 0.2s ease', transform: collapsed ? 'rotate(-90deg)' : 'none',
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

export default function AdminDashboard({ onNavigate }) {
  const [tickets, setTickets] = useState([])
  const [newPropertiesCount, setNewPropertiesCount] = useState(0)
  const [totalPropertiesCount, setTotalPropertiesCount] = useState(0)
  const [clockedInCount, setClockedInCount] = useState(0)
  const [flaggedLocationsCount, setFlaggedLocationsCount] = useState(0)
  const [stuckThresholds, setStuckThresholds] = useState(null)
  const [complianceCounts, setComplianceCounts] = useState({ expired: 0, dueSoon: 0, noRecord: 0, valid: 0 })
  const [voidAgingCounts, setVoidAgingCounts] = useState({ overdue: 0, aging: 0, recent: 0 })
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTickets()
    fetchPropertiesMetrics()
    fetchTotalPropertiesCount()
    fetchClockedInCount()
    fetchFlaggedClockingCount().then(setFlaggedLocationsCount)
    fetchStuckThresholds()
    fetchComplianceAgingCounts().then(setComplianceCounts)
    fetchVoidAgingCounts().then(setVoidAgingCounts)
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
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

  async function fetchClockedInCount() {
    const { count } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('id', { count: 'exact', head: true })
      .is('ended_at', null)

    setClockedInCount(count || 0)
  }

  const kpis = [
    { label: 'Total tickets', value: tickets.length, colour: '#64748b', statusFilter: 'All' },
    { label: 'Unassigned', value: tickets.filter(t => t.status === 'Pending').length, colour: '#dc2626', statusFilter: 'Pending' },
    { label: 'In Progress', value: tickets.filter(t => t.status === 'In Progress').length, colour: '#0d9488', statusFilter: 'In Progress' },
    { label: 'On Hold', value: tickets.filter(t => t.status === 'On Hold').length, colour: '#f59e0b', statusFilter: 'On Hold' },
    { label: 'Completed', value: tickets.filter(t => t.status === 'Completed').length, colour: '#16a34a', statusFilter: 'Completed' },
    {
      // Matches the Pipeline page's own "effective tier" logic exactly
      // (priority_override wins over the raw score) so this count always
      // equals the number of rows you land on after clicking the tile.
      label: 'P1 Critical',
      value: tickets.filter(t => (t.priority_override || priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)) === 'P1 Critical').length,
      colour: '#dc2626',
      statusFilter: 'All',
      priorityFilter: 'P1 Critical',
    },
    {
      label: 'Stuck',
      value: tickets.filter(t => isTicketStuck(t, stuckThresholds, Date.now(), p1Threshold, p2Threshold)).length,
      colour: '#dc2626',
      statusFilter: 'All',
      stuckOnly: true,
    },
  ]

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
  const completedTickets = tickets.filter(t => t.status === 'Completed' && t.completed_at)

  const completionKpis = [
    { label: 'Today', value: completedTickets.filter(t => isSameDay(new Date(t.completed_at), now)).length },
    { label: 'This Week', value: completedTickets.filter(t => new Date(t.completed_at) >= weekStart).length },
    { label: 'This Month', value: completedTickets.filter(t => new Date(t.completed_at) >= monthStart).length },
  ].map(kpi => ({ ...kpi, statusFilter: 'Completed' }))

  const complianceKpis = [
    { label: 'Expired Certs', value: complianceCounts.expired, colour: '#dc2626', tierFilter: 'Expired' },
    { label: 'Due Soon', value: complianceCounts.dueSoon, colour: '#d97706', tierFilter: 'Due Soon' },
    { label: 'No Record', value: complianceCounts.noRecord, colour: '#94a3b8', tierFilter: 'No Record' },
  ]

  const voidAgingKpis = [
    { label: 'Overdue Voids', value: voidAgingCounts.overdue, colour: '#dc2626', tierFilter: 'Overdue' },
    { label: 'Aging Voids', value: voidAgingCounts.aging, colour: '#d97706', tierFilter: 'Aging' },
    { label: 'Recent Voids', value: voidAgingCounts.recent, colour: '#16a34a', tierFilter: 'Recent' },
  ]

  const pendingSignOffCount = tickets.filter(t => t.status === 'Completed').length

  const fleetMileageThisMonth = tickets
    .filter(t => t.completed_at && new Date(t.completed_at) >= monthStart)
    .reduce((sum, t) => sum + (t.mileage_logged || 0), 0)

  const avgResponseMs = computeAvgResponseMs(tickets)

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading tickets...</p>
    </div>
  )

  return (
    <div>
      <DashboardSection id="pipeline" title="Ticket Pipeline" background="#ffffff" alertCount={kpis.find(k => k.label === 'Stuck')?.value || 0}>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={kpis}
            onTileClick={(kpi) => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter, priorityFilter: kpi.priorityFilter, stuckOnly: kpi.stuckOnly })}
          />
        </div>
      </DashboardSection>

      <DashboardSection id="properties" title="Properties" background="#ffffff">
        <button
          onClick={() => onNavigate?.('properties', { filterMode: 'newProperties' })}
          style={{
            flex: '1 1 220px', background: '#0f766e', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>New Properties</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{newPropertiesCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('properties')}
          style={{
            flex: '1 1 220px', background: '#2563eb', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Properties</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{totalPropertiesCount}</p>
        </button>
      </DashboardSection>

      <DashboardSection id="compliance" title="Compliance" background="#ffffff" alertCount={complianceCounts.expired}>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={complianceKpis}
            onTileClick={(kpi) => onNavigate?.('compliance', { tierFilter: kpi.tierFilter })}
          />
        </div>
      </DashboardSection>

      <DashboardSection id="void-aging" title="Void Aging" background="#ffffff" alertCount={voidAgingCounts.overdue}>
        <div style={{ width: '100%' }}>
          <KpiTiles
            kpis={voidAgingKpis}
            onTileClick={(kpi) => onNavigate?.('voids', { tierFilter: kpi.tierFilter })}
          />
        </div>
      </DashboardSection>

      <DashboardSection id="jobs-completed" title="Jobs Completed" background="#f8fafc">
        {completionKpis.map(kpi => (
          <button
            key={kpi.label}
            onClick={() => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter })}
            style={{ flex: '1 1 160px', background: '#19562e', borderRadius: '16px', padding: '16px', border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center' }}
          >
            <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kpi.label}</p>
            <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{kpi.value}</p>
          </button>
        ))}
      </DashboardSection>

      <DashboardSection id="sign-off-mileage" title="Sign-Off & Mileage" background="#f8fafc" alertCount={flaggedLocationsCount}>
        <button
          onClick={() => onNavigate?.('sign-off')}
          style={{
            flex: '1 1 220px', background: '#2563eb', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending Sign-Off</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{pendingSignOffCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('builders')}
          style={{
            flex: '1 1 220px', background: '#0ea5e9', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Fleet Mileage (This Month)</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{fleetMileageThisMonth.toFixed(1)}</p>
        </button>

        <button
          onClick={() => onNavigate?.('clocking')}
          style={{
            flex: '1 1 220px', background: '#7c3aed', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Currently Clocked In</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{clockedInCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('clocking')}
          style={{
            flex: '1 1 220px', background: '#dc2626', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Flagged Locations</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{flaggedLocationsCount}</p>
        </button>

        <button
          onClick={() => onNavigate?.('reports')}
          style={{
            flex: '1 1 220px', background: '#0d9488', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Avg. Response Time</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{avgResponseMs != null ? formatDuration(avgResponseMs) : 'N/A'}</p>
        </button>
      </DashboardSection>
    </div>
  )
}
