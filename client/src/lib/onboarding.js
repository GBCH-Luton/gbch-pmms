import { supabase } from './supabase'

// Six fixed rooms, five fixed checklist items, identical every walk by
// default (confirmed explicitly at launch, "for now is ok"). A property
// with more bedrooms/kitchens/bathrooms than this default gets the extra
// ones appended to its own walk's `extra_rooms` column (see
// scripts/add_onboarding_walk_extra_rooms.sql) rather than changing this
// constant -- ROOMS stays the fixed baseline every walk starts with;
// effectiveRoomsFor() below is what actually reflects one walk's real
// room list.
export const ROOMS = ['Kitchen', 'Living Room', 'Hallway', 'Bedroom 1', 'Bedroom 2', 'Bathroom']

// The five room types the walk groups rooms into (see groupRoomsByType) --
// every type is addable now, not just Bedroom/Kitchen/Bathroom (a split-
// level property can genuinely have 2 living rooms or 2 hallways too),
// matching the "2 or 3 kitchens, 4 or 6 bedrooms" cases this was built for.
export const ROOM_TYPES = ['Kitchen', 'Living Room', 'Hallway', 'Bedroom', 'Bathroom']

export const CHECK_ITEMS = [
  { key: 'walls', label: 'Walls, ceiling & decoration' },
  { key: 'flooring', label: 'Flooring' },
  { key: 'windows_doors', label: 'Windows, doors & locks' },
  { key: 'fixtures', label: 'Fixtures & fittings' },
  { key: 'safety', label: 'Safety (smoke alarm / sockets / trip hazards)' },
]

// This walk's full room list -- the fixed baseline plus whatever extra
// rooms have been added to it so far. Every place that used to read ROOMS
// directly for a specific walk (pills bar, room routing, the Landlord
// Liaison review screen) reads this instead.
export function effectiveRoomsFor(walk) {
  return [...ROOMS, ...(walk?.extra_rooms || [])]
}

// "Bedroom" -> "Bedroom 3" (if 1 & 2 already exist), or the bare type name
// if this is the first of its kind beyond the singular default (e.g.
// "Kitchen" -> "Kitchen 2", since the existing "Kitchen" entry has no
// trailing number of its own).
export function nextRoomName(existingRooms, baseType) {
  const count = existingRooms.filter(r => r === baseType || r.startsWith(`${baseType} `)).length
  return count === 0 ? baseType : `${baseType} ${count + 1}`
}

// Inverse of nextRoomName's naming -- "Bedroom 3" -> "Bedroom", "Kitchen" ->
// "Kitchen". Groups a walk's room list into the wizard's per-type steps
// (Kitchens / Living Room / Hallway / Bedrooms / Bathrooms), preserving
// each type's first-appearance order -- ROOMS already lists the 5 types in
// the fixed order the wizard should show them, so a fresh walk's steps
// come out in that order for free; extra_rooms only ever adds to an
// existing group, never introduces a new one (every type already has at
// least its default room from ROOMS).
export function roomBaseType(roomName) {
  return roomName.replace(/ \d+$/, '')
}
export function groupRoomsByType(rooms) {
  const order = []
  const byType = {}
  rooms.forEach(r => {
    const type = roomBaseType(r)
    if (!byType[type]) { byType[type] = []; order.push(type) }
    byType[type].push(r)
  })
  return order.map(type => ({ type, rooms: byType[type] }))
}

