import { supabase } from './supabase'

// Towns/cities the property portfolio is spread across (Luton, Milton
// Keynes, Bedford, etc.) are stored the same way divisions/custom_roles
// already are -- a plain JSON array in pmms.settings -- so adding a new
// town later needs no schema change, just editing this one settings row
// via Settings > Towns / Areas.
export const DEFAULT_TOWNS = ['Luton', 'Milton Keynes', 'Bedford']

export async function fetchTowns() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'towns')
    .maybeSingle()

  const raw = data?.setting_value
  return Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_TOWNS
}

export async function saveTowns(towns) {
  await supabase
    .schema('pmms')
    .from('settings')
    .upsert({ setting_key: 'towns', setting_value: towns, updated_at: new Date().toISOString() }, { onConflict: 'setting_key' })
}
