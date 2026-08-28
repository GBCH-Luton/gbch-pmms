import { supabase } from './supabase'

// Bug fix, same pattern as compliance.js: AdminRaiseTicket.jsx and
// BuilderDashboard.jsx used to define their own hardcoded copy of the
// maintenance ticket categories/issue tags/scores, so editing them on the
// Admin Settings page ("Maintenance Categories") had nowhere to actually
// take effect. This seeds the exact same categories/tags/scores that were
// previously hardcoded, so nothing changes for existing users until they
// actually edit something on the Settings page.
export const DEFAULT_MAINTENANCE_CATEGORIES = {
  'Electricity': {
    enabled: true,
    weight: 35,
    defaultMinutes: 45,
    order: 0,
    subCategories: [
      { label: 'Exposed Live Wires / Sparking', score: 65, minutes: 65 },
      { label: 'Complete Property Power Outage', score: 55, minutes: 65 },
      { label: 'Flickering Display Lights', score: 10, minutes: 30 },
      { label: 'Faulty Power Socket', score: 20, minutes: 40 },
      { label: 'Storage Heater Failure', score: 25, minutes: 45 },
    ],
  },
  'Plumbing': {
    enabled: true,
    weight: 20,
    defaultMinutes: 40,
    order: 1,
    subCategories: [
      { label: 'Burst Pipe / Active Flooding', score: 65, minutes: 60 },
      { label: 'Total Loss of Cold Drinking Water', score: 55, minutes: 55 },
      { label: 'No Hot Water Supply', score: 35, minutes: 50 },
      { label: 'Clogged Primary Toilet Block', score: 40, minutes: 45 },
      { label: 'Slow Dripping Tap', score: 10, minutes: 30 },
    ],
  },
  'Doors/Locks': {
    enabled: true,
    weight: 30,
    defaultMinutes: 35,
    order: 2,
    subCategories: [
      { label: 'Main Entrance Gate Jammed Open', score: 55, minutes: 35 },
      { label: 'Main Entrance Lockout / Jammed Shut', score: 60, minutes: 40 },
      { label: 'Fire Door Failing to Close Safely', score: 50, minutes: 30 },
      { label: 'Broken Outer Glazing / Window Shattered', score: 45, minutes: 30 },
      { label: 'Internal Bedroom Door Stuck', score: 35, minutes: 30 },
    ],
  },
  'Other / Unlisted Trade': {
    enabled: true,
    weight: 15,
    defaultMinutes: 20,
    order: 3,
    subCategories: [
      { label: 'Pest Vector / Active Rodent Infestation', score: 35, minutes: 30 },
      { label: 'Severe Floor Fabric / Carpet Water Damage', score: 30, minutes: 20 },
      { label: 'Broken Safety Wall Grab Rail Loose', score: 40, minutes: 30 },
      { label: 'Structural Plaster Ceiling Cracking Risk', score: 45, minutes: 35 },
      { label: 'General Unlisted Handyman Issue Entry', score: 15, minutes: 15 },
    ],
  },
}

// Postgres jsonb does not preserve object key order, so display order is
// tracked via this explicit numeric field (see AdminSettings.jsx). Consumers
// that render the categories object as a list must sort with this, not rely
// on Object.keys()/Object.entries() order.
export function sortedCategoryEntries(categories) {
  return Object.entries(categories).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
}

// Shared between AdminRaiseTicket.jsx (manager/admin) and
// SubmitterDashboard.jsx (the Ticket Submitter role) -- both need the exact
// same "pick a listed issue tag, or describe an unlisted one" fallback and
// the exact same scoring formula, so a ticket's priority never depends on
// which form raised it.
export const UNLISTED_MARKER_PREFIX = '__UNLISTED_FALLBACK__'

export const isUnlistedTag = (tag) => typeof tag === 'string' && tag.startsWith(UNLISTED_MARKER_PREFIX)
export const unlistedTagFor = (category) => `${UNLISTED_MARKER_PREFIX}${category}`
export const unlistedLabelFor = (category) => category === 'Other / Unlisted Trade' ? 'Something Else Entirely (Describe Below)' : `Other Unlisted ${category} Issue`

