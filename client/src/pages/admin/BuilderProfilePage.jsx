// Full-page staff profile, replacing the old BuilderProfileModal popup.
// Self-contained -- fetches everything it needs from just a staffId, same
// as the modal it replaces, so AdminBuilders.jsx only has to swap the
// trigger/state, not own extra fetch logic.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import SimpleBarChart from '../../components/SimpleBarChart'
import {
  Avatar, KpiTiles, roleBadgeStyle, STAFF_AVAILABILITY_STYLES,
  formatUKDateTime, formatDurationDays,
  computeDutyStatus, computeAvgTurnaroundMs, buildWeeklyTrend,
} from './shared'

const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardLabelStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
const ACTIVITY_PREVIEW_COUNT = 10
const TREND_WEEKS = 8

// Powers automated matching against a property's staff_gender_restriction
// (see PropertyCoreTab.jsx's CleanerAssignmentSection) -- general-purpose,
// not Housekeeping-specific, same as that restriction field itself. This
// whole page has no other editable fields (staff details are set once at
// account creation), so this is a small self-contained inline editor
// rather than fitting into a larger edit-mode toggle that doesn't exist yet.
function GenderRow({ staff, onSaved }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(staff.gender || '')
  const [saving, setSaving] = useState(false)

  function startEdit() {
    setValue(staff.gender || '')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    await supabase.from('staff').update({ gender: value || null }).eq('id', staff.id)
    setSaving(false)
    onSaved(value || null)
    setEditing(false)
  }

  if (!editing) {
    return (
      <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: COLORS.slate500, display: 'flex', alignItems: 'center', gap: '8px' }}>
        Gender: {staff.gender || 'Not set'}
        <button onClick={startEdit} style={{ fontSize: '11px', fontWeight: 700, color: COLORS.blue700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Edit</button>
      </p>
    )
  }

  return (
    <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
      <select value={value} onChange={(e) => setValue(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px' }}>
        <option value="">Not set</option>
        <option value="Male">Male</option>
        <option value="Female">Female</option>
      </select>
      <button onClick={save} disabled={saving} style={{ fontSize: '12px', fontWeight: 700, color: COLORS.white, background: COLORS.green600, border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: saving ? 'not-allowed' : 'pointer' }}>
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button onClick={() => setEditing(false)} style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate600, background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  )
}

export default function BuilderProfilePage({ staffId, onBack }) {
  const [staff, setStaff] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [role, setRole] = useState(null)
  const [availability, setAvailability] = useState(null)
  const [tickets, setTickets] = useState([])
  const [workSessions, setWorkSessions] = useState([])
  const [activity, setActivity] = useState([])
  const [showAllActivity, setShowAllActivity] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setStaff(null)
      setLoadError(false)
      setShowAllActivity(false)

      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('id, name, email, job_title, department, phone, skills, photo_url, active, gender')
        .eq('id', staffId)
        .single()

      const { data: roleRow } = await supabase
        .schema('pmms')
        .from('staff_roles')
        .select('role')
        .eq('staff_id', staffId)
        .maybeSingle()

      const { data: availabilityRow } = await supabase
        .schema('pmms')
        .from('staff_availability')
        .select('status, note')
        .eq('staff_id', staffId)
        .maybeSingle()

      const { data: ticketDataRaw } = await supabase
        .schema('pmms')
        .from('tickets')
        .select('id, ticket_number, status, description, room, category, priority_score, mileage_logged, created_at, completed_at, property_id')
        .eq('assigned_builder_id', staffId)

      const ticketData = await attachProperties(ticketDataRaw || [], 'address')

      const { data: sessionData } = await supabase
        .schema('pmms')
        .from('work_sessions')
        .select('id, started_at, ended_at')
        .eq('builder_id', staffId)
        .not('ended_at', 'is', null)

      const { data: activityData } = await supabase
        .schema('pmms')
        .from('audit_events')
        .select('id, ticket_id, action, summary, created_at')
        .eq('actor_id', staffId)
        .order('created_at', { ascending: false })

      if (!cancelled) {
        // .single() errors (RLS turning up zero/multiple rows, a transient
        // fetch failure) used to leave the modal silently never opening --
        // same guard, carried over here.
        if (staffError || !staffData) {
          setLoadError(true)
        } else {
          setStaff(staffData)
        }
        setRole(roleRow?.role || null)
        setAvailability(availabilityRow || null)
        setTickets(ticketData || [])
        setWorkSessions(sessionData || [])
        setActivity(activityData || [])
      }
    }

    load()
    return () => { cancelled = true }
  }, [staffId])

  if (loadError) {
    return (
      <div>
        <button onClick={onBack} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer', marginBottom: '16px' }}>
          ← Back to Staff
        </button>
        <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '16px', padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.red600 }}>Couldn't load this profile</p>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.red900 }}>Something went wrong fetching this staff member's details. Try going back and reopening their profile.</p>
        </div>
      </div>
    )
  }

  if (!staff) {
    return (
      <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading profile...</p>
      </div>
    )
  }

  const { activeJobs, inProgressJob, badge: dutyBadge } = computeDutyStatus(tickets, availability?.status)
  const completedJobs = tickets.filter(t => t.status === 'Completed' || t.status === 'Archived')
  const totalMiles = tickets.reduce((sum, t) => sum + (t.mileage_logged || 0), 0)
  const hoursWorkedMs = workSessions.reduce((sum, s) => sum + (new Date(s.ended_at) - new Date(s.started_at)), 0)
  const avgTurnaroundMs = computeAvgTurnaroundMs(completedJobs)

  const kpis = [
    { label: 'Active Jobs', value: activeJobs.length, colour: COLORS.blue500 },
    { label: 'Completed Jobs', value: completedJobs.length, colour: COLORS.green600 },
    { label: 'Avg Turnaround', value: avgTurnaroundMs != null ? formatDurationDays(avgTurnaroundMs) : 'N/A', colour: COLORS.purple600 },
    { label: 'Hours Worked', value: formatDurationDays(hoursWorkedMs), colour: COLORS.teal600 },
    { label: 'Total Miles', value: totalMiles.toFixed(1), colour: COLORS.amber600 },
    { label: 'Activity Events', value: activity.length, colour: COLORS.slate500 },
  ]

  const trendFrom = new Date(Date.now() - TREND_WEEKS * 7 * 86400000)
  const trendTo = new Date()
  const trendData = buildWeeklyTrend(trendFrom, trendTo, tickets, completedJobs)

  const categoryCounts = {}
  tickets.forEach(t => {
    const key = t.category || 'Uncategorised'
    categoryCounts[key] = (categoryCounts[key] || 0) + 1
  })
  const categoryChartData = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ label: key, values: [count] }))

  const availabilityStyle = STAFF_AVAILABILITY_STYLES[availability?.status] || STAFF_AVAILABILITY_STYLES['Available']
  const roleStyle = roleBadgeStyle(role?.toLowerCase())

  const visibleActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_PREVIEW_COUNT)

  return (
    <div>
      <button onClick={onBack} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer', marginBottom: '16px' }}>
        ← Back to Staff
      </button>

      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <Avatar name={staff.name} photoUrl={staff.photo_url} size={64} />
          <div style={{ flex: 1, minWidth: '200px' }}>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>{staff.name}</h1>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: dutyBadge.color, background: dutyBadge.bg, padding: '3px 10px', borderRadius: '20px' }}>{dutyBadge.label}</span>
              {availability && (
                <span style={{ fontSize: '11px', fontWeight: 800, color: availabilityStyle.color, background: availabilityStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>
                  {availability.status}{availability.note ? `: ${availability.note}` : ''}
                </span>
              )}
              {role && (
                <span style={{ fontSize: '11px', fontWeight: 800, color: roleStyle.color, background: roleStyle.bg, padding: '3px 10px', borderRadius: '20px' }}>{role}</span>
              )}
              {staff.active === false && (
                <span style={{ fontSize: '11px', fontWeight: 800, color: COLORS.red600, background: COLORS.red100, padding: '3px 10px', borderRadius: '20px' }}>Deactivated</span>
              )}
            </div>
            <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>
              {[staff.job_title, staff.department].filter(Boolean).join(' · ') || '—'}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>
              {[staff.phone, staff.email].filter(Boolean).join(' · ') || '—'}
            </p>
            <GenderRow staff={staff} onSaved={(gender) => setStaff(prev => ({ ...prev, gender }))} />
            {staff.skills?.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                {staff.skills.map(skill => (
                  <span key={skill} style={{ fontSize: '11px', fontWeight: 600, color: COLORS.slate600, background: COLORS.slate100, padding: '3px 10px', borderRadius: '20px' }}>{skill}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <KpiTiles kpis={kpis} />

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Jobs Assigned vs. Completed (last {TREND_WEEKS} weeks)</p>
        <SimpleBarChart
          data={trendData}
          series={[
            { name: 'Assigned', color: COLORS.blue500 },
            { name: 'Completed', color: COLORS.green600 },
          ]}
        />
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Jobs by Category (all-time)</p>
        <SimpleBarChart data={categoryChartData} series={[{ name: 'Category', color: COLORS.teal600 }]} />
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Current Assignment</p>
        {inProgressJob ? (
          <div style={{ background: COLORS.green50, border: `1px solid ${COLORS.green200}`, borderRadius: '10px', padding: '12px' }}>
            <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.green600 }}>#{inProgressJob.ticket_number}</span>
            <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{inProgressJob.property?.address}</span>
            <span style={{ display: 'block', fontSize: '13px', color: COLORS.slate600 }}>{inProgressJob.room || '—'} → {inProgressJob.description}</span>
          </div>
        ) : activeJobs.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {activeJobs.map(j => (
              <div key={j.id} style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '10px 12px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{j.ticket_number}</span>{' '}
                <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{j.property?.address}</span>{' '}
                <span style={{ fontSize: '12px', color: COLORS.slate500 }}>— {j.status}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No active assignment.</p>
        )}
      </div>

      <div style={cardStyle}>
        <p style={cardLabelStyle}>Activity</p>
        {activity.length === 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No recorded activity for this person yet.</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {visibleActivity.map(a => (
                <div key={a.id} style={{ padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>{a.action}{a.ticket_id ? ` · Job` : ''}</span>
                    <span style={{ fontSize: '11px', color: COLORS.slate400, whiteSpace: 'nowrap' }}>{formatUKDateTime(a.created_at)}</span>
                  </div>
                  {a.summary && <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: COLORS.slate600 }}>{a.summary}</p>}
                </div>
              ))}
            </div>
            {activity.length > ACTIVITY_PREVIEW_COUNT && (
              <button
                onClick={() => setShowAllActivity(v => !v)}
                style={{ marginTop: '12px', padding: '8px 14px', background: COLORS.slate100, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer' }}
              >
                {showAllActivity ? 'Show fewer' : `Show all ${activity.length} events`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
