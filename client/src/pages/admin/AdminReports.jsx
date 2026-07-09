// Portfolio-wide historical reporting -- everything here reads from data
// that already exists (pmms.tickets, pmms.properties, pmms.settings). No
// new tables or columns. The per-property version of most of this already
// exists in PropertyMaintenanceTab.jsx; this generalizes the same
// calculations across every property/builder instead of one at a time, and
// adds a date range so it shows trends, not just a live snapshot.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { attachProperties } from '../../lib/properties'
import {
  CATEGORIES, formatDuration, filterSelectStyle, thStyle, tdStyle,
  fetchAssignableBuilders, resolveCategoryDivision,
} from './shared'
import SimpleBarChart from '../../components/SimpleBarChart'

const tileStyle = (colour) => ({ flex: '1 1 160px', background: colour, borderRadius: '16px', padding: '16px', textAlign: 'center' })
const tileLabelStyle = { margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const tileValueStyle = { margin: 0, fontSize: '26px', fontWeight: 800, color: '#ffffff' }
const cardStyle = { background: '#fff', borderRadius: '16px', padding: '18px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardLabelStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
const filterLabelStyle = { display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8', marginBottom: '4px' }

function isoDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function shortLabel(date) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

function avgMsLabel(ms) {
  if (ms == null) return 'N/A'
  return formatDuration(ms)
}

export default function AdminReports() {
  const [tickets, setTickets] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [builders, setBuilders] = useState([])
  const [categoriesSettingsRow, setCategoriesSettingsRow] = useState(null)

  const [fromDate, setFromDate] = useState(isoDateNDaysAgo(30))
  const [toDate, setToDate] = useState(todayIso())
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [builderFilter, setBuilderFilter] = useState('All')
  const [breakdownMode, setBreakdownMode] = useState('category')

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, created_at, completed_at, property_id, assigned_builder_id')

    if (error) { setLoadError(error.message); setTickets([]); return }

    const withProperties = await attachProperties(data || [], 'address')
    setTickets(withProperties)
    setBuilders(await fetchAssignableBuilders())

    const { data: categoriesRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()
    setCategoriesSettingsRow(categoriesRow)
  }

  if (tickets === null) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontWeight: 600 }}>Loading reports...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#dc2626' }}>Couldn't load reports</p>
        <p style={{ margin: 0, fontSize: '13px', color: '#7f1d1d', fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  const fromTime = new Date(fromDate).getTime()
  const toTime = new Date(toDate).getTime() + 86400000 - 1

  const scopedTickets = tickets.filter(t => {
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
    if (builderFilter !== 'All' && t.assigned_builder_id !== builderFilter) return false
    return true
  })

  const createdInRange = scopedTickets.filter(t => {
    const c = new Date(t.created_at).getTime()
    return c >= fromTime && c <= toTime
  })

  const completedInRange = scopedTickets.filter(t => {
    if (!t.completed_at) return false
    const c = new Date(t.completed_at).getTime()
    return c >= fromTime && c <= toTime
  })

  const currentlyOpen = scopedTickets.filter(t => t.status !== 'Completed' && t.status !== 'Archived' && t.status !== 'Cancelled')

  const avgTurnaroundMs = completedInRange.length > 0
    ? completedInRange.reduce((sum, t) => sum + Math.max(0, new Date(t.completed_at) - new Date(t.created_at)), 0) / completedInRange.length
    : null

  // Weekly trend across the whole selected range, including empty weeks.
  const weekBuckets = []
  let cursor = mondayOf(fromDate)
  const rangeEnd = new Date(toTime)
  while (cursor <= rangeEnd) {
    weekBuckets.push(new Date(cursor))
    cursor = new Date(cursor.getTime() + 7 * 86400000)
  }
  const trendData = weekBuckets.map(weekStart => {
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)
    const createdCount = createdInRange.filter(t => {
      const c = new Date(t.created_at)
      return c >= weekStart && c < weekEnd
    }).length
    const completedCount = completedInRange.filter(t => {
      const c = new Date(t.completed_at)
      return c >= weekStart && c < weekEnd
    }).length
    return { label: shortLabel(weekStart), values: [createdCount, completedCount] }
  })

  // Category/division breakdown, tickets raised in range.
  const breakdownCounts = {}
  createdInRange.forEach(t => {
    const key = breakdownMode === 'division'
      ? resolveCategoryDivision(t.category || 'Uncategorised', categoriesSettingsRow)
      : (t.category || 'Uncategorised')
    breakdownCounts[key] = (breakdownCounts[key] || 0) + 1
  })
  const breakdownChartData = Object.entries(breakdownCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ label: key, values: [count] }))

  // Recurring issues by property -- same "3+ = recurring" flag already used
  // per-property in PropertyMaintenanceTab.jsx, ranked across the portfolio.
  const propertyCounts = {}
  scopedTickets.forEach(t => {
    if (!t.property_id) return
    if (!propertyCounts[t.property_id]) propertyCounts[t.property_id] = { address: t.property?.address || 'Unknown property', count: 0 }
    propertyCounts[t.property_id].count += 1
  })
  const recurringProperties = Object.values(propertyCounts).sort((a, b) => b.count - a.count).slice(0, 10)

  // Staff workload within the selected range.
  const workload = builders
    .map(b => {
      const assigned = createdInRange.filter(t => t.assigned_builder_id === b.id)
      const completed = completedInRange.filter(t => t.assigned_builder_id === b.id)
      const avgMs = completed.length > 0
        ? completed.reduce((sum, t) => sum + Math.max(0, new Date(t.completed_at) - new Date(t.created_at)), 0) / completed.length
        : null
      return { id: b.id, name: b.name, assignedCount: assigned.length, completedCount: completed.length, avgMs }
    })
    .filter(w => w.assignedCount > 0 || w.completedCount > 0)
    .sort((a, b) => b.assignedCount - a.assignedCount)

  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Reports</h2>

      <div style={{ ...cardStyle, display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <label style={filterLabelStyle}>From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={filterSelectStyle} />
        </div>
        <div>
          <label style={filterLabelStyle}>To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={filterSelectStyle} />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={builderFilter} onChange={e => setBuilderFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Staff</option>
          {builders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={tileStyle('#64748b')}>
          <p style={tileLabelStyle}>Tickets Raised (Range)</p>
          <p style={tileValueStyle}>{createdInRange.length}</p>
        </div>
        <div style={tileStyle('#16a34a')}>
          <p style={tileLabelStyle}>Completed (Range)</p>
          <p style={tileValueStyle}>{completedInRange.length}</p>
        </div>
        <div style={tileStyle('#0d9488')}>
          <p style={tileLabelStyle}>Currently Open</p>
          <p style={tileValueStyle}>{currentlyOpen.length}</p>
        </div>
        <div style={tileStyle('#9333ea')}>
          <p style={tileLabelStyle}>Avg. Turnaround</p>
          <p style={tileValueStyle}>{avgMsLabel(avgTurnaroundMs)}</p>
        </div>
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Tickets Raised vs. Completed (by week)</p>
        <SimpleBarChart
          data={trendData}
          series={[
            { name: 'Raised', color: '#3b82f6' },
            { name: 'Completed', color: '#16a34a' },
          ]}
        />
      </div>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <p style={{ ...cardLabelStyle, margin: 0 }}>Tickets by {breakdownMode === 'division' ? 'Division' : 'Category'}</p>
          <select value={breakdownMode} onChange={e => setBreakdownMode(e.target.value)} style={filterSelectStyle}>
            <option value="category">By Category</option>
            <option value="division">By Division</option>
          </select>
        </div>
        <SimpleBarChart
          data={breakdownChartData}
          series={[{ name: breakdownMode === 'division' ? 'Division' : 'Category', color: '#0d9488' }]}
        />
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Properties With the Most Tickets</p>
        {recurringProperties.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No tickets match these filters.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recurringProperties.map((p, idx) => (
              <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{p.address}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {p.count >= 3 && (
                    <span style={{ fontSize: '10px', fontWeight: 800, color: '#dc2626', background: '#fee2e2', padding: '2px 8px', borderRadius: '20px' }}>⚠ Recurring</span>
                  )}
                  <span style={{ fontSize: '13px', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>{p.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Staff Workload (Range)</p>
        {workload.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No assigned tickets match these filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={thStyle}>Staff</th>
                  <th style={thStyle}>Raised</th>
                  <th style={thStyle}>Completed</th>
                  <th style={thStyle}>Avg. Turnaround</th>
                </tr>
              </thead>
              <tbody>
                {workload.map(w => (
                  <tr key={w.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={tdStyle}>{w.name}</td>
                    <td style={tdStyle}>{w.assignedCount}</td>
                    <td style={tdStyle}>{w.completedCount}</td>
                    <td style={tdStyle}>{avgMsLabel(w.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
