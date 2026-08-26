// Maintenance tab of the Property Profile. Reads only from pmms.tickets
// (already exists, no new tables) using the same column names AdminPipeline.jsx
// fetches with -- id, status, category, issue_tag, description, priority_score,
// created_at, completed_at, property_id. Confirmed against AdminPipeline.jsx's
// own ticket query before writing this.
//
// Two metrics from the spec can't be computed as literally worded because
// the underlying columns don't exist on pmms.tickets, and inventing a
// substitute would silently misrepresent the number to whoever reads it:
//   - Overdue: no due_date column -> falls back to the spec's own stated
//     fallback (created_at older than 7 days, status still open).
//   - Priority = 'P1'/'urgent': no `priority` text column exists, only
//     priority_score (integer). Reuses the same admin-configurable P1
//     Critical threshold (Settings -> Priority Engine Thresholds, default
//     70) used everywhere else in the app to mean "P1 Critical".
//   - First Time Fix Rate: no revisit_required column -- shown as "—" per
//     the spec's own explicit instruction for this case.
//
// Average Response/Completion Time are now tracked via first_assigned_at
// (see computeAvgResponseMs/computeAvgAssignedToCompleteMs in shared.jsx) --
// tickets that predate that column simply have a null first_assigned_at
// and are excluded rather than fabricating a response time for them.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { fetchAllMaintenanceCategoryNames } from '../../lib/maintenanceCategories'
import {
  priorityTierLabel, priorityBadgeStyle, statusColour, statusLabel, formatUKDate,
  filterSelectStyle, thStyle, tdStyle, formatDuration, computeAvgResponseMs, computeAvgAssignedToCompleteMs,
  fetchPriorityThresholds,
} from './shared'

const OVERDUE_DAYS = 7

