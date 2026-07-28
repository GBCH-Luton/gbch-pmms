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
import { fetchDivisions, saveDivisions, DEFAULT_DIVISIONS } from '../../lib/divisions'
import { fetchMaintenanceCategories, sortedCategoryEntries } from '../../lib/maintenanceCategories'
import { supabase } from '../../lib/supabase'
import {
  actionBtnStyle, Avatar, thStyle, tdStyle, formatUKDateTime, filterSelectStyle,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalLabelStyle, modalErrorStyle,
  modalCancelBtnStyle, modalConfirmBtnStyle, autoReassignDepartingStaffTickets, extractFunctionError,
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
  'Admin': { bg: '#dbeafe', color: '#1e3a8a' },
  'Builder': { bg: '#ccfbf1', color: '#0d9488' },
  'Cleaner': { bg: '#f3e8ff', color: '#9333ea' },
  'Support Worker': { bg: '#fef3c7', color: '#d97706' },
}
const CUSTOM_ROLE_STYLE = { bg: '#f1f5f9', color: '#64748b' }

function roleStyle(role) {
  return ROLE_STYLES[role] || CUSTOM_ROLE_STYLE
}

const inputStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }

const emptyForm = { name: '', email: '', role: 'Builder', job_title: '', phone: '', skills: [] }

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
      <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
        Give <strong>{name}</strong> this temporary password directly — in person, by phone, or secure message. It will not be shown again.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '12px' }}>
        <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '20px', fontWeight: 800, color: '#0f172a', letterSpacing: '0.04em' }}>{tempPassword}</span>
        <button
          onClick={handleCopy}
          style={{ padding: '8px 14px', background: copied ? '#16a34a' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div style={{ padding: '12px 14px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '12px', color: '#1e3a8a', lineHeight: 1.5 }}>
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
            <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b', lineHeight: 1.6 }}>
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
            <p style={{ margin: '2px 0 16px 0', fontSize: '13px', color: '#64748b' }}>{staff.email}</p>
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
      const { data, error: updateError } = await supabase
        .from('staff')
        .update({
          name: form.name.trim(),
          email: form.email.trim(),
          job_title: form.job_title.trim() || null,
          phone: form.phone.trim() || null,
          skills: form.skills,
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
          <p style={{ margin: '2px 0 16px 0', fontSize: '13px', color: '#64748b' }}>{createdAccount.staff.email}</p>
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
          <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
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

        <p style={modalLabelStyle}>Skills</p>
        <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#94a3b8' }}>
          Only affects which maintenance tickets get routed to them. Leave all unchecked if they can do any maintenance job.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '4px' }}>
          {skillOptions.map(name => (
            <label
              key={name}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '20px',
                border: `1px solid ${form.skills.includes(name) ? '#0f766e' : '#e2e8f0'}`,
                background: form.skills.includes(name) ? '#f0fdfa' : '#fff',
                fontSize: '12px', fontWeight: 600, color: form.skills.includes(name) ? '#0f766e' : '#475569', cursor: 'pointer',
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
    <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <p style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Roles</p>

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Built-in</p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {BUILT_IN_ROLES.map(r => {
          const style = roleStyle(r)
          return (
            <span key={r} style={{ fontSize: '11px', fontWeight: 700, color: style.color, background: style.bg, padding: '4px 12px', borderRadius: '20px' }}>{r}</span>
          )
        })}
      </div>

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Divisions</p>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {divisions.map(d => (
          <span key={d} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#1e3a8a', background: '#dbeafe', padding: '4px 6px 4px 12px', borderRadius: '20px' }}>
            {d}
            {d !== 'Maintenance' && (
              <button
                onClick={() => handleDeleteDivision(d)}
                title="Remove from the picklist -- roles/categories already tagged with this division keep working, they just won't offer it as a choice anymore"
                style={{ background: 'none', border: 'none', color: '#1e3a8a', fontSize: '12px', fontWeight: 800, cursor: 'pointer', padding: '0 2px' }}
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
            <button onClick={() => { setAddingDivision(false); setNewDivisionName(''); setDivisionError('') }} style={{ flex: 1, padding: '8px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleAddDivision}
              disabled={savingDivision}
              style={{ flex: 1, padding: '8px', background: '#1e3a8a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: savingDivision ? 'not-allowed' : 'pointer', opacity: savingDivision ? 0.6 : 1 }}
            >
              {savingDivision ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAddingDivision(true)}
          style={{ width: '100%', padding: '8px', marginBottom: '16px', background: '#fff', color: '#1e3a8a', border: '1px solid #bfdbfe', borderRadius: '10px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Division
        </button>
      )}

      <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Custom</p>

      {customRolesError && (
        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#dc2626' }}>{customRolesError}</p>
      )}

      {customRoles.length === 0 && !customRolesError && (
        <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No custom roles yet.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
        {customRoles.map(r => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '6px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>{r.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <select
                value={r.accessLevel}
                onChange={(e) => handleChangeAccessLevel(r.name, e.target.value)}
                title="What logging in with this role grants, on top of Job Title"
                style={{ fontSize: '11px', fontWeight: 700, padding: '4px 6px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer' }}
              >
                {Object.entries(ACCESS_LEVEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={r.division || ''}
                onChange={(e) => handleChangeDivision(r.name, e.target.value)}
                title="Scopes this role's database access to one division (e.g. a Housekeeping Manager only ever sees Housekeeping tickets). None = unscoped, full access."
                style={{ fontSize: '11px', fontWeight: 700, padding: '4px 6px', borderRadius: '6px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer' }}
              >
                <option value="">No division</option>
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <label
                title="Removes the Settings tab from the nav for this role. UI-only -- does not restrict database access."
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
                style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 700, color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
                style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '14px', fontWeight: 800, cursor: 'pointer', padding: '2px 6px' }}
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
            <button onClick={() => { setAdding(false); setNewRole(''); setError('') }} style={{ flex: 1, padding: '8px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={handleAddRole}
              disabled={saving}
              style={{ flex: 1, padding: '8px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1 }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{ width: '100%', padding: '10px', background: '#1e3a8a', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
        >
          ＋ Add Role
        </button>
      )}

      {deleteTarget && (
        <div style={modalOverlayStyle}>
          <div style={{ ...modalCardStyle, maxWidth: '380px' }}>
            <p style={modalTitleStyle}>Delete Role "{deleteTarget}"</p>
            {staffCountForRole(deleteTarget) > 0 ? (
              <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#d97706', fontWeight: 600 }}>
                ⚠ {staffCountForRole(deleteTarget)} staff member{staffCountForRole(deleteTarget) === 1 ? '' : 's'} currently have this role. They will keep the label on their record, but it will no longer appear as a filter tab.
              </p>
            ) : (
              <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: '#64748b' }}>No staff currently use this role.</p>
            )}
            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button onClick={() => setDeleteTarget(null)} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={handleDeleteRole}
                disabled={deleting}
                style={{ flex: 2, padding: '10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: deleting ? 'not-allowed' : 'pointer', opacity: deleting ? 0.6 : 1 }}
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
          padding: '14px 20px', background: '#fff', border: 'none', borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: '#0f172a',
        }}
      >
        <span>Recent Login Activity ({events.length})</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8' }}>{isOpen ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {isOpen && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '10px' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#94a3b8' }}>Most recent {LOGIN_EVENTS_LIMIT} sign-ins/sign-outs, newest first.</p>
          {events.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No login activity recorded yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={thStyle}>Staff</th>
                    <th style={thStyle}>Event</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(e => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{e.staff_name || e.email}</td>
                      <td style={tdStyle}>
                        <span style={{
                          fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px',
                          color: e.event_type === 'Signed In' ? '#16a34a' : '#64748b',
                          background: e.event_type === 'Signed In' ? '#dcfce7' : '#f1f5f9',
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
  js_error: { bg: '#fee2e2', color: '#dc2626' },
  unhandled_rejection: { bg: '#fef3c7', color: '#d97706' },
  react_render: { bg: '#f3e8ff', color: '#9333ea' },
  supabase_query: { bg: '#dbeafe', color: '#1e3a8a' },
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
          padding: '14px 20px', background: '#fff', border: 'none', borderRadius: '16px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', cursor: 'pointer', fontSize: '14px', fontWeight: 800, color: '#0f172a',
        }}
      >
        <span>Error &amp; Crash Log ({logs.length})</span>
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#94a3b8' }}>{isOpen ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {isOpen && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginTop: '10px' }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: '#94a3b8' }}>
            Most recent {ERROR_LOGS_LIMIT} JS crashes and failed queries, newest first. Cleared automatically after 30 days. Click a row for details.
          </p>
          {logs.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No errors recorded. Good sign.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Message</th>
                    <th style={thStyle}>Time</th>
                    <th style={thStyle}>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const style = ERROR_TYPE_STYLES[log.error_type] || { bg: '#f1f5f9', color: '#64748b' }
                    const isExpanded = expandedId === log.id
                    return (
                      <Fragment key={log.id}>
                        <tr
                          onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: isExpanded ? '#f8fafc' : undefined }}
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
                          <tr style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td colSpan={4} style={{ padding: '12px 8px', background: '#f8fafc' }}>
                              {log.stack && (
                                <pre style={{ margin: '0 0 8px 0', fontSize: '11px', color: '#475569', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{log.stack}</pre>
                              )}
                              {log.context && (
                                <pre style={{ margin: 0, fontSize: '11px', color: '#475569', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(log.context, null, 2)}</pre>
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
      <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>This page is only available to Admins.</p>
      </div>
    )
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading staff...</p>
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
          background: '#fff', borderRadius: '16px', padding: '14px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
          opacity: isActive ? 1 : 0.55,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <Avatar name={s.name} photoUrl={s.photo_url} size={36} />
          <div style={{ flex: '2 1 220px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
              {onDuty && (
                <span title="On Duty" style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{s.name}</span>
              {s.role && (
                <span style={{ fontSize: '10px', fontWeight: 700, color: rStyle.color, background: rStyle.bg, padding: '2px 8px', borderRadius: '20px' }}>{s.role}</span>
              )}
              <span style={{
                fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                color: isActive ? '#16a34a' : '#64748b', background: isActive ? '#dcfce7' : '#f1f5f9',
              }}>
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <span style={{ fontSize: '12px', color: '#64748b' }}>{s.email}</span>
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
        <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Admin</h1>
        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Add, edit, activate/deactivate staff accounts, and manage roles. Use the "Unassigned" tab to bring someone new in from the wider staff list. Day-to-day duty monitoring lives on the Staff page.</p>
      </div>

      {autoReassignSummary && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px',
          padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#1e3a8a',
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
            style={{ background: 'none', border: 'none', color: '#1e3a8a', fontWeight: 700, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap' }}
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
              <p style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: '#0f172a' }}>Staff List</p>
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} style={filterSelectStyle}>
                {filterTabs.map(tab => (
                  <option key={tab} value={tab}>{tab}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setModalStaff(null)}
              style={{ padding: '9px 16px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              ＋ Add Staff Member
            </button>
          </div>

          {filteredStaff.length === 0 ? (
            <div style={{ background: '#fff', borderRadius: '16px', padding: '32px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8', fontStyle: 'italic' }}>No staff found.</p>
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
                  padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px',
                  cursor: 'pointer', fontSize: '13px', fontWeight: 700, color: '#64748b',
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
