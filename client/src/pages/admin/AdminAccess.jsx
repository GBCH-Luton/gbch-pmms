// Admin page: Staff List + Role Management, split out of what used to be
// the "Staff" page (AdminBuilders.jsx) so it can be gated to true Admins
// only. Live Field Radar stayed behind on AdminBuilders.jsx/"Staff" and is
// visible to Maintenance Managers too -- only staff add/edit/deactivate and
// role assignment moved here, since that's the part with real blast radius
// (creating accounts, deciding who has what role).
//
// Gating happens in two places: the sidebar nav item pointing at this page
// is hidden entirely for non-admins (see AdminDashboard.jsx), and this
// component also refuses to render its content if profile.role isn't
// 'admin' as a defense-in-depth check, in case it's ever reached another way.
//
// IMPORTANT DESIGN NOTE: the "Role" managed here (Admin/Builder/Cleaner/
// Support Worker + custom) is primarily an ORGANIZATIONAL label for this
// staff directory. Login/access is normally governed by Job Title matching
// one of the lists in client/src/lib/roles.js (ADMIN_JOB_TITLES/
// MANAGER_JOB_TITLES/BUILDER_JOB_TITLES), read in App.jsx via
// roleFromJobTitle() -- but a Role assigned here can ALSO grant login
// access directly, on top of whatever job_title gives: the built-in Admin
// and Builder roles always do (admin/builder access respectively), and a
// custom role does if it's configured with an access level below (see
// accessLevelForRole in client/src/lib/roles.js, called from App.jsx). This
// exists so PMMS access doesn't depend on getting someone's company job
// title to match a hardcoded list -- see the "job_title drift" incident
// this was built to prevent.
//
// Role is stored in pmms.staff_roles (staff_id -> role), NOT on
// public.staff.role -- see scripts/add_pmms_staff_roles_table.sql.
// public.staff.role is shared with whatever else in the company reads
// public.staff, so being "Admin" in some other system sharing this
// Supabase project doesn't make someone Admin in PMMS, and vice versa.
//
// public.staff already has `active boolean default true` (see
// new_project_schema.sql). It does NOT have `phone` yet -- see
// scripts/add_staff_phone_column.sql, run it before using the Add/Edit
// Staff modal's Phone field.
//
// Custom roles (the master list of assignable names, plus what login
// access each one grants) are stored in pmms.settings under key
// 'custom_roles' as [{ name, accessLevel }], accessLevel being
// 'none' | 'manager' | 'builder' -- see normalizeCustomRoles in
// client/src/lib/roles.js, which also accepts the older plain-string-array
// shape for backward compatibility. NOTE: the live pmms.settings table was
// found (while testing this) to have columns `key`/`value` instead of the
// `setting_key`/`setting_value` every caller in this app expects -- see
// scripts/fix_pmms_settings_column_names.sql, run it or every
// settings-backed feature (this one included) will error.

import { useState, useEffect, useMemo, Fragment } from 'react'
import { normalizeCustomRoles } from '../../lib/roles'
import { COLORS } from '../../lib/colors'
import { fetchDivisions, saveDivisions, DEFAULT_DIVISIONS } from '../../lib/divisions'
import { fetchMaintenanceCategories, sortedCategoryEntries } from '../../lib/maintenanceCategories'
import { supabase } from '../../lib/supabase'
import { compressImage } from '../../lib/imageCompression'
import {
  actionBtnStyle, Avatar, thStyle, tdStyle, formatUKDateTime, filterSelectStyle,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, autoReassignDepartingStaffTickets, extractFunctionError,
  resolveStaffPhotoUrl,
} from './shared'

const LOGIN_EVENTS_LIMIT = 50
const ERROR_LOGS_LIMIT = 50

const ERROR_TYPE_LABELS = {
  js_error: 'JS Error',
  unhandled_rejection: 'Unhandled Rejection',
  react_render: 'Render Error',
  supabase_query: 'Failed Query',
}

const BUILT_IN_ROLES = ['Admin', 'Builder', 'Cleaner', 'Support Worker']

const ROLE_STYLES = {
  'Admin': { bg: COLORS.blue100, color: COLORS.blue900 },
  'Builder': { bg: COLORS.teal100, color: COLORS.teal600 },
  'Cleaner': { bg: COLORS.purple100, color: COLORS.purple600 },
  'Support Worker': { bg: COLORS.amber100, color: COLORS.amber600 },
}
const CUSTOM_ROLE_STYLE = { bg: COLORS.slate100, color: COLORS.slate500 }

function roleStyle(role) {
  return ROLE_STYLES[role] || CUSTOM_ROLE_STYLE
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

const emptyForm = { name: '', email: '', role: 'Builder', job_title: '', phone: '', skills: [], home_postcode: '' }

// Shown once, right after a temp password is generated -- by a brand new
// account (StaffFormModal) or a reset on an existing one (ResetPasswordModal).
// There is deliberately no way to re-fetch this later; it's never stored in
// plain text anywhere.
function TempPasswordDisplay({ name, tempPassword }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div>
      <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500, lineHeight: 1.6 }}>
        Give <strong>{name}</strong> this temporary password directly — in person, by phone, or secure message. It will not be shown again.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', marginBottom: '12px' }}>
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '20px', fontWeight: 800, color: COLORS.slate900, letterSpacing: '0.04em' }}>{tempPassword}</span>
        <button
          onClick={handleCopy}
          style={{ padding: '8px 14px', background: copied ? COLORS.green600 : COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ padding: '12px 14px', background: COLORS.blue50, border: `1px solid ${COLORS.blue200}`, borderRadius: '10px', fontSize: '12px', color: COLORS.blue900, lineHeight: 1.5 }}>
        🔒 When {name} logs in with this, they will be taken straight to a "set new password" screen and cannot access anything else until they do.
      </div>
    </div>
  )
}