const tileStyle = (colour) => ({ flex: '1 1 160px', background: colour, borderRadius: '16px', padding: '16px', textAlign: 'center' })
const tileLabelStyle = { margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const tileValueStyle = { margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }

// One key per sortable column -- ticket_number/priority_score/created_at/
// completed_at sort numerically (dates as epoch ms), the rest as
// lowercased strings. completed_at falls back to -Infinity for an
// incomplete ticket so "no completion date yet" always sorts to one end
// rather than throwing off a real date comparison.
function sortValue(t, key) {
  switch (key) {
    case 'ticket_number': return t.ticket_number
    case 'summary': return (t.issue_tag || t.description || '').toLowerCase()
    case 'category': return (t.category || '').toLowerCase()
    case 'priority_score': return t.priority_score || 0
    case 'status': return statusLabel(t.status).toLowerCase()
    case 'created_at': return new Date(t.created_at).getTime()
    case 'completed_at': return t.completed_at ? new Date(t.completed_at).getTime() : -Infinity
    default: return ''
  }
}

export default function PropertyMaintenanceTab({ property, onNavigate }) {
  const [tickets, setTickets] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [categoryOptions, setCategoryOptions] = useState([])
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')

  function toggleSort(key) {
    if (sortKey === key) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return }
    setSortKey(key)
    setSortDir('asc')
  }

  useEffect(() => {
    fetchTickets()
    fetchAllMaintenanceCategoryNames().then(setCategoryOptions)
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
  }, [property.id])

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, issue_tag, description, priority_score, created_at, completed_at, first_assigned_at')
      .eq('property_id', property.id)
      .order('created_at', { ascending: false })

    if (error) { setLoadError(error.message); setTickets([]); return }
    setTickets(data || [])
  }

  if (tickets === null) {
    return (
      <div style={{ minHeight: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading work orders...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load work orders</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
      </div>
    )
  }

  const now = Date.now()
  const isOpen = (t) => t.status !== 'Completed' && t.status !== 'Cancelled'

  const totalCount = tickets.length
  const openCount = tickets.filter(isOpen).length
  const completedCount = tickets.filter(t => t.status === 'Completed').length
  const overdueCount = tickets.filter(t => isOpen(t) && (now - new Date(t.created_at).getTime()) > OVERDUE_DAYS * 86400000).length
  const emergencyCount = tickets.filter(t => (t.priority_score || 0) >= p1Threshold).length

  // Recurring issues -- grouped by category
  const categoryCounts = {}
  tickets.forEach(t => {
    const cat = t.category || 'Uncategorised'
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
  })
  const recurringIssues = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])

  // Top 5 issues -- grouped by issue_tag
  const issueTagCounts = {}
  tickets.forEach(t => {
    const tag = t.issue_tag || t.description || 'Unspecified issue'
    issueTagCounts[tag] = (issueTagCounts[tag] || 0) + 1
  })
  const topIssues = Object.entries(issueTagCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Filtered + sorted table rows
  const filteredTickets = tickets.filter(t => {
    if (statusFilter === 'Open' && !isOpen(t)) return false
    if (statusFilter === 'Completed' && t.status !== 'Completed') return false
    if (statusFilter === 'Cancelled' && t.status !== 'Cancelled') return false
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false
    return true
  })
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    const va = sortValue(a, sortKey), vb = sortValue(b, sortKey)
    if (va < vb) return sortDir === 'asc' ? -1 : 1
    if (va > vb) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  // Performance metrics -- see file header for why two of these can't be
  // computed as literally specified.
  const completedTickets = tickets.filter(t => t.status === 'Completed' && t.completed_at)
  const avgTurnaroundHours = completedTickets.length > 0
    ? Math.round(completedTickets.reduce((sum, t) => sum + Math.max(0, new Date(t.completed_at) - new Date(t.created_at)), 0) / completedTickets.length / 3600000)
    : null
  const avgResponseMs = computeAvgResponseMs(tickets)
  const avgAssignedToCompleteMs = computeAvgAssignedToCompleteMs(completedTickets)

  return (
    <div>
      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={tileStyle(COLORS.slate500)}>
          <p style={tileLabelStyle}>Total Work Orders</p>
          <p style={tileValueStyle}>{totalCount}</p>
        </div>
        <div style={tileStyle(COLORS.teal600)}>
          <p style={tileLabelStyle}>Open</p>
          <p style={tileValueStyle}>{openCount}</p>
        </div>
        <div style={tileStyle(COLORS.green600)}>
          <p style={tileLabelStyle}>Completed</p>
          <p style={tileValueStyle}>{completedCount}</p>
        </div>
        <div style={tileStyle(COLORS.amber600)}>
          <p style={tileLabelStyle}>Overdue (7+ days)</p>
          <p style={tileValueStyle}>{overdueCount}</p>
        </div>
        <div style={tileStyle(COLORS.red600)}>
          <p style={tileLabelStyle}>Emergency / P1</p>
          <p style={tileValueStyle}>{emergencyCount}</p>
        </div>
      </div>

      {/* Recurring issues + Top 5 issues */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ flex: '1 1 320px', background: COLORS.white, borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recurring Issues (by category)</p>
          {recurringIssues.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No work orders yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recurringIssues.map(([cat, count]) => (
                <div key={cat} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{cat}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {count >= 3 && (
                      <span style={{ fontSize: '10px', fontWeight: 800, color: COLORS.red600, background: COLORS.red100, padding: '2px 8px', borderRadius: '20px' }}>⚠ Recurring</span>
                    )}
                    <span style={{ fontSize: '13px', fontWeight: 800, color: COLORS.slate900, fontFamily: 'monospace' }}>{count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 320px', background: COLORS.white, borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Top 5 Issues</p>
          {topIssues.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No work orders yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {topIssues.map(([tag, count], idx) => (
                <div key={tag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{idx + 1}. {tag}</span>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: COLORS.slate900, fontFamily: 'monospace' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Work order history */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Work Order History ({filteredTickets.length})
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelectStyle}>
              <option value="All">All Statuses</option>
              <option value="Open">Open</option>
              <option value="Completed">Completed</option>
              <option value="Cancelled">Cancelled</option>
            </select>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={filterSelectStyle}>
              <option value="All">All Categories</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No work orders match these filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                  {[
                    ['ticket_number', 'Ticket'], ['summary', 'Summary'], ['category', 'Category'],
                    ['priority_score', 'Priority'], ['status', 'Status'], ['created_at', 'Raised'], ['completed_at', 'Completed'],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      onClick={() => toggleSort(key)}
                      style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                      title={`Sort by ${label}`}
                    >
                      {label}{sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedTickets.map(t => {
                  const tier = priorityTierLabel(t.priority_score, p1Threshold, p2Threshold)
                  const tierStyle = priorityBadgeStyle(tier)
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                      <td
                        style={{ ...tdStyle, ...(onNavigate ? { cursor: 'pointer', color: COLORS.blue700, fontWeight: 700 } : {}) }}
                        onClick={onNavigate ? () => onNavigate('pipeline', {
                          ticketNumber: t.ticket_number,
                          returnTo: { label: property.address, page: 'properties', opts: { propertyId: property.id, tab: 'Maintenance' } },
                        }) : undefined}
                      >
                        #{t.ticket_number}
                      </td>
                      <td style={tdStyle}>{t.issue_tag || t.description || '—'}</td>
                      <td style={tdStyle}>{t.category || '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: tierStyle.color, background: tierStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{tier}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(t.status)}</span>
                      </td>
                      <td style={tdStyle}>{formatUKDate(t.created_at)}</td>
                      <td style={tdStyle}>{t.completed_at ? formatUKDate(t.completed_at) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Performance metrics */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Performance Metrics</p>
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>Average Response Time</p>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: avgResponseMs != null ? COLORS.slate900 : COLORS.slate400 }}>{avgResponseMs != null ? formatDuration(avgResponseMs) : 'N/A'}</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate300 }}>Raised → first assigned</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>Average Completion Time</p>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: avgAssignedToCompleteMs != null ? COLORS.slate900 : COLORS.slate400 }}>{avgAssignedToCompleteMs != null ? formatDuration(avgAssignedToCompleteMs) : 'N/A'}</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate300 }}>Assigned → completed</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>First Time Fix Rate</p>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate400 }}>—</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate300 }}>Requires a revisit_required column, not currently tracked</p>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>Avg. Created → Completed</p>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>{avgTurnaroundHours != null ? `${avgTurnaroundHours} hrs` : 'N/A'}</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: COLORS.slate300 }}>Full raise-to-completion turnaround, available with existing data</p>
          </div>
        </div>
      </div>
    </div>
  )
}
