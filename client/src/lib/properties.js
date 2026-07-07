import { supabase } from './supabase'

// pmms.tickets stays in the pmms schema while public.properties is now
// shared reference data in a different schema -- PostgREST's embed
// shorthand (`property:properties!property_id(...)`) can't resolve that
// relationship across schemas here (confirmed live: "Could not find a
// relationship between 'tickets' and 'properties' in the schema cache"),
// so every place that used to embed a ticket's property in one query now
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
    .from('properties')
    .select(`id, ${columns}`)
    .in('id', propertyIds)

  const propertyById = {}
  ;(properties || []).forEach(p => { propertyById[p.id] = p })

  return rows.map(r => ({ ...r, property: propertyById[r.property_id] || null }))
}