// Appends one room to a walk's extra_rooms and persists it -- RLS already
// covers this (onboarding_am_and_liaison is an ALL-command policy), no RPC
// needed. Returns the updated walk row so callers can setWalk(...) it
// straight back into state.
export async function addExtraRoom(walk, roomName) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .update({ extra_rooms: [...(walk.extra_rooms || []), roomName] })
    .eq('id', walk.id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// Undoes an accidental "+ Add another {type}" tap. Only ever removes from
// extra_rooms -- the fixed ROOMS baseline every walk starts with is never
// touched. Callers are responsible for only offering this while the room
// has no persisted checks yet (see PropertyOnboardingWalk.jsx's roomForms
// -- an open, not-yet-submitted room is the only thing safe to undo; once
// submitted, checks/tickets already exist against that room name and
// removing it would orphan them).
export async function removeExtraRoom(walk, roomName) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .update({ extra_rooms: (walk.extra_rooms || []).filter(r => r !== roomName) })
    .eq('id', walk.id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// One free-text description per individual room (not per type -- "Bedroom
// 3" gets its own, separate from "Bedroom 1"), see
// scripts/add_onboarding_room_notes.sql. Same "keyed by room text" idiom
// as property_onboarding_checks.room -- no need to know which rooms exist
// in advance, any room name this walk has can get a note.
export async function fetchRoomNotes(walkId) {
  const { data } = await supabase
    .schema('pmms')
    .from('property_onboarding_room_notes')
    .select('room, description')
    .eq('walk_id', walkId)
  const byRoom = {}
  ;(data || []).forEach(r => { byRoom[r.room] = r.description })
  return byRoom
}

export async function saveRoomDescription(walkId, room, description) {
  const { error } = await supabase
    .schema('pmms')
    .from('property_onboarding_room_notes')
    .upsert({ walk_id: walkId, room, description, updated_at: new Date().toISOString() }, { onConflict: 'walk_id,room' })
  if (error) throw new Error(error.message)
}

// Must match a sub-category label in the "Property Onboarding" category
// seeded by scripts/add_property_onboarding_category.sql.
export const ONBOARDING_CATEGORY = 'Property Onboarding'

// "Resolved", for the go-live gate, means fully signed off (Archived), not
// just builder-Completed -- deliberately stricter than the app's usual
// open-ticket definition (OPEN_TICKET_STATUS_EXCLUSION in shared.jsx, which
// also treats Completed as not-open everywhere else) per this feature's
// explicit confirmed answer: a ticket sitting Completed-but-unsigned-off
// must still block go-live.
const RESOLVED_STATUSES = ['Archived', 'Cancelled']

// Every open ticket on the property blocks both submission-to-review and
// final approval -- including ones with nothing to do with this walk. Runs
// at both checkpoints since time passes between them and either side (the
// Assistant Manager or the Landlord Liaison) can add tickets in between.
export async function fetchPropertyOpenTickets(propertyId) {
  const { data } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, ticket_number, category, issue_tag, room, status, raised_by_name')
    .eq('property_id', propertyId)
    .not('status', 'in', `(${RESOLVED_STATUSES.map(s => `"${s}"`).join(',')})`)
    .order('created_at', { ascending: false })
  return data || []
}

// Same "still open" definition as fetchPropertyOpenTickets, but a count per
// property rather than the full rows for just one -- lets the picker list
// show how many tickets are still outstanding before clicking into a
// property, not just after (found wanted live on the "Waiting On Tickets"
// tile, 2026-09-03: a manager could only see the count by opening each
// property one at a time). No GROUP BY count in PostgREST, so this pulls
// just property_id for every matching row and tallies client-side.
export async function fetchOpenTicketCountsByProperty(propertyIds) {
  if (!propertyIds || propertyIds.length === 0) return {}
  const { data } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('property_id')
    .in('property_id', propertyIds)
    .not('status', 'in', `(${RESOLVED_STATUSES.map(s => `"${s}"`).join(',')})`)

  const counts = {}
  ;(data || []).forEach(t => { counts[t.property_id] = (counts[t.property_id] || 0) + 1 })
  return counts
}

// Procured properties (the only ones eligible to be walked), each carrying
// its own active walk if one exists -- 'in_progress' | 'pending_liaison_review'
// | 'sent_back'. An 'approved' walk isn't "active" any more (the property
// left Procured for Live, so it drops out of this list on its own).
export async function fetchOnboardingProperties() {
  const { data: properties } = await supabase
    .schema('pmms')
    .from('properties')
    .select('id, address, high_vulnerability, layout_type, status, has_garden, garden_state, garden_front_photo_url, garden_back_photo_url')
    .eq('status', 'Procured')
    .order('address')

  const { data: walks } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .select('*')
    .in('status', ['in_progress', 'pending_liaison_review', 'sent_back'])

  return (properties || []).map(p => ({
    ...p,
    walk: (walks || []).find(w => w.property_id === p.id) || null,
  }))
}

// Reuses an already-active walk on this property (another Assistant
// Manager may have started it, or this is a resume) rather than always
// creating a new one -- the DB's own partial unique index is the real
// guarantee against two walks existing at once; this just avoids a
// needless insert-then-conflict round trip in the common case.
export async function startOrResumeWalk(propertyId, profile) {
  const { data: existing } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .select('*')
    .eq('property_id', propertyId)
    .in('status', ['in_progress', 'pending_liaison_review', 'sent_back'])
    .maybeSingle()
  if (existing) return existing

  const { data, error } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .insert({ property_id: propertyId, started_by: profile.id, started_by_name: profile.name })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

// No PostgREST embedding anywhere else in this codebase (every other page
// does a separate fetch + JS-side join) -- matching that instead of being
// the first to rely on embed syntax against a relationship that's never
// been exercised.
export async function fetchWalkChecks(walkId) {
  const { data: checks } = await supabase
    .schema('pmms')
    .from('property_onboarding_checks')
    .select('*')
    .eq('walk_id', walkId)
    .order('created_at')

  const ticketIds = [...new Set((checks || []).map(c => c.ticket_id).filter(Boolean))]
  const { data: tickets } = ticketIds.length
    ? await supabase.schema('pmms').from('tickets').select('id, ticket_number, status, issue_tag, description, photo_url').in('id', ticketIds)
    : { data: [] }

  return (checks || []).map(c => ({ ...c, ticket: (tickets || []).find(t => t.id === c.ticket_id) || null }))
}

// Called after any ticket gets signed off (Archived) -- checks whether that
// was the last open ticket on a property whose onboarding walk has already
// finished all its rooms, and if so silently advances the walk to
// 'pending_liaison_review' with no further action from anyone. This is
// deliberately silent: the Maintenance Assistant's job is to walk the
// property and raise tickets, not babysit their resolution -- the whole
// point is she never needs to come back and check.
// A security-definer RPC (see scripts/add_property_onboarding_auto_submit.sql)
// because whoever just signed off a ticket may be neither the Maintenance
// Assistant nor Landlord Liaison (a pre-existing legacy ticket can belong to
// any manager or submitter), so this can't rely on their own RLS access to
// pmms.property_onboarding_walks. Best-effort: a failure here must never
// block or surface an error on the sign-off action that triggered it.
export async function maybeAutoSubmitOnboardingWalk(propertyId) {
  if (!propertyId) return
  try {
    await supabase.schema('pmms').rpc('maybe_auto_submit_onboarding_walk', { p_property_id: propertyId })
  } catch {
    // swallow -- see comment above
  }
}

// "Rooms done" alone used to be the whole story here; the Garden step is
// now also a required, active task (not a passive wait), so a walk that's
// rooms-complete but garden-pending still counts as "walking", not
// "waiting on tickets" -- see fetchOnboardingMetrics below.
function isWalkStepsComplete(checks, walk) {
  const roomsDone = effectiveRoomsFor(walk).every(room => CHECK_ITEMS.every(item =>
    checks.some(c => c.walk_id === walk.id && c.room === room && c.item_key === item.key)
  ))
  return roomsDone && !!walk.garden_step_completed_at
}

// Powers the Maintenance Assistant's KPI tiles (PropertyOnboardingWalk.jsx)
// and the sidebar badge count (AdminDashboard.jsx shell) -- one query pass,
// returning both a headline count and the actual property-id set for each
// bucket, so a tile's number and what clicking it filters to can never
// drift apart from each other.
export async function fetchOnboardingMetrics() {
  const { data: properties } = await supabase.schema('pmms').from('properties').select('id').eq('status', 'Procured')
  const { data: walks } = await supabase.schema('pmms').from('property_onboarding_walks').select('id, property_id, status, extra_rooms, garden_step_completed_at')

  const activeWalks = (walks || []).filter(w => w.status === 'in_progress' || w.status === 'sent_back')
  const walkIds = activeWalks.map(w => w.id)
  const { data: checks } = walkIds.length
    ? await supabase.schema('pmms').from('property_onboarding_checks').select('walk_id, room, item_key').in('walk_id', walkIds)
    : { data: [] }

  const nonApprovedWalkPropertyIds = new Set((walks || []).filter(w => w.status !== 'approved').map(w => w.property_id))

  return {
    toWalkIds: new Set((properties || []).filter(p => !nonApprovedWalkPropertyIds.has(p.id)).map(p => p.id)),
    walkingIds: new Set(activeWalks.filter(w => !isWalkStepsComplete(checks || [], w)).map(w => w.property_id)),
    waitingIds: new Set(activeWalks.filter(w => isWalkStepsComplete(checks || [], w)).map(w => w.property_id)),
    liaisonIds: new Set((walks || []).filter(w => w.status === 'pending_liaison_review').map(w => w.property_id)),
    liveCount: (walks || []).filter(w => w.status === 'approved').length,
  }
}

// Walk's final stage -- reuses the exact fields/behaviour of the Ticket
// Submitter's Garden Check campaign (GardenSurvey.jsx) but writes
// straight to pmms.properties instead of going through
// pmms.submit_garden_survey, which hard-checks current_access_level() =
// 'submitter' and would silently reject a Maintenance Assistant. She
// already has full RLS access via admin_manager_full_access (same as
// PropertyGardensTab.jsx's own saveFields), so a plain update is enough.
// Falls back to the property's current values when hasGarden is false,
// matching the RPC's own "preserve if no garden" semantics.
export async function saveGardenStep(walk, property, profile, { hasGarden, state, frontUrl, backUrl }) {
  const { error: propError } = await supabase
    .schema('pmms')
    .from('properties')
    .update({
      has_garden: hasGarden,
      garden_state: hasGarden ? (state || null) : property.garden_state,
      garden_last_attended_date: hasGarden ? new Date().toISOString().slice(0, 10) : property.garden_last_attended_date,
      garden_last_attended_by: hasGarden ? profile.name : property.garden_last_attended_by,
      garden_front_photo_url: hasGarden ? (frontUrl || property.garden_front_photo_url) : property.garden_front_photo_url,
      garden_back_photo_url: hasGarden ? (backUrl || property.garden_back_photo_url) : property.garden_back_photo_url,
    })
    .eq('id', property.id)
  if (propError) throw new Error(propError.message)

  // garden_step_completed_at is walk-scoped -- separate from the
  // campaign's own garden_survey_completed_at, which drives that
  // feature's own picker/dedupe logic and shouldn't be conflated with
  // "this walk covered it".
  const { data, error: walkError } = await supabase
    .schema('pmms')
    .from('property_onboarding_walks')
    .update({ garden_step_completed_at: new Date().toISOString() })
    .eq('id', walk.id)
    .select()
    .single()
  if (walkError) throw new Error(walkError.message)
  return data
}

export async function recordPass(walkId, room, itemKey, profile) {
  const { error } = await supabase
    .schema('pmms')
    .from('property_onboarding_checks')
    .insert({ walk_id: walkId, room, item_key: itemKey, verdict: 'pass', source: 'walk', raised_by_name: profile.name })
  if (error) throw new Error(error.message)
}