// Per-staff-row action: generates a fresh temp password for someone who
// already has a login. This is the only account-recovery path in this app
// -- there's no self-service "forgot password" email flow -- so it has to
// be reachable from here.
function ResetPasswordModal({ staff, onClose }) {
  const [step, setStep] = useState('confirm') // 'confirm' | 'done'
  const [tempPassword, setTempPassword] = useState('')
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')

  async function handleGenerate() {
    setResetting(true)
    setError('')

    const { data, error: fnError } = await supabase.functions.invoke('reset-staff-password', { body: { staffId: staff.id } })

    setResetting(false)

    if (fnError) { setError(await extractFunctionError(fnError)); return }
    if (data?.error) { setError(data.error); return }

    setTempPassword(data.tempPassword)
    setStep('done')
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalCardStyle}>
        {step === 'confirm' ? (
          <>
            <p style={modalTitleStyle}>Reset Password — {staff.name}</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.slate500, lineHeight: 1.6 }}>
              This will generate a unique temporary password for <strong>{staff.email}</strong>. It will be shown to you once so you can tell them directly — in person or by phone. They will be forced to set a new password as soon as they log in.
            </p>
            {error && <p style={modalErrorStyle}>{error}</p>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={onClose} disabled={resetting} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={handleGenerate}
                disabled={resetting}
                style={{ ...modalConfirmBtnStyle, opacity: resetting ? 0.6 : 1, cursor: resetting ? 'not-allowed' : 'pointer' }}
              >
                {resetting ? 'Generating...' : 'Generate temp password'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={modalTitleStyle}>Temporary Password Generated</p>
            <p style={{ margin: '2px 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>{staff.email}</p>
            <TempPasswordDisplay name={staff.name} tempPassword={tempPassword} />
            <button onClick={onClose} style={{ ...modalConfirmBtnStyle, width: '100%', marginTop: '16px' }}>Done</button>
          </>
        )}
      </div>
    </div>
  )
}

function StaffFormModal({ staff, roleOptions, staffDirectory, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdAccount, setCreatedAccount] = useState(null) // { staff, tempPassword } once a brand-new login is created
  const [skillOptions, setSkillOptions] = useState([])

  useEffect(() => {
    if (staff) {
      setForm({
        name: staff.name || '',
        email: staff.email || '',
        role: staff.role || roleOptions[0] || '',
        job_title: staff.job_title || '',
        phone: staff.phone || '',
        skills: staff.skills || [],
        home_postcode: staff.home_postcode || '',
      })
    } else {
      setForm({ ...emptyForm, role: roleOptions[0] || '' })
    }
  }, [staff, roleOptions])

  // Skill tags are just the Maintenance-division category names already
  // managed on Settings > Issue Scores -- no separate taxonomy to maintain.
  useEffect(() => {
    fetchMaintenanceCategories().then(categories => {
      const names = sortedCategoryEntries(categories)
        .filter(([, c]) => (c.division || 'Maintenance') === 'Maintenance')
        .map(([name]) => name)
      setSkillOptions(names)
      // New staff start with every skill checked -- most builders can do
      // most of these, so it's faster to uncheck the few that don't apply
      // than to hunt down and check every one that does. Editing an
      // existing person's real skills is left untouched.
      if (!staff) setForm(prev => ({ ...prev, skills: names }))
    })
  }, [])

  function toggleSkill(name) {
    setForm(prev => ({
      ...prev,
      skills: prev.skills.includes(name) ? prev.skills.filter(s => s !== name) : [...prev.skills, name],
    }))
  }

  // Deliberately separate from the effect above, and keyed only on `staff`
  // (not `roleOptions` too) -- this should reset when the modal is reopened
  // for a different person, never as a side effect of the role list simply
  // re-rendering, which would otherwise wipe out the just-created temp
  // password result out from under the admin.
  useEffect(() => {
    setError('')
    setCreatedAccount(null)
  }, [staff])

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Only relevant while adding (not editing): typing/picking an email that
  // already exists in public.staff means this person is already in the
  // company directory (e.g. from the bulk HR import) and just needs a role
  // -- same outcome as finding them under the "Unassigned" tab and clicking
  // Edit, just reachable directly from Add without hunting for them first.
  const matchedExisting = !staff && form.email.trim()
    ? staffDirectory.find(s => s.email?.toLowerCase() === form.email.trim().toLowerCase())
    : null

  useEffect(() => {
    if (matchedExisting) {
      setForm(prev => ({
        ...prev,
        name: matchedExisting.name || prev.name,
        job_title: matchedExisting.job_title || prev.job_title,
        phone: matchedExisting.phone || prev.phone,
      }))
    }
    // Only react to a new match being found, not every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchedExisting?.id])

  async function handleSave() {
    setError('')
    if (!form.name.trim()) { setError('Full Name is required.'); return }
    if (!form.email.trim()) { setError('Email is required.'); return }

    setSaving(true)

    // Editing an existing card, or Add matched an existing public.staff row
    // by email -- either way, update that row + upsert the role, no invite,
    // no new row.
    const targetId = staff?.id || matchedExisting?.id

    if (targetId) {
      const newHomePostcode = form.home_postcode.trim() || null
      const homePostcodeChanged = newHomePostcode !== (staff?.home_postcode || null)

      const { data, error: updateError } = await supabase
        .from('staff')
        .update({
          name: form.name.trim(),
          email: form.email.trim(),
          job_title: form.job_title.trim() || null,
          phone: form.phone.trim() || null,
          skills: form.skills,
          home_postcode: newHomePostcode,
          // Cleared whenever the postcode itself changes so the mileage
          // estimate (AdminClocking.jsx, via ensureStaffHomeCoords) never
          // reads a stale lat/lng cached under the old address -- it's
          // cheap to re-geocode lazily next time it's needed.
          ...(homePostcodeChanged ? { home_latitude: null, home_longitude: null } : {}),
        })
        .eq('id', targetId)
        .select()
        .single()

      if (updateError) { setSaving(false); setError(updateError.message); return }

      const { error: roleError } = await supabase
        .schema('pmms')
        .from('staff_roles')
        .upsert({ staff_id: targetId, role: form.role, updated_at: new Date().toISOString() }, { onConflict: 'staff_id' })

      setSaving(false)
      if (roleError) { setError(roleError.message); return }

      onSaved({ ...data, role: form.role })
      return
    }

    // Genuinely new person: create their login (with a one-time temp
    // password) via a trusted server-side function. Browser code only ever
    // holds the anon key, and creating a Supabase Auth user needs the
    // service-role key, so this can't happen directly from here -- see
    // supabase/functions/create-staff-account.
    const { data: fnData, error: fnError } = await supabase.functions.invoke('create-staff-account', {
      body: {
        name: form.name.trim(),
        email: form.email.trim(),
        job_title: form.job_title.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role,
        skills: form.skills,
      },
    })

    setSaving(false)

    if (fnError) { setError(await extractFunctionError(fnError)); return }
    if (fnData?.error) { setError(fnData.error); return }

    // Don't close yet -- show the temp password once, first.
    setCreatedAccount({ staff: fnData.staff, tempPassword: fnData.tempPassword })
  }

  if (createdAccount) {
    return (
      <div style={modalOverlayStyle}>
        <div style={modalCardStyle}>
          <p style={modalTitleStyle}>Staff Member Added</p>
          <p style={{ margin: '2px 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>{createdAccount.staff.email}</p>
          <TempPasswordDisplay name={createdAccount.staff.name} tempPassword={createdAccount.tempPassword} />
          <button
            onClick={() => onSaved({ ...createdAccount.staff, role: form.role })}
            style={{ ...modalConfirmBtnStyle, width: '100%', marginTop: '16px' }}
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={modalOverlayStyle}>
      <div style={modalCardStyle}>
        <p style={modalTitleStyle}>{staff ? 'Edit Staff Member' : 'Add Staff Member'}</p>

        <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: COLORS.amber800, background: COLORS.amber50, border: `1px solid ${COLORS.amber200}`, borderRadius: '8px', padding: '8px 10px' }}>
          Email, Full Name, Job Title, and Phone are shared with every other company system, not just PMMS. Editing them here is an interim measure until a dedicated IT/HR system takes over managing this data centrally.
        </p>

        <p style={modalLabelStyle}>Email</p>
        <input
          type="text"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
          list={staff ? undefined : 'staff-email-directory'}
          placeholder={staff ? undefined : 'Start typing to find an existing staff member...'}
          style={inputStyle}
        />
        {!staff && (
          <datalist id="staff-email-directory">
            {staffDirectory.map(s => <option key={s.id} value={s.email}>{s.name}</option>)}
          </datalist>
        )}
        {!staff && matchedExisting && (
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.green600, fontWeight: 600 }}>
            ✓ Found {matchedExisting.name} in the staff directory — this will assign the role to their existing account, not create a duplicate.
          </p>
        )}

        <p style={modalLabelStyle}>Full Name</p>
        <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Role</p>
        <select value={form.role} onChange={(e) => set('role', e.target.value)} style={inputStyle}>
          {/* Staff pulled in from the wider (unassigned) directory may have a legacy
              value like 'sw' that isn't one of the managed roles -- show it so the
              dropdown doesn't just look blank, but picking any real option below replaces it. */}
          {form.role && !roleOptions.includes(form.role) && (
            <option value={form.role}>{form.role} (current, not a managed role)</option>
          )}
          {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        <p style={modalLabelStyle}>Job Title</p>
        <input type="text" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Phone</p>
        <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} />

        <p style={modalLabelStyle}>Home Postcode <span style={{ fontWeight: 500, color: COLORS.slate400 }}>(optional -- used by Clocking to estimate expected mileage on someone's first job of the day)</span></p>
        <input type="text" value={form.home_postcode} onChange={(e) => set('home_postcode', e.target.value)} placeholder="e.g. LU1 2AB" style={inputStyle} />

        <p style={modalLabelStyle}>Skills</p>
        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: COLORS.slate400 }}>
          Only affects which maintenance tickets get routed to them. Leave all unchecked if they can do any maintenance job.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          {skillOptions.map(name => (
            <label
              key={name}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px',
                border: `1px solid ${form.skills.includes(name) ? COLORS.teal700 : COLORS.slate200}`,
                background: form.skills.includes(name) ? COLORS.teal50 : COLORS.white,
                fontSize: '12px', fontWeight: 600, color: form.skills.includes(name) ? COLORS.teal700 : COLORS.slate600, cursor: 'pointer',
              }}
            >
              <input type="checkbox" checked={form.skills.includes(name)} onChange={() => toggleSkill(name)} />
              {name}
            </label>
          ))}
        </div>

        {error && <p style={modalErrorStyle}>{error}</p>}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={onClose} style={modalCancelBtnStyle}>Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{ ...modalConfirmBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}
          >
            {saving ? 'Saving...' : staff ? 'Save changes' : 'Add Staff Member'}
          </button>
        </div>
      </div>
    </div>
  )
}

