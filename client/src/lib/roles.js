// public.staff no longer has a `role` column (removed upstream in the company
// project). This derives the same admin/manager/builder role the app used to
// read directly from that column, based on job_title instead.

export const BUILDER_JOB_TITLES = [
  'General Builder',
  'Handyman',
  'Maintenance Operative',
  'Painter/Decorator',
]

const MANAGER_JOB_TITLES = [
  'Housing Manager',
  'Housing Benefit Manager',
  'Assistant Manager',
  'Team Leader',
  'Team Leader,Service Manager',
]

const ADMIN_JOB_TITLES = [
  'It & System Administrator',
  'IT and Database Assistant',
  'Director',
]

export function roleFromJobTitle(jobTitle) {
  if (ADMIN_JOB_TITLES.includes(jobTitle)) return 'admin'
  if (MANAGER_JOB_TITLES.includes(jobTitle)) return 'manager'
  if (BUILDER_JOB_TITLES.includes(jobTitle)) return 'builder'
  return null
}

// Custom PMMS roles (pmms.settings key 'custom_roles') are stored as
// { name, accessLevel, hideSettings } where accessLevel is 'none' |
// 'manager' | 'builder' | 'submitter' -- accessLevel controls login routing the same way
// the built-in "Admin" role does (see accessLevelForRole below). hideSettings
// is a UI-only convenience (not a real database restriction -- every
// 'manager'-level role has identical database permissions) that removes the
// Settings nav item for that specific named role, e.g. so a "Maintenance
// Assistant" can have Manager-equivalent access without seeing Settings.
// Older data may just be a plain array of name strings; normalize either
// shape to the same object form so every caller only ever deals with one.
export function normalizeCustomRoles(raw) {
  if (!Array.isArray(raw)) return []
  return raw.map(r => (typeof r === 'string'
    ? { name: r, accessLevel: 'none', hideSettings: false, division: null, canCreateEvents: false }
    : { name: r.name, accessLevel: r.accessLevel || 'none', hideSettings: !!r.hideSettings, division: r.division || null, canCreateEvents: !!r.canCreateEvents }
  ))
}

// Resolves the login-routing access level ('admin' | 'manager' | 'builder' |
// 'submitter' | null) granted purely by someone's PMMS Role assignment
// (pmms.staff_roles), given the current custom role definitions. Built-in
// Admin/Builder always grant their matching access; Cleaner/Support Worker
// never do (the real "Support Worker" role stays a zero-access label -- a
// custom role with accessLevel 'submitter', e.g. "Ticket Submitter", is the
// actual way to grant a narrow submit-and-view-own-tickets login, used as
// an internal stand-in until the standalone Support system exists). A
// custom role grants whatever accessLevel it was configured with on the
// Admin page. This only ever ADDS access on top of job_title-based routing
// -- see App.jsx's fetchProfile, which is the sole caller. Mirrored
// server-side by pmms.current_access_level() -- if this ever changes, that
// function must be updated to match.
export function accessLevelForRole(roleName, normalizedCustomRoles) {
  if (roleName === 'Admin') return 'admin'
  if (roleName === 'Builder') return 'builder'
  if (roleName === 'Support Worker') return null
  const custom = normalizedCustomRoles.find(r => r.name === roleName)
  if (custom?.accessLevel === 'manager') return 'manager'
  if (custom?.accessLevel === 'builder') return 'builder'
  if (custom?.accessLevel === 'submitter') return 'submitter'
  return null
}

// UI-only: does this specific named role hide the Settings nav item? Only
// ever true for a custom role explicitly configured that way -- built-in
// roles (Admin/Builder/Support Worker) never hide it.
export function hideSettingsForRole(roleName, normalizedCustomRoles) {
  return !!normalizedCustomRoles.find(r => r.name === roleName)?.hideSettings
}

// Can this named role create a new Event (the Compliance/Landlord Liaison
// ticket-coordination feature)? Only ever true for a custom role explicitly
// given this permission -- built-in roles never grant it, matching
// hideSettingsForRole's shape exactly. Mirrored server-side by
// pmms.current_can_create_events() for actual RLS enforcement -- this
// client-side check alone only controls what the UI offers.
export function canCreateEventsForRole(roleName, normalizedCustomRoles) {
  return !!normalizedCustomRoles.find(r => r.name === roleName)?.canCreateEvents
}

// Which division (e.g. "Housekeeping") this named role is scoped to, or
// null for "unscoped" -- every built-in role and every custom role that
// hasn't been tagged with a division resolves to null, meaning full,
// unrestricted access exactly like today (see pmms.current_division(),
// the SQL-side mirror of this same lookup).
export function divisionForRole(roleName, normalizedCustomRoles) {
  return normalizedCustomRoles.find(r => r.name === roleName)?.division || null
}
