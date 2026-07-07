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
    order: 0,
    subCategories: [
      { label: 'Exposed Live Wires / Sparking', score: 65 },
      { label: 'Complete Property Power Outage', score: 55 },
      { label: 'Flickering Display Lights', score: 10 },
      { label: 'Faulty Power Socket', score: 20 },
      { label: 'Storage Heater Failure', score: 25 },
    ],
  },
  'Plumbing': {
    enabled: true,
    weight: 20,
    order: 1,
    subCategories: [
      { label: 'Burst Pipe / Active Flooding', score: 65 },
      { label: 'Total Loss of Cold Drinking Water', score: 55 },
      { label: 'No Hot Water Supply', score: 35 },
      { label: 'Clogged Primary Toilet Block', score: 40 },
      { label: 'Slow Dripping Tap', score: 10 },
    ],
  },
  'Doors/Locks': {
    enabled: true,
    weight: 30,
    order: 2,
    subCategories: [
      { label: 'Main Entrance Gate Jammed Open', score: 55 },
      { label: 'Main Entrance Lockout / Jammed Shut', score: 60 },
      { label: 'Fire Door Failing to Close Safely', score: 50 },
      { label: 'Broken Outer Glazing / Window Shattered', score: 45 },
      { label: 'Internal Bedroom Door Stuck', score: 35 },
    ],
  },
  'Other / Unlisted Trade': {
    enabled: true,
    weight: 15,
    order: 3,
    subCategories: [
      { label: 'Pest Vector / Active Rodent Infestation', score: 35 },
      { label: 'Severe Floor Fabric / Carpet Water Damage', score: 30 },
      { label: 'Broken Safety Wall Grab Rail Loose', score: 40 },
      { label: 'Structural Plaster Ceiling Cracking Risk', score: 45 },
      { label: 'General Unlisted Handyman Issue Entry', score: 15 },
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
      subCategories: (entry.items || entry.subCategories || []).map(i => ({ label: i.label, score: i.score })),
    }
  })
  return result
}

// Returns only enabled categories, for the ticket-raising screens. The
// Settings page itself reads the raw, unfiltered value directly (it needs
// to show disabled categories too, so they can be re-enabled).
export async function fetchMaintenanceCategories() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'maintenance_categories')
    .maybeSingle()

  const raw = data?.setting_value
  const categories = Array.isArray(raw)
    ? migrateLegacyArrayShape(raw)
    : (raw && typeof raw === 'object' && Object.keys(raw).length > 0 ? raw : DEFAULT_MAINTENANCE_CATEGORIES)

  return Object.fromEntries(Object.entries(categories).filter(([, c]) => c.enabled !== false))
}
