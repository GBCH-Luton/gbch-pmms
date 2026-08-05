// Portfolio-wide historical reporting -- everything here reads from data
// that already exists (pmms.tickets, pmms.properties, pmms.settings). No
// new tables or columns. The per-property version of most of this already
// exists in PropertyMaintenanceTab.jsx; this generalizes the same
// calculations across every property/builder instead of one at a time, and
// adds a date range so it shows trends, not just a live snapshot.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import { fetchAllMaintenanceCategoryNames } from '../../lib/maintenanceCategories'
import BuilderProfileModal from './BuilderProfileModal'
import {
  formatDuration, filterSelectStyle, thStyle, tdStyle,
  fetchAssignableBuilders, fetchAssignableStaffForDivision, resolveCategoryDivision, computeAvgTurnaroundMs, computeAvgResponseMs, buildWeeklyTrend,
  isoDateNDaysAgo, todayIso, extractFunctionError, formatUKDateTime,
} from './shared'
import SimpleBarChart from '../../components/SimpleBarChart'

const tileStyle = (colour) => ({ flex: '1 1 160px', background: colour, borderRadius: '16px', padding: '16px', textAlign: 'center' })
const tileLabelStyle = { margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }
const tileValueStyle = { margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }
const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '18px 20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardLabelStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
const filterLabelStyle = { display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, marginBottom: '4px' }

function avgMsLabel(ms) {
  if (ms == null) return 'N/A'
  return formatDuration(ms)
}

// Moved here from the AI Trial menu's standalone "Reports" page (formerly
// ai-trial/AiReports.jsx) so there's one Reports page, not two. No longer
// the free pattern-matcher it started as -- now backed by a real Claude
// API call (supabase/functions/ai-ask), so it can answer any question
// phrased any way instead of only 4 fixed shapes. That also means it now
// costs real money per query (logged to pmms.ai_usage_log, see the AI
// Usage table below), so it stays admin-only rather than opening up to
// every manager who can see this page.
const AI_EXAMPLE_QUESTIONS = [
  'Which properties have the most open tickets?',
  'What compliance is overdue or expiring soon?',
  'What is the most common issue category?',
  'Which builders have completed the most jobs?',
]

