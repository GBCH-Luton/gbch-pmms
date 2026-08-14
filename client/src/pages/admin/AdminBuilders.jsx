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
import { COLORS } from '../../lib/colors'
import { normalizeCustomRoles } from '../../lib/roles'
import { attachProperties } from '../../lib/properties'
import BuilderProfilePage from './BuilderProfilePage'
import { thStyle, tdStyle, actionBtnStyle, STAFF_AVAILABILITY_OPTIONS, STAFF_AVAILABILITY_STYLES, Avatar, computeDutyStatus, fetchAssignableStaffForCategory } from './shared'

// Kept in sync with AdminAccess.jsx's own BUILT_IN_ROLES -- 'Cleaner' was
// removed from both 2026-08-14 (superseded by the 'Housekeeper' custom role).
const BUILT_IN_ROLES = ['Admin', 'Builder', 'Support Worker']

const OFFICE_ROTA_DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
]

// Lives here rather than Settings -- managers can have Settings hidden
// per-role (see profile.hideSettings, AdminDashboard.jsx), but this page
// has no such gate, and a Housekeeping Manager overriding who covers a day
// is exactly the kind of thing they need reachable without an admin's help.
// Reuses fetchAssignableStaffForCategory('Cleaning Rota') -- the same
// Housekeeping-division routing already used for the per-property cleaner
// picker (PropertyCoreTab.jsx) -- so this list of eligible housekeepers
// never drifts out of sync with who's actually eligible elsewhere.
// Auto-generation itself is a separate daily scheduled job (see
// supabase/functions/check-office-cleaning-due) that reads this same
// setting -- this panel only edits pmms.settings.office_cleaning_rota,
// it doesn't create tickets itself.
function OfficeCleaningRotaSection() {
  const [housekeepers, setHousekeepers] = useState([])
  const [rota, setRota] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    fetchAssignableStaffForCategory('Cleaning Rota').then(setHousekeepers)
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'office_cleaning_rota').maybeSingle()
      .then(({ data }) => { setRota(data?.setting_value || {}); setLoading(false) })
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')
    const { error: saveError } = await supabase
      .schema('pmms')
      .from('settings')
      .upsert({ setting_key: 'office_cleaning_rota', setting_value: rota, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })

    setSaving(false)
    if (saveError) { setError(saveError.message); return }
    setSuccess('Saved.')
    setTimeout(() => setSuccess(''), 2500)
  }

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <h2 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Office Cleaning Rota</h2>
      <p style={{ margin: '0 0 14px 0', fontSize: '12.5px', color: COLORS.slate500 }}>
        Who covers the office each weekday -- a ticket is created and assigned to that person automatically every morning.
        If someone's off, reassign that day's ticket from Pipeline, or raise a one-off ticket for whoever's covering instead.
      </p>
      {loading ? (
        <p style={{ color: COLORS.slate400, fontSize: '13px' }}>Loading...</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {OFFICE_ROTA_DAYS.map(d => (
              <div key={d.key} style={{ flex: '1 1 150px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, marginBottom: '4px' }}>{d.label}</label>
                <select
                  value={rota[d.key] || ''}
                  onChange={(e) => setRota(prev => ({ ...prev, [d.key]: e.target.value || null }))}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                >
                  <option value="">Nobody assigned</option>
                  {housekeepers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
            ))}
          </div>
          {error && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red600, fontWeight: 600 }}>{error}</p>}
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 16px', borderRadius: '10px', border: 'none', background: COLORS.teal700, color: COLORS.white,
              fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving...' : success || 'Save Rota'}
          </button>
        </>
      )}
    </div>
  )
}

