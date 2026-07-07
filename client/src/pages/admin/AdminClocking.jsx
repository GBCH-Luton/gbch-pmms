import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { distanceMetres, googleMapsLink, ensurePropertyCoords } from '../../lib/geo'
import { attachProperties } from '../../lib/properties'
import {
  thStyle, tdStyle, actionBtnStyle, filterSelectStyle, formatUKDateTime,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle,
  modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle, fetchAssignableBuilders,
} from './shared'

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000
const DEFAULT_CLOCK_DISTANCE_THRESHOLD_M = 250

// Compact map-pin link + optional "too far" flag shown under a clock-in or
// clock-out time in the timesheet, when that event has a recorded location.
function LocationCell({ distance, thresholdM, lat, lng }) {
  if (lat == null || lng == null) return null
  const tooFar = distance != null && distance > thresholdM
  return (
    <div style={{ fontFamily: 'system-ui', marginTop: '2px' }}>
      <a href={googleMapsLink(lat, lng)} target="_blank" rel="noreferrer" style={{ fontSize: '11px', fontWeight: 700, color: '#1d4ed8', textDecoration: 'none' }}>
        📍 Map
      </a>
      {tooFar && (
        <span style={{ display: 'block', fontSize: '10px', fontWeight: 800, color: '#dc2626' }}>
          ⚠ {Math.round(distance)}m away
        </span>
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

function toLocalInputValue(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function AdminClocking({ profile }) {
  const [loading, setLoading] = useState(true)
  const [liveSessions, setLiveSessions] = useState([])
  const [completedRows, setCompletedRows] = useState([])
  const [builders, setBuilders] = useState([])
  const [builderFilter, setBuilderFilter] = useState('All')
  const [distanceThresholdM, setDistanceThresholdM] = useState(DEFAULT_CLOCK_DISTANCE_THRESHOLD_M)
  const [, setTick] = useState(0)

  const [editRow, setEditRow] = useState(null)
  const [editClockIn, setEditClockIn] = useState('')
  const [editClockOut, setEditClockOut] = useState('')
  const [editError, setEditError] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  useEffect(() => {
    fetchAll()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (editRow) {
      setEditClockIn(toLocalInputValue(new Date(editRow.firstIn).getTime()))
      setEditClockOut(toLocalInputValue(new Date(editRow.lastOut).getTime()))
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

    // Two different builder lists, same distinction AdminPipeline draws: an
    // unfiltered staff lookup to resolve names for ANY historical assignee
    // (even someone since deactivated or moved off the Builder role), and
    // fetchAssignableBuilders() -- active PMMS Builders only -- for the
    // filter dropdown, so it matches what Pipeline/Reassign actually offer.
    const { data: builderData } = await supabase
      .from('staff')
      .select('id, name')
    setBuilders(await fetchAssignableBuilders())

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
        .select('id, category, description, room, property_id')
        .in('id', ticketIds)
      liveTicketData = await attachProperties(data || [], 'address, postcode, latitude, longitude')
    }

    // --- Sections 2 & 3: completed tickets with recorded work sessions ---
    const { data: completedTicketsRaw } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, category, description, room, mileage_logged, assigned_builder_id, property_id')
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
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.lastOut) - new Date(a.lastOut))
    }
    setCompletedRows(rows)

    setLoading(false)
  }

  function openEditModal(row) { setEditRow(row) }
  function closeEditModal() { setEditRow(null) }

  async function submitEdit() {
    if (!editClockIn || !editClockOut) { setEditError('Please fill in both times.'); return }

    const newIn = new Date(editClockIn).getTime()
    const newOut = new Date(editClockOut).getTime()
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

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading clocking data...</p>
    </div>
  )

  return (
    <div>

      {/* Section 1: Currently Clocked In */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Currently Clocked In</h2>
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#64748b' }}>Live running timers. A red row means the job has been running past 8 hours — the builder may have forgotten to clock out.</p>

        {liveSessions.length === 0 && (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Nobody is clocked in right now.</p>
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
                  background: overrun ? '#fef2f2' : '#f0fdfa',
                  border: overrun ? '1px solid #fecaca' : '1px solid #99f6e4',
                }}
              >
                <div>
                  <strong style={{ display: 'block', fontSize: '13px', color: '#0f172a' }}>{row.builderName}</strong>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>
                    #{row.ticket.id} · {row.ticket.property?.address} — {row.ticket.room || '—'} → {row.ticket.description}
                  </span>
                  {overrun && (
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', fontWeight: 800, color: '#dc2626' }}>
                      ⏱ Over 8h — check builder hasn't forgotten to clock out
                    </span>
                  )}
                  {tooFar && (
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '11px', fontWeight: 800, color: '#dc2626' }}>
                      ⚠ Clocked in {Math.round(row.clockInDistance)}m from the property
                    </span>
                  )}
                  {hasPin && (
                    <a href={googleMapsLink(row.session.clock_in_lat, row.session.clock_in_lng)} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '4px', fontSize: '11px', fontWeight: 700, color: '#1d4ed8' }}>
                      📍 View clock-in location
                    </a>
                  )}
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: 800, color: overrun ? '#dc2626' : '#0d9488', whiteSpace: 'nowrap' }}>
                  {formatDuration(elapsedMs)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Section 2: Average Time by Job Type */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Average Time by Job Type</h2>
        <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: '#64748b' }}>Based on completed jobs with recorded clock times.</p>

        {categoryEntries.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No completed jobs with recorded time yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {categoryEntries.map(([category, stats]) => (
              <div key={category} style={{ background: '#0d9488', borderRadius: '16px', padding: '16px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{category}</span>
                <strong style={{ display: 'block', fontSize: '28px', fontWeight: 800, color: '#ffffff', marginTop: '8px' }}>{formatDuration(stats.totalMs / stats.count)}</strong>
                <span style={{ display: 'block', fontSize: '11px', color: 'rgba(255,255,255,0.75)', marginTop: '4px' }}>avg over {stats.count} job{stats.count === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 3: Completed Job Timesheet */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <div>
            <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>Completed Job Timesheet</h2>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Clock-in, clock-out, total worked time and mileage per finished job.</p>
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
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={thStyle}>Job</th>
                <th style={thStyle}>Builder</th>
                <th style={thStyle}>Clock-In</th>
                <th style={thStyle}>Clock-Out</th>
                <th style={thStyle}>Total Time</th>
                <th style={thStyle}>Miles</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Correct</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompletedRows.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>
                    No completed jobs to show.
                  </td>
                </tr>
              )}
              {filteredCompletedRows.map(row => (
                <tr key={row.ticket.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={tdStyle}>
                    <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#94a3b8' }}>#{row.ticket.id}</span>
                    <span style={{ display: 'block', fontWeight: 700, color: '#0f172a' }}>{row.ticket.property?.address}</span>
                    <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>{row.ticket.room || '—'} → {row.ticket.description}</span>
                  </td>
                  <td style={tdStyle}>{row.builderName}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {formatUKDateTime(row.firstIn)}
                    <LocationCell distance={row.clockInDistance} thresholdM={distanceThresholdM} lat={row.firstSession.clock_in_lat} lng={row.firstSession.clock_in_lng} />
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '12px' }}>
                    {formatUKDateTime(row.lastOut)}
                    <LocationCell distance={row.clockOutDistance} thresholdM={distanceThresholdM} lat={row.lastSession.clock_out_lat} lng={row.lastSession.clock_out_lng} />
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 800, color: '#0d9488', fontFamily: 'monospace' }}>
                    {formatDuration(row.totalMs)}
                    {row.sessions.length > 1 && (
                      <span style={{ display: 'block', fontSize: '10px', color: '#94a3b8', fontWeight: 600 }}>{row.sessions.length} sessions</span>
                    )}
                  </td>
                  <td style={tdStyle}>{(row.ticket.mileage_logged || 0).toFixed(1)}</td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <button onClick={() => openEditModal(row)} style={actionBtnStyle}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit clock times modal */}
      {editRow && (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <p style={modalTitleStyle}>Correct Clock Times — Job #{editRow.ticket.id}</p>
            <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#64748b' }}>{editRow.ticket.property?.address}</p>

            <label style={modalLabelStyle}>Clock-In</label>
            <input
              type="datetime-local"
              value={editClockIn}
              onChange={(e) => setEditClockIn(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
            />

            <label style={modalLabelStyle}>Clock-Out</label>
            <input
              type="datetime-local"
              value={editClockOut}
              onChange={(e) => setEditClockOut(e.target.value)}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
            />

            {editRow.sessions.length > 1 && (
              <p style={{ margin: '10px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
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

    </div>
  )
}