const ACCESS_LEVEL_LABELS = {
  none: 'No system login',
  manager: 'Manager access',
  builder: 'Builder access',
  submitter: 'Ticket Submitter access',
}

function RolesPanel({ staffList, customRoles, customRolesError, onRolesChanged, divisions, onDivisionsChanged }) {
  const [adding, setAdding] = useState(false)
  const [newRole, setNewRole] = useState('')
  const [newRoleAccessLevel, setNewRoleAccessLevel] = useState('none')
  const [newRoleDivision, setNewRoleDivision] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [addingDivision, setAddingDivision] = useState(false)
  const [newDivisionName, setNewDivisionName] = useState('')
  const [divisionError, setDivisionError] = useState('')
  const [savingDivision, setSavingDivision] = useState(false)

  async function saveCustomRoles(next) {
    const { error: saveError } = await supabase
      .schema('pmms')
      .from('settings')
      .upsert({ setting_key: 'custom_roles', setting_value: next, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })

    if (saveError) return saveError.message
    onRolesChanged(next)
    return null
  }

  async function handleAddRole() {
    setError('')
    const name = newRole.trim()
    if (!name) { setError('Enter a role name.'); return }
    if ([...BUILT_IN_ROLES, ...customRoles.map(r => r.name)].some(r => r.toLowerCase() === name.toLowerCase())) {
      setError('That role already exists.')
      return
    }

    setSaving(true)
    const err = await saveCustomRoles([...customRoles, { name, accessLevel: newRoleAccessLevel, division: newRoleDivision || null }])
    setSaving(false)

    if (err) { setError(err); return }
    setNewRole('')
    setNewRoleAccessLevel('none')
    setNewRoleDivision('')
    setAdding(false)
  }

  async function handleChangeAccessLevel(name, accessLevel) {
    await saveCustomRoles(customRoles.map(r => r.name === name ? { ...r, accessLevel } : r))
  }

  async function handleChangeHideSettings(name, hideSettings) {
    await saveCustomRoles(customRoles.map(r => r.name === name ? { ...r, hideSettings } : r))
  }

  // Grants/revokes this role's ability to create a new Event (the
  // Compliance/Landlord Liaison ticket-coordination feature) -- enforced
  // for real server-side by pmms.current_can_create_events(), this just
  // controls whether the UI offers the "+ New Event" button.
  async function handleChangeCanCreateEvents(name, canCreateEvents) {
    await saveCustomRoles(customRoles.map(r => r.name === name ? { ...r, canCreateEvents } : r))
  }

  // Scopes this role's database access (via RLS, not just the UI) to a
  // single division -- e.g. a "Housekeeping Manager" role only ever sees
  // tickets whose category is tagged Housekeeping. Empty/"None" means
  // unscoped, full access -- exactly like every role today.
  async function handleChangeDivision(name, division) {
    await saveCustomRoles(customRoles.map(r => r.name === name ? { ...r, division: division || null } : r))
  }

  async function handleDeleteRole() {
    setDeleting(true)
    const err = await saveCustomRoles(customRoles.filter(r => r.name !== deleteTarget))
    setDeleting(false)
    if (!err) setDeleteTarget(null)
  }

  async function handleAddDivision() {
    setDivisionError('')
    const name = newDivisionName.trim()
    if (!name) { setDivisionError('Enter a division name.'); return }
    if (divisions.some(d => d.toLowerCase() === name.toLowerCase())) { setDivisionError('That division already exists.'); return }

    setSavingDivision(true)
    const next = [...divisions, name]
    await saveDivisions(next)
    onDivisionsChanged(next)
    setSavingDivision(false)
    setNewDivisionName('')
    setAddingDivision(false)
  }

  async function handleDeleteDivision(name) {
    const next = divisions.filter(d => d !== name)
    await saveDivisions(next)
    onDivisionsChanged(next)
  }

  const staffCountForRole = (role) => staffList.filter(s => s.role === role).length

  return (
    <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Roles</p>

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Built-in</p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {BUILT_IN_ROLES.map(r => {
          const style = roleStyle(r)
          return (
            <span key={r} style={{ fontSize: '11px', fontWeight: 700, color: style.color, background: style.bg, padding: '4px 12px', borderRadius: '20px' }}>{r}</span>
          )
        })}
      </div>

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Divisions</p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {divisions.map(d => (
          <span key={d} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: COLORS.blue900, background: COLORS.blue100, padding: '4px 6px 4px 12px', borderRadius: '20px' }}>
            {d}
            {d !== 'Maintenance' && (
              <button
                onClick={() => handleDeleteDivision(d)}
                title="Remove from the picklist -- roles/categories already tagged with this division keep working, they just won't offer it as a choice anymore"
                style={{ background: 'none', border: 'none', color: COLORS.blue900, fontSize: '12px', fontWeight: 800, cursor: 'pointer', padding: '0 2px' }}
              >
                ✕
              </button>
            )}
          </span>
        ))}
      </div>
      {addingDivision ? (
        <div style={{ marginBottom: '12px' }}>
          <input
            type="text"
            value={newDivisionName}
            onChange={(e) => setNewDivisionName(e.target.value)}
            placeholder="Division name..."
            style={{ ...inputStyle, marginBottom: '8px' }}
          />
          {divisionError && <p style={modalErrorStyle}>{divisionError}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setAddingDivision(false); setNewDivisionName(''); setDivisionError('') }} style={{ flex: 1, padding: '8px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleAddDivision}
              disabled={savingDivision}
              style={{ flex: 1, padding: '8px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: savingDivision ? 'not-allowed' : 'pointer', opacity: savingDivision ? 0.6 : 1 }}
            >
              {savingDivision ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingDivision(true)}
          style={{ width: '100%', padding: '8px', marginBottom: '16px', background: COLORS.white, color: COLORS.blue900, border: `1px solid ${COLORS.blue200}`, borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Division
        </button>
      )}

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Custom</p>

      {customRolesError && (
        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red600 }}>{customRolesError}</p>
      )}

      {customRoles.length === 0 && !customRolesError && (
        <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No custom roles yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {customRoles.map(r => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 10px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>{r.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={r.accessLevel}
                onChange={(e) => handleChangeAccessLevel(r.name, e.target.value)}
                title="What logging in with this role grants, on top of Job Title"
                style={{ fontSize: '11px', fontWeight: 700, padding: '4px 6px', borderRadius: '6px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, cursor: 'pointer' }}
              >
                {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={r.division || ''}
                onChange={(e) => handleChangeDivision(r.name, e.target.value)}
                title="Scopes this role's database access to one division (e.g. a Housekeeping Manager only ever sees Housekeeping tickets). None = unscoped, full access."
                style={{ fontSize: '11px', fontWeight: 700, padding: '4px 6px', borderRadius: '6px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, cursor: 'pointer' }}
              >
                <option value="">No division</option>
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <label
                title="Removes the Settings tab from the nav for this role. UI-only -- does not restrict database access."
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                <input
                  type="checkbox"
                  checked={!!r.hideSettings}
                  onChange={(e) => handleChangeHideSettings(r.name, e.target.checked)}
                />
                Hide Settings
              </label>
              <label
                title="Lets this role create a new Event (the Compliance/Landlord Liaison ticket-coordination feature). Any manager can still add a ticket to an existing Event regardless of this setting."
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                <input
                  type="checkbox"
                  checked={!!r.canCreateEvents}
                  onChange={(e) => handleChangeCanCreateEvents(r.name, e.target.checked)}
                />
                Can Create Events
              </label>
              <button
                onClick={() => setDeleteTarget(r.name)}
                style={{ background: 'none', border: 'none', color: COLORS.red600, fontSize: '14px', fontWeight: 800, cursor: 'pointer', padding: '2px 6px' }}
                aria-label={`Delete role ${r.name}`}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <div>
          <input
            type="text"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            placeholder="Role name..."
            style={{ ...inputStyle, marginBottom: '8px' }}
          />
          <select
            value={newRoleAccessLevel}
            onChange={(e) => setNewRoleAccessLevel(e.target.value)}
            style={{ ...inputStyle, marginBottom: '8px' }}
          >
            {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            value={newRoleDivision}
            onChange={(e) => setNewRoleDivision(e.target.value)}
            style={{ ...inputStyle, marginBottom: '8px' }}
          >
            <option value="">No division (unscoped)</option>
            {divisions.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          {error && <p style={modalErrorStyle}>{error}</p>}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => { setAdding(false); setNewRole(''); setError('') }} style={{ flex: 1, padding: '8px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleAddRole}
              disabled={saving}
              style={{ flex: 1, padding: '8px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ width: '100%', padding: '10px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Role
        </button>
      )}

      {deleteTarget && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: '380px' }}>
            <p style={modalTitleStyle}>Delete Role "{deleteTarget}"</p>
            {staffCountForRole(deleteTarget) > 0 ? (
              <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.amber600, fontWeight: 600 }}>
                ⚠ {staffCountForRole(deleteTarget)} staff member{staffCountForRole(deleteTarget) === 1 ? '' : 's'} currently have this role. They will keep the label on their record, but it will no longer appear as a filter tab.
              </p>
            ) : (
              <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>No staff currently use this role.</p>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setDeleteTarget(null)} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={handleDeleteRole}
                disabled={deleting}
                style={{ flex: 2, padding: '10px', background: COLORS.red600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? 'Deleting...' : 'Delete Role'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Most recent sign-in/sign-out activity, newest first -- read-only, no
// actions here. Device is shown as a short, human label rather than the
// raw user_agent string (e.g. "Chrome on Windows"), parsed loosely since
// this is for a quick glance, not a precise device fingerprint.
function summarizeUserAgent(ua) {
  if (!ua) return 'Unknown device'
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome' : ua.includes('Firefox/') ? 'Firefox' : ua.includes('Safari/') ? 'Safari' : 'Browser'
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac OS') ? 'Mac' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' : 'Unknown OS'
  return `${browser} on ${os}`
}

// error_logs.staff_id points at public.staff -- a cross-schema FK, so this
// can't be embedded in one PostgREST select (confirmed elsewhere in this
// app for the same reason -- see client/src/lib/properties.js). Same fix:
// fetch the rows, batch-fetch the matching staff names, merge in JS.
async function attachStaffNames(rows) {
  const staffIds = [...new Set(rows.map(r => r.staff_id).filter(id => id != null))]
  if (staffIds.length === 0) return rows.map(r => ({ ...r, staff_name: null }))

  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, name')
    .in('id', staffIds)

  const nameById = {}
  ;(staffRows || []).forEach(s => { nameById[s.id] = s.name })

  return rows.map(r => ({ ...r, staff_name: nameById[r.staff_id] || null }))
}

// Collapsible, closed by default -- this list grew long enough that it
// was pushing ErrorLogsPanel (and whatever comes after it) out of view.
// Same expand/collapse treatment as ErrorLogsPanel below.
function LoginActivityPanel({ events }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div style={{ marginTop: '16px' }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '14px 20px', background: COLORS.white, border: 'none', borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: COLORS.slate900,
        }}
      >
        <span>Recent Login Activity ({events.length})</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate400 }}>{isOpen ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {isOpen && (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '10px' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate400 }}>Most recent {LOGIN_EVENTS_LIMIT} sign-ins/sign-outs, newest first.</p>
          {events.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No login activity recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                    <th style={thStyle}>Staff</th>
                    <th style={thStyle}>Event</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                      <td style={tdStyle}>{e.staff_name || e.email}</td>
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                          color: e.event_type === 'Signed In' ? COLORS.green600 : COLORS.slate500,
                          background: e.event_type === 'Signed In' ? COLORS.green100 : COLORS.slate100,
                        }}>
                          {e.event_type}
                        </span>
                      </td>
                      <td style={tdStyle}>{formatUKDateTime(e.created_at)}</td>
                      <td style={tdStyle}>{summarizeUserAgent(e.user_agent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const ERROR_TYPE_STYLES = {
  js_error: { bg: COLORS.red100, color: COLORS.red600 },
  unhandled_rejection: { bg: COLORS.amber100, color: COLORS.amber600 },
  react_render: { bg: COLORS.purple100, color: COLORS.purple600 },
  supabase_query: { bg: COLORS.blue100, color: COLORS.blue900 },
}

// Collapsible (unlike LoginActivityPanel, which is always visible) since
// this is a diagnostics tool checked occasionally, not day-to-day info --
// same expand/collapse treatment as the "Deactivated Staff" section below.
// Each row expands further to show the full stack/context JSON, the same
// click-to-expand interaction AdminPipeline.jsx already uses for tickets.
function ErrorLogsPanel({ logs }) {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedId, setExpandedId] = useState(null)

  return (
    <div style={{ marginTop: '16px' }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '14px 20px', background: COLORS.white, border: 'none', borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: COLORS.slate900,
        }}
      >
        <span>Error &amp; Crash Log ({logs.length})</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate400 }}>{isOpen ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {isOpen && (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '10px' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate400 }}>
            Most recent {ERROR_LOGS_LIMIT} JS crashes and failed queries, newest first. Cleared automatically after 30 days. Click a row for details.
          </p>
          {logs.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No errors recorded. Good sign.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Message</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const style = ERROR_TYPE_STYLES[log.error_type] || { bg: COLORS.slate100, color: COLORS.slate500 }
                    const isExpanded = expandedId === log.id
                    return (
                      <Fragment key={log.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          style={{ borderBottom: `1px solid ${COLORS.slate100}`, cursor: 'pointer', background: isExpanded ? COLORS.slate50 : undefined }}
                        >
                          <td style={tdStyle}>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: style.color, background: style.bg }}>
                              {ERROR_TYPE_LABELS[log.error_type] || log.error_type}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</td>
                          <td style={tdStyle}>{formatUKDateTime(log.created_at)}</td>
                          <td style={tdStyle}>{log.staff_name || log.email || 'Unknown'}</td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                            <td colSpan={4} style={{ padding: '12px 8px', background: COLORS.slate50 }}>
                              {log.stack && (
                                <pre style={{ margin: '0 0 8px 0', fontSize: '11px', color: COLORS.slate600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{log.stack}</pre>
                              )}
                              {log.context && (
                                <pre style={{ margin: 0, fontSize: '11px', color: COLORS.slate600, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(log.context, null, 2)}</pre>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const NEW_RECORD = '__new__'

const readonlyBoxStyle = { padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, fontSize: '13px', color: COLORS.slate400 }

function ReadonlyField({ label, value }) {
  return (
    <div>
      <label style={modalLabelStyle}>{label}</label>
      <div style={readonlyBoxStyle}>{value}</div>
    </div>
  )
}

const emptyStaffRecordForm = {
  name: '', email: '', job_title: '', department: '', phone: '', skills: '', gender: '', home_postcode: '', photo_url: '', active: true,
}

const ADD_NEW_LABEL = '＋ Add a new staff record'

function staffOptionLabel(s) {
  return `${s.name}${s.email ? ` (${s.email})` : ''}`
}

// Stop-gap until there's a real staff/HR system: public.staff is shared
// company-wide (other systems read/write it too, see the shared-Supabase
// architecture note at the top of this file), and several of its columns
// -- department, photo_url, and anything beyond what the Add/Edit Staff
// modal above sets -- have no PMMS UI at all. This is a raw editor over
// every column on that table, deliberately separate from the modal above:
// it never touches Supabase Auth (no login, no temp password), it can add
// a bare directory record for someone who doesn't need PMMS access, and it
// can fill in gaps on staff who were onboarded through the real flow.
function StaffRecordEditorPanel({ staffList, onSaved }) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(NEW_RECORD)
  const [searchText, setSearchText] = useState(ADD_NEW_LABEL)
  const [form, setForm] = useState(emptyStaffRecordForm)
  const [saving, setSaving] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const selected = selectedId === NEW_RECORD ? null : staffList.find(s => s.id === selectedId)
  const sortedStaff = [...staffList].sort((a, b) => a.name.localeCompare(b.name))

  useEffect(() => {
    setError('')
    setSavedMessage('')
    if (selected) {
      setForm({
        name: selected.name || '',
        email: selected.email || '',
        job_title: selected.job_title || '',
        department: selected.department || '',
        phone: selected.phone || '',
        skills: (selected.skills || []).join(', '),
        gender: selected.gender || '',
        home_postcode: selected.home_postcode || '',
        photo_url: selected.photo_url || '',
        active: selected.active !== false,
      })
      setSearchText(staffOptionLabel(selected))
    } else {
      setForm(emptyStaffRecordForm)
      setSearchText(ADD_NEW_LABEL)
    }
    // Only reset when a different record is picked, not on every staffList
    // refresh (that would wipe out whatever's mid-edit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Backed by a <datalist> so typing the first few letters of a name
  // filters the suggestions natively -- only commits a selection once the
  // typed text exactly matches a suggestion (i.e. the admin picked one),
  // so a selection stays put while they're still mid-search.
  function handleSearchChange(e) {
    const text = e.target.value
    setSearchText(text)
    if (text === ADD_NEW_LABEL) { setSelectedId(NEW_RECORD); return }
    const match = sortedStaff.find(s => staffOptionLabel(s) === text)
    if (match) setSelectedId(match.id)
  }

  function set(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  // Uploads straight into the shared "staff-photos" bucket (public, already
  // used to display photos via resolveStaffPhotoUrl -- see shared.jsx --
  // just never had anything to upload into it before). Scoped under the
  // staff id folder same as every other upload site in this app; a new,
  // not-yet-saved record uses "new" since there's no id yet.
  async function handlePhotoUpload(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return

    setUploadingPhoto(true)
    setError('')
    const compressed = await compressImage(file)
    const path = `${selected ? selected.id : 'new'}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('staff-photos').upload(path, compressed)
    setUploadingPhoto(false)

    if (uploadError) { setError(`Photo upload failed: ${uploadError.message}`); return }
    const { data } = supabase.storage.from('staff-photos').getPublicUrl(path)
    set('photo_url', data.publicUrl)
  }

  async function handleSave() {
    setError('')
    setSavedMessage('')
    if (!form.name.trim()) { setError('Name is required.'); return }

    setSaving(true)

    const newHomePostcode = form.home_postcode.trim() || null
    const homePostcodeChanged = newHomePostcode !== (selected?.home_postcode || null)

    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      job_title: form.job_title.trim() || null,
      department: form.department.trim() || null,
      phone: form.phone.trim() || null,
      skills: form.skills.split(',').map(s => s.trim()).filter(Boolean),
      gender: form.gender || null,
      home_postcode: newHomePostcode,
      photo_url: form.photo_url.trim() || null,
      active: form.active,
      // Same reset-on-postcode-change behaviour as the Add/Edit Staff modal
      // -- these are auto-geocoded (ensureStaffHomeCoords), never hand-set.
      ...(homePostcodeChanged ? { home_latitude: null, home_longitude: null } : {}),
    }

    const query = selected
      ? supabase.from('staff').update(payload).eq('id', selected.id)
      // user_id defaults to auth.uid() on public.staff -- without this
      // explicit null, a plain insert would silently link the new record
      // to whichever admin is signed in and filling out this form.
      : supabase.from('staff').insert({ ...payload, user_id: null })

    const { data, error: saveError } = await query.select().single()

    setSaving(false)
    if (saveError) { setError(saveError.message); return }

    onSaved(data)
    setSelectedId(data.id)
    setSavedMessage('Saved.')
  }

  return (
    <div style={{ marginTop: '16px' }}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        style={{
          display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '14px 20px', background: COLORS.white, border: 'none', borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: COLORS.slate900,
        }}
      >
        <span>Staff Record Editor (All Fields)</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate400 }}>{isOpen ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {isOpen && (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '10px' }}>
          <p style={{ margin: '0 0 16px 0', fontSize: '12px', color: COLORS.slate400, lineHeight: 1.5 }}>
            A stand-in for a proper staff system: edits every column on the shared staff directory directly. Doesn't create a PMMS login -- use "＋ Add Staff Member" above for that. Fields shown greyed out are system-managed and can't be changed here.
          </p>

          <label style={modalLabelStyle}>Record</label>
          <input
            type="text"
            list="staff-record-options"
            value={searchText}
            onChange={handleSearchChange}
            onFocus={(e) => e.target.select()}
            placeholder="Type a name to search..."
            style={inputStyle}
          />
          <datalist id="staff-record-options">
            <option value={ADD_NEW_LABEL} />
            {sortedStaff.map(s => (
              <option key={s.id} value={staffOptionLabel(s)} />
            ))}
          </datalist>

          {selected && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px', marginTop: '16px' }}>
              <ReadonlyField label="Staff ID" value={selected.id} />
              <ReadonlyField label="Created" value={formatUKDateTime(selected.created_at)} />
              <ReadonlyField label="PMMS Login" value={selected.user_id ? 'Linked' : 'No login'} />
              <ReadonlyField label="Must Reset Password" value={selected.must_reset_password ? 'Yes' : 'No'} />
              <ReadonlyField label="Home Coordinates" value={selected.home_latitude != null ? `${selected.home_latitude.toFixed(4)}, ${selected.home_longitude.toFixed(4)}` : 'Not geocoded yet'} />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px', marginTop: '4px' }}>
            <div>
              <label style={modalLabelStyle}>Full Name</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Job Title</label>
              <input type="text" value={form.job_title} onChange={(e) => set('job_title', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Department</label>
              <input type="text" value={form.department} onChange={(e) => set('department', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Phone</label>
              <input type="text" value={form.phone} onChange={(e) => set('phone', e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Gender</label>
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)} style={inputStyle}>
                <option value="">Not set</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </div>
            <div>
              <label style={modalLabelStyle}>Home Postcode</label>
              <input type="text" value={form.home_postcode} onChange={(e) => set('home_postcode', e.target.value)} placeholder="e.g. LU1 2AB" style={inputStyle} />
            </div>
            <div>
              <label style={modalLabelStyle}>Photo</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {form.photo_url ? (
                  <img src={resolveStaffPhotoUrl(form.photo_url)} alt="" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                ) : (
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: COLORS.slate100, flexShrink: 0 }} />
                )}
                <input type="file" accept="image/*" id="staff-record-photo-input" onChange={handlePhotoUpload} style={{ display: 'none' }} />
                <label
                  htmlFor="staff-record-photo-input"
                  style={{ fontSize: '12px', fontWeight: 700, color: COLORS.blue700, background: COLORS.blue100, borderRadius: '8px', padding: '8px 12px', cursor: uploadingPhoto ? 'not-allowed' : 'pointer', opacity: uploadingPhoto ? 0.6 : 1 }}
                >
                  {uploadingPhoto ? 'Uploading...' : form.photo_url ? 'Change Photo' : 'Upload Photo'}
                </label>
                {form.photo_url && (
                  <button type="button" onClick={() => set('photo_url', '')} style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate500, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Remove
                  </button>
                )}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={modalLabelStyle}>Skills (comma-separated)</label>
              <input type="text" value={form.skills} onChange={(e) => set('skills', e.target.value)} placeholder="e.g. Plumbing, Electrical" style={inputStyle} />
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px', fontSize: '13px', fontWeight: 600, color: COLORS.slate600, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
            Active
          </label>

          {error && <p style={modalErrorStyle}>{error}</p>}
          {savedMessage && !error && <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.green600, fontWeight: 600 }}>{savedMessage}</p>}

          <button
            onClick={handleSave}
            disabled={saving}
            style={{ marginTop: '16px', padding: '10px 20px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving...' : selected ? 'Save Changes' : 'Add Record'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function AdminAccess({ profile }) {
  const [staffList, setStaffList] = useState([])
  const [tickets, setTickets] = useState([])
  const [loginEvents, setLoginEvents] = useState([])
  const [errorLogs, setErrorLogs] = useState([])
  const [errorLogsOpen, setErrorLogsOpen] = useState(false)
  const [loading, setLoading] = useState(true)

  const [customRoles, setCustomRoles] = useState([])
  const [customRolesError, setCustomRolesError] = useState('')
  const [divisions, setDivisions] = useState(DEFAULT_DIVISIONS)

  const [roleFilter, setRoleFilter] = useState('All')
  const [modalStaff, setModalStaff] = useState(undefined) // undefined = closed, null = add, object = edit
  const [resetPasswordTarget, setResetPasswordTarget] = useState(null)
  const [toggleActiveErrors, setToggleActiveErrors] = useState({})
  const [deactivatedOpen, setDeactivatedOpen] = useState(false)
  const [autoReassignSummary, setAutoReassignSummary] = useState(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    const { data: allStaff, error: staffError } = await supabase
      .from('staff')
      .select('*')
      .order('name')

    const { data: roleRows, error: roleRowsError } = await supabase
      .schema('pmms')
      .from('staff_roles')
      .select('staff_id, role')

    const { data: ticketData, error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, status, assigned_builder_id')

    const { data: settingsRow, error: settingsError } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'custom_roles')
      .maybeSingle()

    const { data: loginEventRows, error: loginEventsError } = await supabase
      .schema('pmms')
      .from('login_events')
      .select('id, staff_name, email, event_type, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(LOGIN_EVENTS_LIMIT)

    if (!loginEventsError) setLoginEvents(loginEventRows || [])

    const { data: errorLogRows, error: errorLogsError } = await supabase
      .schema('pmms')
      .from('error_logs')
      .select('id, error_type, message, stack, context, staff_id, email, created_at')
      .order('created_at', { ascending: false })
      .limit(ERROR_LOGS_LIMIT)

    if (!errorLogsError) setErrorLogs(await attachStaffNames(errorLogRows || []))

    if (!staffError) {
      const roleByStaffId = {}
      if (!roleRowsError) {
        (roleRows || []).forEach(r => { roleByStaffId[r.staff_id] = r.role })
      }
      setStaffList((allStaff || []).map(s => ({ ...s, role: roleByStaffId[s.id] || null })))
    }
    if (!ticketError) setTickets(ticketData || [])

    if (settingsError) {
      setCustomRoles([])
      setCustomRolesError(settingsError.message)
    } else {
      setCustomRoles(normalizeCustomRoles(settingsRow?.setting_value))
      setCustomRolesError('')
    }

    setDivisions(await fetchDivisions())

    setLoading(false)
  }

  function isOnDuty(staffId) {
    return tickets.some(t => t.assigned_builder_id === staffId && t.status === 'In Progress')
  }

  function handleStaffSaved(saved) {
    setStaffList(prev => {
      const exists = prev.some(s => s.id === saved.id)
      return exists ? prev.map(s => s.id === saved.id ? saved : s) : [...prev, saved].sort((a, b) => a.name.localeCompare(b.name))
    })
    setModalStaff(undefined)
  }

  async function handleToggleActive(staff) {
    setToggleActiveErrors(prev => ({ ...prev, [staff.id]: '' }))
    const wasActive = staff.active !== false

    const { data, error } = await supabase
      .from('staff')
      .update({ active: !staff.active })
      .eq('id', staff.id)
      .select()
      .single()

    if (error) {
      setToggleActiveErrors(prev => ({ ...prev, [staff.id]: error.message }))
      return
    }

    // .update() only returns public.staff columns -- role lives in
    // pmms.staff_roles, so it has to be carried over manually here or it'd
    // get wiped from local state.
    handleStaffSaved({ ...data, role: staff.role })

    // Only on deactivation (leaving the company), never on re-activation --
    // managers said a short holiday is handled manually via Pipeline's bulk
    // reassign, but someone actually leaving should be automatic, no prompt.
    if (wasActive) {
      const result = await autoReassignDepartingStaffTickets(staff.id, staff.name, profile)
      if (result.reassignedCount > 0 || result.failures.length > 0) {
        setAutoReassignSummary({ staffName: staff.name, ...result })
      }
      await fetchData()
    }
  }

  // Memoized so this array's identity is stable across re-renders that
  // don't actually change the role list -- StaffFormModal's effect depends
  // on it, and a fresh array every render was making that effect refire far
  // more than intended (e.g. discarding an in-progress edit, or the
  // just-created temp password result). Computed before the early returns
  // below since hooks can't be called conditionally.
  const roleOptions = useMemo(() => [...BUILT_IN_ROLES, ...customRoles.map(r => r.name)], [customRoles])

  if (profile?.role !== 'admin') {
    return (
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>This page is only available to Admins.</p>
      </div>
    )
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading staff...</p>
    </div>
  )

  // Scope the page to staff who've actually been given a role through this
  // page. public.staff is a company-wide directory (HR, Procurement, etc.
  // included) -- most of it has nothing to do with property maintenance, so
  // "relevant" here means "has one of the roles this page manages."
  const relevantStaff = staffList.filter(s => roleOptions.includes(s.role))
  const unassignedStaff = staffList.filter(s => !roleOptions.includes(s.role))

  const filterTabs = ['All', ...roleOptions, 'Unassigned']

  // The role tabs above are about WHICH staff (by role), not whether
  // they're active -- deactivated staff never show in this list regardless
  // of tab, so a long list doesn't end up a mix of active and inactive.
  // They live in the separate "Deactivated Staff" section below instead.
  const filteredStaff = (roleFilter === 'All' ? relevantStaff
    : roleFilter === 'Unassigned' ? unassignedStaff
    : staffList.filter(s => s.role === roleFilter)
  ).filter(s => s.active !== false)

  const deactivatedStaff = staffList.filter(s => s.active === false)

  function renderStaffCard(s) {
    const isActive = s.active !== false
    const onDuty = isOnDuty(s.id)
    const rStyle = roleStyle(s.role)
    return (
      <div
        key={s.id}
        style={{
          background: COLORS.white, borderRadius: '16px', padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          opacity: isActive ? 1 : 0.55,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Avatar name={s.name} photoUrl={s.photo_url} size={36} />
          <div style={{ flex: '2 1 220px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
              {onDuty && (
                <span title="On Duty" style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS.green600, flexShrink: 0 }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{s.name}</span>
              {s.role && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: rStyle.color, background: rStyle.bg, padding: '2px 8px', borderRadius: '20px' }}>{s.role}</span>
              )}
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                color: isActive ? COLORS.green600 : COLORS.slate500, background: isActive ? COLORS.green100 : COLORS.slate100,
              }}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <span style={{ fontSize: '12px', color: COLORS.slate500 }}>{s.email}</span>
          </div>

          <div style={{ display: 'flex', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            <button onClick={() => setModalStaff(s)} style={actionBtnStyle}>Edit</button>
            <button onClick={() => setResetPasswordTarget(s)} style={actionBtnStyle}>🔑 Reset password</button>
            <button onClick={() => handleToggleActive(s)} style={actionBtnStyle}>{isActive ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>
        {toggleActiveErrors[s.id] && (
          <p style={modalErrorStyle}>⚠ Couldn't {isActive ? 'deactivate' : 'activate'}: {toggleActiveErrors[s.id]}</p>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '16px' }}>
        <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Admin</h1>
        <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Add, edit, activate/deactivate staff accounts, and manage roles. Use the "Unassigned" tab to bring someone new in from the wider staff list. Day-to-day duty monitoring lives on the Staff page.</p>
      </div>

      {autoReassignSummary && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          background: COLORS.blue50, border: `1px solid ${COLORS.blue200}`, borderRadius: '12px',
          padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: COLORS.blue900,
        }}>
          <span>
            <strong>{autoReassignSummary.staffName}</strong> was deactivated.{' '}
            {autoReassignSummary.reassignedCount} open ticket{autoReassignSummary.reassignedCount === 1 ? '' : 's'} automatically reassigned
            {autoReassignSummary.failures.length > 0
              ? `, ${autoReassignSummary.failures.length} need manual attention (${autoReassignSummary.failures.map(f => f.message).join('; ')}).`
              : '.'}
          </span>
          <button
            onClick={() => setAutoReassignSummary(null)}
            style={{ background: 'none', border: 'none', color: COLORS.blue900, fontWeight: 700, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Staff List + Role Management */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '2 1 480px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Staff List</p>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={filterSelectStyle}>
                {filterTabs.map(tab => (
                  <option key={tab} value={tab}>{tab}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setModalStaff(null)}
              style={{ padding: '9px 16px', background: COLORS.teal700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              ＋ Add Staff Member
            </button>
          </div>

          {filteredStaff.length === 0 ? (
            <div style={{ background: COLORS.white, borderRadius: '16px', padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No staff found.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredStaff.map(s => renderStaffCard(s))}
            </div>
          )}

          {deactivatedStaff.length > 0 && (
            <div style={{ marginTop: '20px' }}>
              <button
                onClick={() => setDeactivatedOpen(prev => !prev)}
                style={{
                  display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                  padding: '10px 14px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: COLORS.slate500,
                }}
              >
                <span>Deactivated Staff ({deactivatedStaff.length})</span>
                <span>{deactivatedOpen ? '▲ Collapse' : '▼ Expand'}</span>
              </button>
              {deactivatedOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
                  {deactivatedStaff.map(s => renderStaffCard(s))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 280px' }}>
          <RolesPanel
            staffList={staffList}
            customRoles={customRoles}
            customRolesError={customRolesError}
            onRolesChanged={setCustomRoles}
            divisions={divisions}
            onDivisionsChanged={setDivisions}
          />
        </div>
      </div>

      <LoginActivityPanel events={loginEvents} />
      <ErrorLogsPanel logs={errorLogs} />
      <StaffRecordEditorPanel staffList={staffList} onSaved={handleStaffSaved} />

      {modalStaff !== undefined && (
        <StaffFormModal
          staff={modalStaff}
          roleOptions={roleOptions}
          staffDirectory={staffList}
          onClose={() => setModalStaff(undefined)}
          onSaved={handleStaffSaved}
        />
      )}

      {resetPasswordTarget && (
        <ResetPasswordModal
          staff={resetPasswordTarget}
          onClose={() => setResetPasswordTarget(null)}
        />
      )}
    </div>
  )
}
