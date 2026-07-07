import { supabase } from './supabase'

// Divisions (e.g. "Maintenance", "Housekeeping") are stored the same way
// custom_roles/maintenance_categories already are -- a plain JSON array in
// pmms.settings -- so adding a new division later needs no schema change,
// just editing this one settings row via the Roles page.
export const DEFAULT_DIVISIONS = ['Maintenance']

export async function fetchDivisions() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'divisions')
    .maybeSingle()

  const raw = data?.setting_value
  return Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_DIVISIONS
}

export async function saveDivisions(divisions) {
  await supabase
    .schema('pmms')
    .from('settings')
    .upsert({ setting_key: 'divisions', setting_value: divisions, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })
}