export default function AdminBuilders({ profile, initialStaffId, onInitialStaffIdConsumed }) {
  const [staffList, setStaffList] = useState([])
  const [tickets, setTickets] = useState([])
  const [customRoles, setCustomRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStaffId, setSelectedStaffId] = useState(null)
  const [roleFilter, setRoleFilter] = useState('All')

  useEffect(() => {
    fetchData()
    // Jumped straight here from elsewhere (e.g. Reports' Staff Workload
    // table) with a specific person already in mind -- same "consume an
    // initial value passed down from the dashboard shell" pattern Pipeline/
    // Properties/Compliance already use.
    if (initialStaffId) {
      setSelectedStaffId(initialStaffId)
      onInitialStaffIdConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!settingsError) setCustomRoles(normalizeCustomRoles(settingsRow?.setting_value))

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
    const s = staffList.find(s => s.id === staffId)
    return computeDutyStatus(tickets.filter(t => t.assigned_builder_id === staffId), s?.availability)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading staff...</p>
    </div>
  )

  if (selectedStaffId) {
    return <BuilderProfilePage staffId={selectedStaffId} onBack={() => setSelectedStaffId(null)} />
  }

  // Admin is the IT-only tier managed on the separate "Admin" page -- this
  // page is the Maintenance Manager's day-to-day team view, so IT admins
  // aren't part of the roster being monitored here at all (not in the KPI
  // counts, not in the radar table, not as a filter tab).
  //
  // For a division-scoped manager (e.g. Housekeeping Manager), also narrow
  // to roles belonging to their own division -- 'Builder' is implicitly
  // Maintenance (matching fetchAssignableStaffForDivision's own
  // convention), custom roles carry their own `.division`, and any role
  // this can't resolve a division for (Cleaner/Support Worker, or an
  // unrecognised legacy value) is left visible everywhere rather than
  // risk hiding someone. Unscoped managers and Admin see every role,
  // completely unchanged.
  function roleDivision(roleName) {
    if (roleName === 'Builder') return 'Maintenance'
    const custom = customRoles.find(r => r.name === roleName)
    return custom ? (custom.division || 'Maintenance') : null
  }
  const allRoleOptions = [...BUILT_IN_ROLES, ...customRoles.map(r => r.name)].filter(r => r !== 'Admin')
  const roleOptions = profile.division
    ? allRoleOptions.filter(r => {
        const div = roleDivision(r)
        return div === null || div === profile.division
      })
    : allRoleOptions
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
        <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Live Field Radar</h1>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Real-time duty status and current assignment for every active staff member.</p>
      </div>

      {/* Hidden only for a manager explicitly scoped to a division other
          than Housekeeping -- same allow-list convention as the nav item
          gating in AdminDashboard.jsx (isNavItemVisible's `divisions`
          shape), applied inline here since this is a section within a
          page rather than a whole page. */}
      {(profile.role === 'admin' || !profile.division || profile.division === 'Housekeeping') && (
        <OfficeCleaningRotaSection />
      )}

      {/* KPI tiles */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 160px', background: COLORS.slate500, borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Staff</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }}>{totalStaff}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: COLORS.green600, borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }}>{activeCount}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: COLORS.teal600, borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>On Duty Now</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }}>{onDutyCount}</p>
        </div>
        <div style={{ flex: '1 1 160px', background: COLORS.slate400, borderRadius: '16px', padding: '16px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inactive</p>
          <p style={{ margin: 0, fontSize: '26px', fontWeight: 800, color: COLORS.white }}>{inactiveCount}</p>
        </div>
      </div>

      {/* Role filter */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', flexWrap: 'wrap', borderBottom: `1px solid ${COLORS.slate200}` }}>
        {filterTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setRoleFilter(tab)}
            style={{
              padding: '8px 14px', background: 'none', border: 'none', borderBottom: effectiveRoleFilter === tab ? `2px solid ${COLORS.teal700}` : '2px solid transparent',
              color: effectiveRoleFilter === tab ? COLORS.teal700 : COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '-1px', whiteSpace: 'nowrap',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div style={{ background: COLORS.white, borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: COLORS.slate50, borderBottom: `1px solid ${COLORS.slate200}` }}>
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
                  <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: COLORS.slate400, fontWeight: 600 }}>
                    No active staff found.
                  </td>
                </tr>
              )}
              {radarStaff.map(b => {
                const { activeJobs, inProgressJob, badge } = dutyFor(b.id)
                const availStyle = STAFF_AVAILABILITY_STYLES[b.availability] || STAFF_AVAILABILITY_STYLES.Available
                return (
                  <tr key={b.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                    <td style={tdStyle}>
                      <div
                        onClick={() => setSelectedStaffId(b.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                      >
                        <Avatar name={b.name} photoUrl={b.photo_url} size={28} />
                        <span style={{ fontWeight: 700, color: COLORS.blue700 }}>
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
                          style={{ display: 'block', marginTop: '4px', width: '160px', padding: '4px 8px', borderRadius: '6px', border: `1px solid ${COLORS.slate200}`, fontSize: '11px', boxSizing: 'border-box' }}
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
                        <span style={{ color: COLORS.slate600 }}>
                          <strong style={{ color: COLORS.slate900 }}>{inProgressJob.property?.address}</strong> — {inProgressJob.room || '—'} → {inProgressJob.description}
                        </span>
                      ) : activeJobs.length > 0 ? (
                        <span style={{ color: COLORS.slate600 }}>{activeJobs.length} active job{activeJobs.length === 1 ? '' : 's'}</span>
                      ) : (
                        <span style={{ color: COLORS.slate400, fontStyle: 'italic' }}>No active assignment</span>
                      )}
                    </td>
                    <td style={tdStyle}>{activeJobs.length}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button onClick={() => setSelectedStaffId(b.id)} style={actionBtnStyle}>View Profile</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
