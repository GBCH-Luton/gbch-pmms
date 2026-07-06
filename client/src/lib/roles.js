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
// 'manager' | 'builder' -- accessLevel controls login routing the same way
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
    ? { name: r, accessLevel: 'none', hideSettings: false }
    : { name: r.name, accessLevel: r.accessLevel || 'none', hideSettings: !!r.hideSettings }
  ))
}

// Resolves the login-routing access level ('admin' | 'manager' | 'builder' |
// null) granted purely by someone's PMMS Role assignment (pmms.staff_roles),
// given the current custom role definitions. Built-in Admin/Builder always
// grant their matching access; Cleaner/Support Worker never do; a custom
// role grants whatever accessLevel it was configured with on the Admin page.
// This only ever ADDS access on top of job_title-based routing -- see
// App.jsx's fetchProfile, which is the sole caller.
export function accessLevelForRole(roleName, normalizedCustomRoles) {
  if (roleName === 'Admin') return 'admin'
  if (roleName === 'Builder') return 'builder'
  if (roleName === 'Cleaner' || roleName === 'Support Worker') return null
  const custom = normalizedCustomRoles.find(r => r.name === roleName)
  if (custom?.accessLevel === 'manager') return 'manager'
  if (custom?.accessLevel === 'builder') return 'builder'
  return null
}

// UI-only: does this specific named role hide the Settings nav item? Only
// ever true for a custom role explicitly configured that way -- built-in
// roles (Admin/Builder/Cleaner/Support Worker) never hide it.
export function hideSettingsForRole(roleName, normalizedCustomRoles) {
  return !!normalizedCustomRoles.find(r => r.name === roleName)?.hideSettings
}