export default function AdminReports({ profile, onNavigate }) {
  const [tickets, setTickets] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [builders, setBuilders] = useState([])
  const [categoriesSettingsRow, setCategoriesSettingsRow] = useState(null)
  const [categoryOptions, setCategoryOptions] = useState([])

  const [fromDate, setFromDate] = useState(isoDateNDaysAgo(30))
  const [toDate, setToDate] = useState(todayIso())
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [builderFilter, setBuilderFilter] = useState('All')
  const [breakdownMode, setBreakdownMode] = useState('category')

  const [builderProfileId, setBuilderProfileId] = useState(null)

  const isAdmin = profile.role === 'admin'

  const [aiQuestion, setAiQuestion] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiError, setAiError] = useState('')
  const [aiUsageLog, setAiUsageLog] = useState([])

  useEffect(() => {
    load()
    if (isAdmin) loadAiUsage()
    // isAdmin is derived from profile, which doesn't change within a
    // session -- same one-time-on-mount intent as load() itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleAskAi() {
    setAiAnswer('')
    setAiError('')
    setAiLoading(true)

    const { data, error: fnError } = await supabase.functions.invoke('ai-ask', { body: { question: aiQuestion } })

    setAiLoading(false)

    if (fnError) { setAiError(await extractFunctionError(fnError)); return }
    if (data?.error) { setAiError(data.error); return }

    setAiAnswer(data.answer)
    loadAiUsage()
  }

  async function loadAiUsage() {
    const { data } = await supabase
      .schema('pmms')
      .from('ai_usage_log')
      .select('id, question, input_tokens, output_tokens, cost_usd, created_at')
      .order('created_at', { ascending: false })
      .limit(50)
    setAiUsageLog(data || [])
  }

  async function load() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, created_at, completed_at, first_assigned_at, property_id, assigned_builder_id')

    if (error) { setLoadError(error.message); setTickets([]); return }

    const withProperties = await attachProperties(data || [], 'address')
    setTickets(withProperties)
    setBuilders(await (profile.division ? fetchAssignableStaffForDivision(profile.division) : fetchAssignableBuilders()))

    const { data: categoriesRow } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'maintenance_categories')
      .maybeSingle()
    setCategoriesSettingsRow(categoriesRow)
    setCategoryOptions(await fetchAllMaintenanceCategoryNames(profile.division))
  }

  if (tickets === null) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading reports...</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
        <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load reports</p>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900, fontFamily: 'monospace' }}>{loadError}</p>
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

  const assignedInRange = scopedTickets.filter(t => {
    if (!t.first_assigned_at) return false
    const c = new Date(t.first_assigned_at).getTime()
    return c >= fromTime && c <= toTime
  })

  const avgTurnaroundMs = computeAvgTurnaroundMs(completedInRange)
  const avgResponseMs = computeAvgResponseMs(assignedInRange)

  // Weekly trend across the whole selected range, including empty weeks.
  const trendData = buildWeeklyTrend(fromDate, toDate, createdInRange, completedInRange)

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
  const recurringProperties = Object.entries(propertyCounts)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // Staff workload within the selected range.
  const workload = builders
    .map(b => {
      const assigned = createdInRange.filter(t => t.assigned_builder_id === b.id)
      const completed = completedInRange.filter(t => t.assigned_builder_id === b.id)
      return { id: b.id, name: b.name, assignedCount: assigned.length, completedCount: completed.length, avgMs: computeAvgTurnaroundMs(completed), avgResponseMs: computeAvgResponseMs(assigned) }
    })
    .filter(w => w.assignedCount > 0 || w.completedCount > 0)
    .sort((a, b) => b.assignedCount - a.assignedCount)

  // Every click-through in this page routes through here, so the current
  // Category/Staff filters this report is already scoped to always carry
  // over into Pipeline too (extra's own category/division/builderId, if
  // any, wins over these -- e.g. a specific breakdown bar's category).
  function goToPipeline(extra) {
    if (!onNavigate) return
    onNavigate('pipeline', {
      ...(categoryFilter !== 'All' ? { category: categoryFilter } : {}),
      ...(builderFilter !== 'All' ? { builderId: builderFilter } : {}),
      ...extra,
    })
  }

  const clickableTileStyle = (colour) => ({ ...tileStyle(colour), cursor: onNavigate ? 'pointer' : 'default' })

  return (
    <div>
      <h2 style={{ margin: '0 0 16px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Reports</h2>

      {isAdmin && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '12px 16px', marginBottom: '12px' }}>
            <span style={{ fontSize: '18px' }}>✨</span>
            <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate600, lineHeight: 1.5 }}>
              <b style={{ color: COLORS.slate900 }}>Ask AI (Claude Haiku 4.5)</b> — answers are generated from a snapshot of your real data. Review before relying on them for decisions; each question here has a small real cost (see AI Usage below).
            </p>
          </div>

          <div style={cardStyle}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={aiQuestion}
                onChange={(e) => setAiQuestion(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !aiLoading && aiQuestion.trim() && handleAskAi()}
                placeholder="e.g. Which properties have the most open tickets?"
                style={{ flex: 1, height: '44px', padding: '0 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', boxSizing: 'border-box' }}
              />
              <button onClick={handleAskAi} disabled={!aiQuestion.trim() || aiLoading} style={{ padding: '0 20px', borderRadius: '10px', border: 'none', background: COLORS.teal700, color: COLORS.white, fontWeight: 700, fontSize: '13px', cursor: 'pointer', opacity: !aiQuestion.trim() || aiLoading ? 0.5 : 1 }}>
                {aiLoading ? '...' : 'Ask →'}
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
              {AI_EXAMPLE_QUESTIONS.map(q => (
                <button key={q} onClick={() => { setAiQuestion(q); setAiAnswer(''); setAiError('') }} style={{ fontSize: '11.5px', padding: '5px 10px', borderRadius: '999px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate600, cursor: 'pointer' }}>
                  {q}
                </button>
              ))}
            </div>
          </div>

          {aiError && (
            <div style={{ ...cardStyle, background: COLORS.red50, border: `1px solid ${COLORS.red200}` }}>
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900 }}>{aiError}</p>
            </div>
          )}

          {aiAnswer && (
            <div style={cardStyle}>
              <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate900, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{aiAnswer}</p>
            </div>
          )}

          <div style={cardStyle}>
            <p style={cardLabelStyle}>AI Usage</p>
            {aiUsageLog.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No AI questions asked yet.</p>
            ) : (
              (() => {
                const now = Date.now()
                const weekAgo = now - 7 * 86400000
                const monthAgo = now - 30 * 86400000
                const sumCost = (rows) => rows.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0)
                const hasUnpriced = aiUsageLog.some(r => r.cost_usd == null)
                const weekRows = aiUsageLog.filter(r => new Date(r.created_at).getTime() >= weekAgo)
                const monthRows = aiUsageLog.filter(r => new Date(r.created_at).getTime() >= monthAgo)
                return (
                  <>
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                      <div style={tileStyle(COLORS.slate500)}>
                        <p style={tileLabelStyle}>Queries (last 50)</p>
                        <p style={tileValueStyle}>{aiUsageLog.length}</p>
                      </div>
                      <div style={tileStyle(COLORS.teal600)}>
                        <p style={tileLabelStyle}>Cost, Last 7 Days</p>
                        <p style={tileValueStyle}>${sumCost(weekRows).toFixed(2)}</p>
                      </div>
                      <div style={tileStyle(COLORS.purple600)}>
                        <p style={tileLabelStyle}>Cost, Last 30 Days</p>
                        <p style={tileValueStyle}>${sumCost(monthRows).toFixed(2)}</p>
                      </div>
                    </div>
                    {hasUnpriced && (
                      <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.amber700 }}>
                        Some queries show no cost because pricing isn't set yet -- see Settings &gt; AI Usage Pricing.
                      </p>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr>
                            <th style={thStyle}>Asked</th>
                            <th style={thStyle}>Question</th>
                            <th style={thStyle}>Tokens (in / out)</th>
                            <th style={thStyle}>Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiUsageLog.map(r => (
                            <tr key={r.id}>
                              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{formatUKDateTime(r.created_at)}</td>
                              <td style={tdStyle}>{r.question}</td>
                              <td style={tdStyle}>{r.input_tokens ?? '—'} / {r.output_tokens ?? '—'}</td>
                              <td style={tdStyle}>{r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              })()
            )}
          </div>
        </>
      )}

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
          {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={builderFilter} onChange={e => setBuilderFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Staff</option>
          {builders.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <div style={clickableTileStyle(COLORS.slate500)} onClick={() => goToPipeline({ fromDate, toDate })}>
          <p style={tileLabelStyle}>Tickets Raised (Range)</p>
          <p style={tileValueStyle}>{createdInRange.length}</p>
        </div>
        <div style={clickableTileStyle(COLORS.green600)} onClick={() => goToPipeline({ statusFilter: 'CompletedAll', fromDate, toDate })}>
          <p style={tileLabelStyle}>Completed (Range)</p>
          <p style={tileValueStyle}>{completedInRange.length}</p>
        </div>
        <div style={clickableTileStyle(COLORS.teal600)} onClick={() => goToPipeline({ statusFilter: 'OpenAll' })}>
          <p style={tileLabelStyle}>Currently Open</p>
          <p style={tileValueStyle}>{currentlyOpen.length}</p>
        </div>
        <div style={clickableTileStyle(COLORS.purple600)} onClick={() => goToPipeline({ statusFilter: 'CompletedAll', fromDate, toDate })}>
          <p style={tileLabelStyle}>Avg. Turnaround</p>
          <p style={tileValueStyle}>{avgMsLabel(avgTurnaroundMs)}</p>
        </div>
        {/* No Pipeline equivalent for "assigned within range" (first_assigned_at)
            to link to exactly -- Raised (Range) is the closest available set. */}
        <div style={clickableTileStyle(COLORS.blue600)} onClick={() => goToPipeline({ fromDate, toDate })}>
          <p style={tileLabelStyle}>Avg. Response Time</p>
          <p style={tileValueStyle}>{avgMsLabel(avgResponseMs)}</p>
        </div>
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Tickets Raised vs. Completed (by week)</p>
        <SimpleBarChart
          data={trendData}
          series={[
            { name: 'Raised', color: COLORS.blue500 },
            { name: 'Completed', color: COLORS.green600 },
          ]}
          onBarClick={(week, seriesIdx) => goToPipeline(
            seriesIdx === 0
              ? { fromDate: week.weekStartIso, toDate: week.weekEndIso }
              : { statusFilter: 'CompletedAll', fromDate: week.weekStartIso, toDate: week.weekEndIso }
          )}
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
          series={[{ name: breakdownMode === 'division' ? 'Division' : 'Category', color: COLORS.teal600 }]}
          onBarClick={(bar) => goToPipeline(
            breakdownMode === 'division'
              ? { division: bar.label, fromDate, toDate }
              : { category: bar.label, fromDate, toDate }
          )}
        />
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Properties With the Most Tickets</p>
        {recurringProperties.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No tickets match these filters.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recurringProperties.map((p, idx) => (
              <div
                key={idx}
                onClick={() => goToPipeline({ propertyId: p.id })}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}`, cursor: onNavigate ? 'pointer' : 'default' }}
              >
                <span style={{ fontSize: '13px', fontWeight: 600, color: onNavigate ? COLORS.blue700 : COLORS.slate900 }}>{p.address}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {p.count >= 3 && (
                    <span style={{ fontSize: '10px', fontWeight: 800, color: COLORS.red600, background: COLORS.red100, padding: '2px 8px', borderRadius: '20px' }}>⚠ Recurring</span>
                  )}
                  <span style={{ fontSize: '13px', fontWeight: 800, color: COLORS.slate900, fontFamily: 'monospace' }}>{p.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Staff Workload (Range)</p>
        {workload.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No assigned tickets match these filters.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                  <th style={thStyle}>Staff</th>
                  <th style={thStyle}>Raised</th>
                  <th style={thStyle}>Completed</th>
                  <th style={thStyle}>Avg. Turnaround</th>
                  <th style={thStyle}>Avg. Response Time</th>
                </tr>
              </thead>
              <tbody>
                {workload.map(w => (
                  <tr key={w.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                    <td style={{ ...tdStyle, color: COLORS.blue700, fontWeight: 700, cursor: 'pointer' }} onClick={() => setBuilderProfileId(w.id)}>{w.name}</td>
                    <td
                      style={{ ...tdStyle, ...(onNavigate ? { cursor: 'pointer', color: COLORS.blue700, fontWeight: 700 } : {}) }}
                      onClick={() => goToPipeline({ builderId: w.id, fromDate, toDate })}
                    >
                      {w.assignedCount}
                    </td>
                    <td
                      style={{ ...tdStyle, ...(onNavigate ? { cursor: 'pointer', color: COLORS.blue700, fontWeight: 700 } : {}) }}
                      onClick={() => goToPipeline({ builderId: w.id, statusFilter: 'CompletedAll', fromDate, toDate })}
                    >
                      {w.completedCount}
                    </td>
                    <td style={tdStyle}>{avgMsLabel(w.avgMs)}</td>
                    <td style={tdStyle}>{avgMsLabel(w.avgResponseMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <BuilderProfileModal builderId={builderProfileId} onClose={() => setBuilderProfileId(null)} />
    </div>
  )
}
