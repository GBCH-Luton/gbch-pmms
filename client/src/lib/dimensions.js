import { supabase } from './supabase'

export const ROOM_TYPES = ['bedroom', 'bathroom', 'kitchen', 'garden', 'communal']

// Every property, no lifecycle-status filter -- unlike Onboarding's
// Procured-only scope, a dimensions assessment applies to a property at any
// point in its lifecycle, not just while it's being brought into the
// portfolio. 'Internal' is excluded separately -- it's not a lifecycle
// stage, it marks non-tenant records like the GBCH office itself, which
// have no bedrooms/bathrooms to assess.
export async function fetchAllProperties() {
  const { data } = await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability, dimensions_assessed_at').neq('status', 'Internal').order('address')
  return data || []
}

export async function fetchPropertyDimensions(propertyId) {
  const { data: rows } = await supabase
    .schema('pmms')
    .from('property_room_dimensions')
    .select('*')
    .eq('property_id', propertyId)
    .order('room_index')

  const { data: property } = await supabase
    .schema('pmms')
    .from('properties')
    .select('bedroom_description, bathroom_description, kitchen_description, garden_communal_description, dimensions_update_note, dimensions_assessed_by_name, dimensions_assessed_at')
    .eq('id', propertyId)
    .maybeSingle()

  return { rows: rows || [], property: property || {} }
}

// Replace-then-insert -- a redo replaces the prior assessment wholesale
// rather than trying to diff it, same reasoning as why the wizard always
// reloads existing rows fresh rather than merging. Rows with no length/width
// (shouldn't happen given the wizard's own per-step validation, but this is
// the real boundary, not just trusting the UI) are silently skipped rather
// than saved half-empty.
export async function saveDimensions(propertyId, { rooms, desc, updateNote, profile }) {
  const { error: delErr } = await supabase.schema('pmms').from('property_room_dimensions').delete().eq('property_id', propertyId)
  if (delErr) throw new Error(delErr.message)

  const inserts = []
  ROOM_TYPES.forEach(type => {
    rooms[type].forEach((r, i) => {
      if (!r.length || !r.width) return
      inserts.push({
        property_id: propertyId,
        room_type: type,
        room_index: i + 1,
        length_m: parseFloat(r.length),
        width_m: parseFloat(r.width),
        orientation: type === 'garden' ? (r.orientation || null) : null,
      })
    })
  })

  if (inserts.length) {
    const { error: insErr } = await supabase.schema('pmms').from('property_room_dimensions').insert(inserts)
    if (insErr) throw new Error(insErr.message)
  }

  const { error: updErr } = await supabase
    .schema('pmms')
    .from('properties')
    .update({
      bedroom_description: desc.bedroom.trim() || null,
      bathroom_description: desc.bathroom.trim() || null,
      kitchen_description: desc.kitchen.trim() || null,
      garden_communal_description: desc.gardenCommunal.trim() || null,
      dimensions_update_note: updateNote.trim() || null,
      dimensions_assessed_by: profile.id,
      dimensions_assessed_by_name: profile.name,
      dimensions_assessed_at: new Date().toISOString(),
    })
    .eq('id', propertyId)
  if (updErr) throw new Error(updErr.message)
}
