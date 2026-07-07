// Staff page (file/import name kept as AdminBuilders -- only the sidebar
// label was renamed, in AdminDashboard.jsx). This is the Maintenance
// Manager's daily-monitoring page: KPI tiles + Live Field Radar (duty
// status and current assignment) for every staff member with a
// maintenance role, filterable by role. Staff List (add/edit/deactivate)
// and Role Management live separately on AdminAccess.jsx ("Admin" nav
// item), gated to profile.role === 'admin' only -- that page is for the IT
// admin creating/activating/deactivating accounts, not day-to-day
// monitoring, so the KPIs belong here instead.
//
// "Relevant" scoping (staff with one of the roles managed on the Admin
// page) is still applied here so this page's pool of staff matches what
// Admin considers active/managed -- it just doesn't offer any way to
// change roles from this page. See AdminAccess.jsx for the full design
// notes on pmms.staff_roles / pmms.settings.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { normalizeCustomRoles } from '../../lib/roles'
import { attachProperties } from '../../lib/properties'
import BuilderProfileModal from './BuilderProfileModal'
import { thStyle, tdStyle, actionBtnStyle, STAFF_AVAILABILITY_OPTIONS, STAFF_AVAILABILITY_STYLES, Avatar } from './shared'

const BUILT_IN_ROLES = ['Admin', 'Builder', 'Cleaner', 'Support Worker']