// Reads from the same maintenance_categories data the Admin Settings page
// manages -- a sub-category's own score, falling back to its parent
// category's weight (covers both the "unlisted issue" case and any
// category/sub-category combination that's missing a score for some reason).
export const calculatePriorityScore = (maintenanceCategories, category, issueTag) => {
  const cat = maintenanceCategories[category]
  if (!cat) return 15
  if (issueTag && !isUnlistedTag(issueTag)) {
    const sub = cat.subCategories.find(s => s.label === issueTag)
    if (sub) return Number(sub.score)
  }
  return Number(cat.weight) ?? 15
}

// Same fallback shape as calculatePriorityScore, for pre-filling the
// "Estimated time" field when a manager raises/reassigns a ticket -- a
// sub-category's own minutes, falling back to its parent category's
// defaultMinutes. Returns null (not a number) when neither is set, so
// callers can tell "no default configured" apart from "default is 0".
export const calculateDefaultEstimatedMinutes = (maintenanceCategories, category, issueTag) => {
  const cat = maintenanceCategories[category]
  if (!cat) return null
  if (issueTag && !isUnlistedTag(issueTag)) {
    const sub = cat.subCategories.find(s => s.label === issueTag)
    if (sub && sub.minutes !== undefined && sub.minutes !== null && sub.minutes !== '') return Number(sub.minutes)
  }
  return cat.defaultMinutes !== undefined && cat.defaultMinutes !== null && cat.defaultMinutes !== '' ? Number(cat.defaultMinutes) : null
}

// Migrates the legacy array shape (an earlier, short-lived implementation
// used [{id, name, enabled, category, items}], mirroring
// compliance_check_types) onto the new keyed-by-name object shape.
export function migrateLegacyArrayShape(raw) {
  const result = {}
  raw.forEach(entry => {
    if (!entry?.name) return
    result[entry.name] = {
      enabled: entry.enabled !== false,
      weight: entry.weight ?? 15,
      defaultMinutes: entry.defaultMinutes,
      subCategories: (entry.items || entry.subCategories || []).map(i => ({ label: i.label, score: i.score, minutes: i.minutes })),
    }
  })
  return result
}

async function fetchRawMaintenanceCategories() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'maintenance_categories')
    .maybeSingle()

  const raw = data?.setting_value
  return Array.isArray(raw)
    ? migrateLegacyArrayShape(raw)
    : (raw && typeof raw === 'object' && Object.keys(raw).length > 0 ? raw : DEFAULT_MAINTENANCE_CATEGORIES)
}

// Returns only enabled categories, for the ticket-raising screens. The
// Settings page itself reads the raw, unfiltered value directly (it needs
// to show disabled categories too, so they can be re-enabled).
//
// `division`, when passed, narrows the result to that division's
// categories only -- for a division-scoped manager (e.g. Housekeeping
// Manager) so their category picker doesn't list every Maintenance
// category. Omitted (the default for unscoped managers and Admin), this
// returns every category exactly as before -- no behaviour change there.
//
// Falls back to the full list when the scoped result is empty -- a
// division with no categories of its own (e.g. Landlord Liaison, once its
// one category was deleted 2026-08-17 as no longer needed) would otherwise
// leave that manager's ticket form completely empty. Same form everyone
// else sees, not a dead end.
export async function fetchMaintenanceCategories(division) {
  const categories = await fetchRawMaintenanceCategories()
  const enabled = Object.fromEntries(Object.entries(categories).filter(([, c]) => c.enabled !== false))
  if (!division) return enabled
  const scoped = Object.fromEntries(Object.entries(enabled).filter(([, c]) => (c.division || 'Maintenance') === division))
  return Object.keys(scoped).length > 0 ? scoped : enabled
}

// All category names (enabled AND disabled), in display order -- for
// filter dropdowns (Pipeline, Reports, a property's Maintenance tab).
// Unlike fetchMaintenanceCategories(), a disabled category must still show
// up here so existing tickets raised under it stay filterable.
// Same optional `division` narrowing (and same empty-scope fallback to the
// full list) as fetchMaintenanceCategories() above.
export async function fetchAllMaintenanceCategoryNames(division) {
  const categories = await fetchRawMaintenanceCategories()
  const all = sortedCategoryEntries(categories)
  if (!division) return all.map(([name]) => name)
  const scoped = all.filter(([, c]) => (c.division || 'Maintenance') === division)
  return (scoped.length > 0 ? scoped : all).map(([name]) => name)
}
