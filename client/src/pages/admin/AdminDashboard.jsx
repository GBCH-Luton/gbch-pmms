import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { priorityTierLabel, fetchFlaggedClockingCount } from './shared'

const DEFAULT_NEW_PROPERTY_WINDOW_HOURS = 48

function DashboardSection({ title, background, children }) {
  return (
    <div style={{ background, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p style={{ margin: '0 0 14px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{title}</p>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {children}
      </div>
    </div>
  )
}

export default function AdminDashboard({ onNavigate }) {
  const [tickets, setTickets] = useState([])
  const [newPropertiesCount, setNewPropertiesCount] = useState(0)
  const [currentVoidsCount, setCurrentVoidsCount] = useState(0)
  const [clockedInCount, setClockedInCount] = useState(0)
  const [flaggedLocationsCount, setFlaggedLocationsCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTickets()
    fetchPropertiesMetrics()
    fetchVoidsCount()
    fetchClockedInCount()
    fetchFlaggedClockingCount().then(setFlaggedLocationsCount)
  }, [])

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, status, completed_at, priority_score, priority_override, mileage_logged')

    if (!error) setTickets(data)
    setLoading(false)
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

  async function fetchVoidsCount() {
    const { count } = await supabase
      .schema('pmms')
      .from('property_rooms')
      .select('id', { count: 'exact', head: true })
      .eq('current_status', 'Void')

    setCurrentVoidsCount(count || 0)
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
      value: tickets.filter(t => (t.priority_override || priorityTierLabel(t.priority_score)) === 'P1 Critical').length,
      colour: '#dc2626',
      statusFilter: 'All',
      priorityFilter: 'P1 Critical',
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

  const pendingSignOffCount = tickets.filter(t => t.status === 'Completed').length

  const fleetMileageThisMonth = tickets
    .filter(t => t.completed_at && new Date(t.completed_at) >= monthStart)
    .reduce((sum, t) => sum + (t.mileage_logged || 0), 0)

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading tickets...</p>
    </div>
  )

  return (
    <div>
      <DashboardSection title="Ticket Pipeline" background="#ffffff">
        {kpis.map(kpi => (
          <button
            key={kpi.label}
            onClick={() => onNavigate?.('pipeline', { statusFilter: kpi.statusFilter, priorityFilter: kpi.priorityFilter })}
            style={{ flex: '1 1 160px', background: kpi.colour, borderRadius: '16px', padding: '16px', border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center' }}
          >
            <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kpi.label}</p>
            <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{kpi.value}</p>
          </button>
        ))}
      </DashboardSection>

      <DashboardSection title="Sign-Off & Mileage" background="#f8fafc">
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
      </DashboardSection>

      <DashboardSection title="Properties" background="#ffffff">
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
          onClick={() => onNavigate?.('properties', { filterMode: 'voids' })}
          style={{
            flex: '1 1 220px', background: currentVoidsCount > 0 ? '#dc2626' : '#16a34a', borderRadius: '16px', padding: '16px',
            border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center',
          }}
        >
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Current Voids</p>
          <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#ffffff' }}>{currentVoidsCount}</p>
        </button>
      </DashboardSection>

      <DashboardSection title="Jobs Completed" background="#f8fafc">
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
    </div>
  )
}