export default function AdminBuilders() {
  const [staffList, setStaffList] = useState([])
  const [tickets, setTickets] = useState([])
  const [customRoles, setCustomRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [builderProfileId, setBuilderProfileId] = useState(null)
  const [roleFilter, setRoleFilter] = useState('All')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: allStaff, error: staffError } = await supabase
      .from('staff')
      .select('id, name, active, photo_url')
      .order('name')

    const { data: roleRows, error: roleRowsError } = await supabase
      .schema('pmms')
      .from('staff_roles')
      .select('staff_id, role')

    const { data: availRows, error: availRowsError } = await supabase
      .schema('pmms')
      .from('staff_availability')
      .select('staff_id, status, note')

    const { data: ticketData, error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, status, description, room, assigned_builder_id, property_id
      `)

    const { data: settingsRow, error: settingsError } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'custom_roles')
      .maybeSingle()

    if (!staffError) {
      const roleByStaffId = {}
      if (!roleRowsError) {
        (roleRows || []).forEach(r => { roleByStaffId[r.staff_id] = r.role })
      }
      const availByStaffId = {}
      if (!availRowsError) {
        (availRows || []).forEach(a => { availByStaffId[a.staff_id] = a })
      }
      setStaffList((allStaff || []).map(s => ({
        ...s,
        role: roleByStaffId[s.id] || null,
        availability: availByStaffId[s.id]?.status || 'Available',
        availabilityNote: availByStaffId[s.id]?.note || '',
      })))
    }
    if (!ticketError) setTickets(await attachProperties(ticketData || [], 'address'))
    if (!settingsError) setCustomRoles(normalizeCustomRoles(settingsRow?.setting_value).map(r => r.name))

    setLoading(false)
  }

  async function persistAvailability(staffId, status, note) {
    await supabase
      .schema('pmms')
      .from('staff_availability')
      .upsert({ staff_id: staffId, status, note: note || null, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })
  }

  function handleAvailabilityChange(staffId, status) {
    const note = status === 'Available' ? '' : (staffList.find(s => s.id === staffId)?.availabilityNote || '')
    setStaffList(prev => prev.map(s => s.id === staffId ? { ...s, availability: status, availabilityNote: note } : s))
    persistAvailability(staffId, status, note)
  }

  function handleNoteChange(staffId, note) {
    setStaffList(prev => prev.map(s => s.id === staffId ? { ...s, availabilityNote: note } : s))
  }

  function handleNoteBlur(staffId) {
    const s = staffList.find(s => s.id === staffId)
    persistAvailability(staffId, s?.availability || 'Available', s?.availabilityNote || '')
  }

  function dutyFor(staffId) {
    const theirs = tickets.filter(t => t.assigned_builder_id === staffId)
    const activeJobs = theirs.filter(t => t.status !== 'Completed' && t.status !== 'Archived')
    const inProgressJob = theirs.find(t => t.status === 'In Progress')

    let badge = { label: 'Standby / Idle', bg: '#f1f5f9', color: '#94a3b8' }
    if (inProgressJob) badge = { label: 'On-Site Active', bg: '#dcfce7', color: '#16a34a' }
    else if (activeJobs.length > 0) badge = { label: 'Assigned / Transit', bg: '#dbeafe', color: '#1d4ed8' }

    return { activeJobs, inProgressJob, badge, onDuty: !!inProgressJob }
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading staff...</p>
    </div>
  )

  // Admin is the IT-only tier managed on the separate "Admin" page -- this
  // page is the Maintenance Manager's day-to-day team view, so IT admins
  // aren't part of the roster being monitored here at all (not in the KPI
  // counts, not in the radar table, not as a filter tab).
  const roleOptions = [...BUILT_IN_ROLES, ...customRoles].filter(r => r !== 'Admin')
  const relevantStaff = staffList.filter(s => roleOptions.includes(s.role))

  const totalStaff = relevantStaff.length
  const activeCount = relevantStaff.filter(s => s.active !== false).length
  const inactiveCount = relevantStaff.filter(s => s.active === false).length
  const onDutyCount = relevantStaff.filter(s => s.active !== false && dutyFor(s.id).onDuty).length

  const activeRelevantStaff = relevantStaff.filter(s => s.active !== false)

  // Only show a role as a filter tab if someone actually has it -- a role
  // with nobody assigned (e.g. "Support Worker" before anyone's been given
  // that role) would just be a dead tab that always shows an empty list.
  const rolesInUse = roleOptions.filter(r => activeRelevantStaff.some(s => s.role === r))
  const filterTabs = ['All', ...rolesInUse]
  // If the selected tab's role no longer has anyone in it (e.g. the last
  // person with that role was just deactivated), fall back to "All" rather
  // than silently showing an empty table with no visible way back.
  const effectiveRoleFilter = rolesInUse.includes(roleFilter) ? roleFilter : 'All'
  const radarStaff = effectiveRoleFilter === 'All' ? activeRelevantStaff : activeRelevantStaff.filter(s => s.role === effectiveRoleFilter)

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Live Field Radar</h1>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Real-time duty status and current assignment for every active staff member.</p>
      </div>

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', background: '#64748b', borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Staff</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#fff' }}>{totalStaff}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: '#16a34a', borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#fff' }}>{activeCount}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: '#0d9488', borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>On Duty Now</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#fff' }}>{onDutyCount}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: '#94a3b8', borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inactive</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: '#fff' }}>{inactiveCount}</p>
        </div>
      </div>

      {/* Role filter */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0' }}>
        {filterTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setRoleFilter(tab)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', borderBottom: effectiveRoleFilter === tab ? '2px solid #0f766e' : '2px solid transparent',
              color: effectiveRoleFilter === tab ? '#0f766e' : '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '-1px', whiteSpace: 'nowrap',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={thStyle}>Staff</th>
                <th style={thStyle}>Availability</th>
                <th style={thStyle}>Duty Status</th>
                <th style={thStyle}>Current Assignment</th>
                <th style={thStyle}>Active Jobs</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Profile</th>
              </tr>
            </thead>
            <tbody>
              {radarStaff.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontWeight: 600 }}>
                    No active staff found.
                  </td>
                </tr>
              )}
              {radarStaff.map(b => {
                const { activeJobs, inProgressJob, badge } = dutyFor(b.id)
                const availStyle = STAFF_AVAILABILITY_STYLES[b.availability] || STAFF_AVAILABILITY_STYLES.Available
                return (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={tdStyle}>
                      <div
                        onClick={() => setBuilderProfileId(b.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                      >
                        <Avatar name={b.name} photoUrl={b.photo_url} size={28} />
                        <span style={{ fontWeight: 700, color: '#1d4ed8' }}>
                          {b.name}
                        </span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={b.availability}
                        onChange={(e) => handleAvailabilityChange(b.id, e.target.value)}
                        style={{
                          fontSize: '11px', fontWeight: 800, color: availStyle.color, background: availStyle.bg,
                          border: 'none', borderRadius: '20px', padding: '3px 10px', cursor: 'pointer', marginBottom: '4px',
                        }}
                      >
                        {STAFF_AVAILABILITY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      {b.availability !== 'Available' && (
                        <input
                          type="text"
                          value={b.availabilityNote}
                          onChange={(e) => handleNoteChange(b.id, e.target.value)}
                          onBlur={() => handleNoteBlur(b.id)}
                          placeholder="Note (e.g. back Monday)"
                          style={{ display: 'block', marginTop: '4px', width: '160px', padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '11px', boxSizing: 'border-box' }}
                        />
                      )}
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-block', fontSize: '11px', fontWeight: 800, color: badge.color, background: badge.bg, padding: '3px 10px', borderRadius: '20px' }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      {inProgressJob ? (
                        <span style={{ color: '#475569' }}>
                          <strong style={{ color: '#0f172a' }}>{inProgressJob.property?.address}</strong> — {inProgressJob.room || '—'} → {inProgressJob.description}
                        </span>
                      ) : activeJobs.length > 0 ? (
                        <span style={{ color: '#475569' }}>{activeJobs.length} active job{activeJobs.length === 1 ? '' : 's'}</span>
                      ) : (
                        <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No active assignment</span>
                      )}
                    </td>
                    <td style={tdStyle}>{activeJobs.length}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button onClick={() => setBuilderProfileId(b.id)} style={actionBtnStyle}>View Profile</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <BuilderProfileModal builderId={builderProfileId} onClose={() => setBuilderProfileId(null)} />
    </div>
  )
}
