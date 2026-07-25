import { supabase } from './supabase'

// pmms.tickets and pmms.properties are both in the pmms schema, but
// PostgREST's embed shorthand (`property:properties!property_id(...)`) was
// never restored after properties briefly lived in a different schema --
// every place that used to embed a ticket's property in one query still
// fetches properties separately and merges them in JS.
//
// `rows` is any array of records carrying a `property_id` column (tickets,
// mainly). `columns` is the same PostgREST column-select string you'd have
// put inside the old embed's parentheses. Returns the same rows with a
// `.property` object attached, matching the old embedded shape exactly --
// e.g. `t.property?.address` keeps working unchanged at every call site.
export async function attachProperties(rows, columns = 'address') {
  const propertyIds = [...new Set(rows.map(r => r.property_id).filter(id => id != null))]

  if (propertyIds.length === 0) {
    return rows.map(r => ({ ...r, property: null }))
  }

  const { data: properties } = await supabase
    .schema('pmms')
    .from('properties')
    .select(`id, ${columns}`)
    .in('id', propertyIds)

  const propertyById = {}
  ;(properties || []).forEach(p => { propertyById[p.id] = p })

  return rows.map(r => ({ ...r, property: propertyById[r.property_id] || null }))
}

// Builder-facing equivalent of attachProperties -- calls
// pmms.builder_properties() (a SECURITY DEFINER function) instead of
// selecting from pmms.properties directly. Builders have no direct
// row-level SELECT access to the properties table at all (removed
// 2026-07-22, see scripts/fix_builder_property_column_exposure.sql) --
// this function only ever returns a fixed, safe column set (id, address,
// high_vulnerability, layout_type, safeguards, electrical_shutoff,
// gas_shutoff), so there's no `columns` argument to pass here, unlike
// attachProperties.
export async function attachBuilderSafeProperties(rows) {
  const propertyIds = [...new Set(rows.map(r => r.property_id).filter(id => id != null))]

  if (propertyIds.length === 0) {
    return rows.map(r => ({ ...r, property: null }))
  }

  const { data: properties } = await supabase
    .schema('pmms')
    .rpc('builder_properties', { property_ids: propertyIds })

  const propertyById = {}
  ;(properties || []).forEach(p => { propertyById[p.id] = p })

  return rows.map(r => ({ ...r, property: propertyById[r.property_id] || null }))
}
