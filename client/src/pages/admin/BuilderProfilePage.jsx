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
  formatUKDateTime, formatUKDate, formatDurationDays, formatDuration,
  computeDutyStatus, computeAvgTurnaroundMs, buildWeeklyTrend,
  ukDateKey, shiftDateKey, mondayOfWeek, firstOfMonth, fetchAttendanceSummary, fetchMileageSummary,
} from './shared'
import PrintableAttendanceReport from '../../components/PrintableAttendanceReport'
import PrintableMileageReport from '../../components/PrintableMileageReport'

const cardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const cardLabelStyle = { margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
const ACTIVITY_PREVIEW_COUNT = 10
const TREND_WEEKS = 8

// Every card on this page was the same white background + grey label,
// which made it easy to lose track of which section you were in while
// scanning. A thin top border plus a matching label colour gives each one
// its own identity without breaking the app's white-card convention used
// everywhere else -- picked from colours already meaningful within each
// card (green for "in progress", teal for hours, blue for miles) so the
// accent reinforces what's already there rather than adding a new meaning.
const SECTION_ACCENTS = {
  assignment: COLORS.green600,
  attendance: COLORS.teal700,
  mileage: COLORS.blue600,
  trend: COLORS.indigo700,
  category: COLORS.violet600,
  activity: COLORS.slate600,
}
function sectionCardStyle(accent) {
  return { ...cardStyle, borderTop: `3px solid ${accent}` }
}
function sectionLabelStyle(accent, extra) {
  return { ...cardLabelStyle, color: accent, ...extra }
}

// Calendar-based, not rolling windows -- "Yesterday" means yesterday and
// "This Month" means the calendar month so far, so "how many hours did he
// work yesterday/this month" is a single click rather than scanning the
// day list for the right row. Previewed as an artifact and approved before
// building (see conversation this came out of).
const ATTENDANCE_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'quarter', label: 'Last 3 Months' },
]

function attendanceRangeFor(periodKey) {
  const today = ukDateKey()
  if (periodKey === 'yesterday') { const y = shiftDateKey(today, -1); return { from: y, to: y } }
  if (periodKey === 'week') return { from: mondayOfWeek(today), to: today }
  if (periodKey === 'month') return { from: firstOfMonth(today), to: today }
  if (periodKey === 'quarter') return { from: shiftDateKey(today, -89), to: today }
  return { from: today, to: today } // 'today'
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function shiftMonth({ year, month }, delta) {
  const d = new Date(Date.UTC(year, month + delta, 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() }
}
function sameMonth(a, b) { return a.year === b.year && a.month === b.month }

function AttendanceStat({ label, value, colour }) {
  return (
    <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 4px 0', fontSize: '10px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: colour }}>{value}</p>
    </div>
  )
}

function AttendanceFlag({ label, colour, bg }) {
  return (
    <span style={{ fontSize: '10px', fontWeight: 700, color: colour, background: bg, padding: '2px 8px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{label}</span>
  )
}

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
  const [assignmentOpen, setAssignmentOpen] = useState(false)

  // Attendance & Hours -- day-level daily_attendance, separate from the
  // per-job work_sessions the KPI tiles above already use. Fetched
  // independently of the main load() effect since it re-fetches on its
  // own whenever the period changes, not just when staffId changes.
  const [attendancePeriod, setAttendancePeriod] = useState('today')
  const [attendanceSummary, setAttendanceSummary] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)
  const [showAllAttendance, setShowAllAttendance] = useState(false)
  const [showAttendanceReport, setShowAttendanceReport] = useState(false)

  // Mileage -- month-level breakdown of tickets.mileage_logged. A month
  // picker rather than the day/week/quarter tabs Attendance & Hours uses,
  // since "which month" is how a builder actually thinks about mileage
  // (matches the artifact this was previewed as before building).
  const todayUkParts = ukDateKey().split('-').map(Number)
  const [mileageOpen, setMileageOpen] = useState(false)
  const [mileageMonth, setMileageMonth] = useState({ year: todayUkParts[0], month: todayUkParts[1] - 1 })
  const [mileageSummary, setMileageSummary] = useState(null)
  const [mileageLoading, setMileageLoading] = useState(true)
  const [showMileageReport, setShowMileageReport] = useState(false)

  useEffect(() => {
    let cancelled = false
    setMileageLoading(true)
    const { year, month } = mileageMonth
    const mm = String(month + 1).padStart(2, '0')
    const fromDateKey = `${year}-${mm}-01`
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const toDateKey = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
    fetchMileageSummary(staffId, fromDateKey, toDateKey).then(summary => {
      if (!cancelled) { setMileageSummary(summary); setMileageLoading(false) }
    })
    return () => { cancelled = true }
  }, [staffId, mileageMonth])

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

  useEffect(() => {
    let cancelled = false
    setAttendanceLoading(true)
    setShowAllAttendance(false)
    const { from, to } = attendanceRangeFor(attendancePeriod)
    fetchAttendanceSummary(staffId, from, to).then(summary => {
      if (!cancelled) { setAttendanceSummary(summary); setAttendanceLoading(false) }
    })
    return () => { cancelled = true }
  }, [staffId, attendancePeriod])

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

      <div style={sectionCardStyle(SECTION_ACCENTS.assignment)}>
        <button
          onClick={() => setAssignmentOpen(v => !v)}
          style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <p style={sectionLabelStyle(SECTION_ACCENTS.assignment, { margin: 0 })}>Current Assignment</p>
            {!assignmentOpen && (
              <span style={{ fontSize: '12px', fontWeight: 700, color: inProgressJob || activeJobs.length > 0 ? COLORS.green600 : COLORS.slate400 }}>
                {inProgressJob ? `#${inProgressJob.ticket_number} in progress` : activeJobs.length > 0 ? `${activeJobs.length} active` : 'None'}
              </span>
            )}
          </div>
          <span style={{ fontSize: '13px', color: COLORS.slate400, fontWeight: 700, flexShrink: 0 }}>
            {assignmentOpen ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>

        {assignmentOpen && (
          <div style={{ marginTop: '12px' }}>
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
        )}
      </div>

      <KpiTiles kpis={kpis} />

      <div style={sectionCardStyle(SECTION_ACCENTS.attendance)}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
          <p style={sectionLabelStyle(SECTION_ACCENTS.attendance, { margin: 0 })}>Attendance &amp; Hours</p>
          <button
            onClick={() => setShowAttendanceReport(true)}
            disabled={attendanceLoading || !attendanceSummary}
            style={{
              padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
              border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600,
              cursor: (attendanceLoading || !attendanceSummary) ? 'not-allowed' : 'pointer',
              opacity: (attendanceLoading || !attendanceSummary) ? 0.5 : 1,
            }}
          >
            Export as PDF
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
          {ATTENDANCE_PERIODS.map(p => (
            <button
              key={p.key}
              onClick={() => setAttendancePeriod(p.key)}
              style={{
                padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                border: attendancePeriod === p.key ? `1px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
                background: attendancePeriod === p.key ? COLORS.teal700 : COLORS.white,
                color: attendancePeriod === p.key ? COLORS.white : COLORS.slate600,
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {attendanceLoading ? (
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontWeight: 600 }}>Loading...</p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
              <AttendanceStat label="Total Hours" value={formatDurationDays(attendanceSummary.totalMs)} colour={COLORS.teal600} />
              <AttendanceStat label="Days Worked" value={attendanceSummary.daysWorked} colour={COLORS.blue600} />
              <AttendanceStat label="Late" value={attendanceSummary.lateCount} colour={attendanceSummary.lateCount > 0 ? COLORS.amber600 : COLORS.slate400} />
              <AttendanceStat label="Left Early" value={attendanceSummary.earlyLeaveCount} colour={attendanceSummary.earlyLeaveCount > 0 ? COLORS.amber600 : COLORS.slate400} />
              <AttendanceStat label="Overtime" value={attendanceSummary.overtimeCount} colour={attendanceSummary.overtimeCount > 0 ? COLORS.purple600 : COLORS.slate400} />
              {/* Missed Clock-Outs is a permanent record -- stays counted
                  even after a manager corrects it, since fixing the row
                  isn't the same as it never having happened. Still Open is
                  just what needs action right now, and clears once fixed. */}
              <AttendanceStat label="Missed Clock-Outs" value={attendanceSummary.missedClockOutCount} colour={attendanceSummary.missedClockOutCount > 0 ? COLORS.red600 : COLORS.slate400} />
              {attendanceSummary.incompleteCount > 0 && (
                <AttendanceStat label="Still Open" value={attendanceSummary.incompleteCount} colour={COLORS.red600} />
              )}
            </div>

            {attendanceSummary.days.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No attendance recorded in this period.</p>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {(showAllAttendance ? attendanceSummary.days : attendanceSummary.days.slice(0, ACTIVITY_PREVIEW_COUNT)).map(day => (
                    <div key={day.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '10px 0', borderBottom: `1px solid ${COLORS.slate100}`, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: '110px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{formatUKDate(day.work_date)}</span>
                      </div>
                      <div style={{ flex: 1, minWidth: '220px', fontSize: '12px', color: COLORS.slate500, fontFamily: 'monospace' }}>
                        {formatUKDateTime(day.clock_in_at).split(' ').slice(-1)[0]}
                        {' → '}
                        {day.clock_out_at ? formatUKDateTime(day.clock_out_at).split(' ').slice(-1)[0] : 'still clocked in'}
                      </div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900, fontFamily: 'monospace', minWidth: '70px', textAlign: 'right' }}>
                        {day.durationMs != null ? formatDuration(day.durationMs) : '—'}
                        {day.isLive && <span style={{ fontWeight: 600, color: COLORS.teal600 }}> so far</span>}
                      </div>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {day.late_flag && <AttendanceFlag label="Late" colour={COLORS.amber700} bg={COLORS.amber100} />}
                        {day.early_leave_reason && <AttendanceFlag label="Left early" colour={COLORS.amber700} bg={COLORS.amber100} />}
                        {day.overtime && <AttendanceFlag label="Overtime" colour={COLORS.purple700} bg={COLORS.purple100} />}
                        {(day.clock_in_override || day.clock_out_override) && <AttendanceFlag label="Manager override" colour={COLORS.slate600} bg={COLORS.slate100} />}
                        {day.wasMissed && (
                          <AttendanceFlag
                            label={day.incomplete ? 'No clock-out' : 'Missed clock-out (corrected)'}
                            colour={COLORS.red600}
                            bg={COLORS.red100}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {attendanceSummary.days.length > ACTIVITY_PREVIEW_COUNT && (
                  <button
                    onClick={() => setShowAllAttendance(v => !v)}
                    style={{ marginTop: '12px', padding: '8px 14px', background: COLORS.slate100, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, color: COLORS.slate600, cursor: 'pointer' }}
                  >
                    {showAllAttendance ? 'Show fewer' : `Show all ${attendanceSummary.days.length} days`}
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div style={sectionCardStyle(SECTION_ACCENTS.mileage)}>
        <button
          onClick={() => setMileageOpen(v => !v)}
          style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <p style={sectionLabelStyle(SECTION_ACCENTS.mileage, { margin: 0 })}>Mileage</p>
            {!mileageOpen && mileageSummary && (
              <span style={{ fontSize: '12px', fontWeight: 700, color: mileageSummary.totalMiles > 0 ? COLORS.blue600 : COLORS.slate400 }}>
                {mileageSummary.totalMiles.toFixed(1)} mi · {MONTH_NAMES[mileageMonth.month]}
              </span>
            )}
          </div>
          <span style={{ fontSize: '13px', color: COLORS.slate400, fontWeight: 700, flexShrink: 0 }}>
            {mileageOpen ? '▲ Collapse' : '▼ Expand'}
          </span>
        </button>

        {mileageOpen && (
          <div style={{ marginTop: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={() => setMileageMonth(m => shiftMonth(m, -1))}
                  aria-label="Previous month"
                  style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >‹</button>
                <span style={{ fontSize: '14px', fontWeight: 800, color: COLORS.slate900, minWidth: '120px', textAlign: 'center' }}>
                  {MONTH_NAMES[mileageMonth.month]} {mileageMonth.year}
                </span>
                <button
                  onClick={() => setMileageMonth(m => shiftMonth(m, 1))}
                  disabled={sameMonth(mileageMonth, { year: todayUkParts[0], month: todayUkParts[1] - 1 })}
                  aria-label="Next month"
                  style={{ width: '28px', height: '28px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '13px', fontWeight: 700, cursor: 'pointer', opacity: sameMonth(mileageMonth, { year: todayUkParts[0], month: todayUkParts[1] - 1 }) ? 0.4 : 1 }}
                >›</button>
              </div>
              <button
                onClick={() => setShowMileageReport(true)}
                disabled={mileageLoading || !mileageSummary}
                style={{
                  padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                  border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600,
                  cursor: (mileageLoading || !mileageSummary) ? 'not-allowed' : 'pointer',
                  opacity: (mileageLoading || !mileageSummary) ? 0.5 : 1,
                }}
              >
                Export as PDF
              </button>
            </div>

            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
              {['This Month', 'Last Month'].map(label => {
                const target = label === 'This Month'
                  ? { year: todayUkParts[0], month: todayUkParts[1] - 1 }
                  : shiftMonth({ year: todayUkParts[0], month: todayUkParts[1] - 1 }, -1)
                const active = sameMonth(mileageMonth, target)
                return (
                  <button
                    key={label}
                    onClick={() => setMileageMonth(target)}
                    style={{
                      padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer',
                      border: active ? `1px solid ${COLORS.blue600}` : `1px solid ${COLORS.slate200}`,
                      background: active ? COLORS.blue600 : COLORS.white,
                      color: active ? COLORS.white : COLORS.slate600,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            {mileageLoading ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontWeight: 600 }}>Loading...</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                  <AttendanceStat label="Total Miles" value={mileageSummary.totalMiles.toFixed(1)} colour={COLORS.blue600} />
                  <AttendanceStat label="Trips Logged" value={mileageSummary.tripCount} colour={COLORS.blue600} />
                  <AttendanceStat label="Avg Miles / Trip" value={mileageSummary.tripCount ? mileageSummary.avgMilesPerTrip.toFixed(1) : '—'} colour={COLORS.slate500} />
                  <AttendanceStat label="Days With Travel" value={mileageSummary.daysWithTravel} colour={COLORS.slate500} />
                </div>

                {mileageSummary.trips.length === 0 ? (
                  <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No mileage logged in {MONTH_NAMES[mileageMonth.month]}.</p>
                ) : (
                  (() => {
                    const byDate = new Map()
                    mileageSummary.trips.forEach(t => {
                      if (!byDate.has(t.dateKey)) byDate.set(t.dateKey, [])
                      byDate.get(t.dateKey).push(t)
                    })
                    return [...byDate.entries()].map(([dateKey, dayTrips]) => {
                      const dayTotal = dayTrips.reduce((sum, t) => sum + Number(t.mileage_logged), 0)
                      return (
                        <div key={dateKey} style={{ marginBottom: '4px' }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 0 6px', borderBottom: `1px solid ${COLORS.slate200}` }}>
                            <span style={{ fontSize: '12.5px', fontWeight: 800, color: COLORS.slate900 }}>{formatUKDate(dateKey)}</span>
                            <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate500 }}>{dayTotal.toFixed(1)} mi</span>
                          </div>
                          {dayTrips.map(t => (
                            <div key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 0', borderBottom: `1px solid ${COLORS.slate100}` }}>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: COLORS.slate900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.property?.address || '—'}</span>
                                <span style={{ fontSize: '11.5px', color: COLORS.slate500 }}>
                                  <span style={{ display: 'inline-block', fontSize: '10.5px', fontWeight: 700, padding: '1px 8px', borderRadius: '999px', background: COLORS.blue50, color: COLORS.blue700, marginRight: '6px' }}>{t.transit_start || '—'}</span>
                                  Job #{t.ticket_number}
                                </span>
                              </div>
                              <span style={{ fontSize: '14px', fontWeight: 800, color: COLORS.blue600, flexShrink: 0 }}>{Number(t.mileage_logged).toFixed(1)} mi</span>
                            </div>
                          ))}
                        </div>
                      )
                    })
                  })()
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div style={sectionCardStyle(SECTION_ACCENTS.trend)}>
        <p style={sectionLabelStyle(SECTION_ACCENTS.trend)}>Jobs Assigned vs. Completed (last {TREND_WEEKS} weeks)</p>
        <SimpleBarChart
          data={trendData}
          series={[
            { name: 'Assigned', color: COLORS.blue500 },
            { name: 'Completed', color: COLORS.green600 },
          ]}
        />
      </div>

      <div style={sectionCardStyle(SECTION_ACCENTS.category)}>
        <p style={sectionLabelStyle(SECTION_ACCENTS.category)}>Jobs by Category (all-time)</p>
        <SimpleBarChart data={categoryChartData} series={[{ name: 'Category', color: COLORS.teal600 }]} />
      </div>

      <div style={sectionCardStyle(SECTION_ACCENTS.activity)}>
        <p style={sectionLabelStyle(SECTION_ACCENTS.activity)}>Activity</p>
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

      {showAttendanceReport && attendanceSummary && (() => {
        const { from, to } = attendanceRangeFor(attendancePeriod)
        const periodLabel = ATTENDANCE_PERIODS.find(p => p.key === attendancePeriod)?.label
        const rangeLabel = from === to ? formatUKDate(from) : `${formatUKDate(from)} – ${formatUKDate(to)}`
        return (
          <PrintableAttendanceReport
            staffName={staff.name}
            periodLabel={periodLabel}
            rangeLabel={rangeLabel}
            summary={attendanceSummary}
            onClose={() => setShowAttendanceReport(false)}
          />
        )
      })()}

      {showMileageReport && mileageSummary && (
        <PrintableMileageReport
          staffName={staff.name}
          periodLabel={`${MONTH_NAMES[mileageMonth.month]} ${mileageMonth.year}`}
          summary={mileageSummary}
          onClose={() => setShowMileageReport(false)}
        />
      )}
    </div>
  )
}
