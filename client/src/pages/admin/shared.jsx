// Shared constants, style tokens, and formatting helpers used across the
// admin/* page components, so the pipeline table, builder profile modal,
// and dashboard KPIs all render tickets/priorities/dates identically.

import { supabase } from '../../lib/supabase'
import { distanceMetres, ensurePropertyCoords } from '../../lib/geo'
import { normalizeCustomRoles } from '../../lib/roles'
import { attachProperties } from '../../lib/properties'

const DEFAULT_CLOCK_DISTANCE_THRESHOLD_M = 250

export const CATEGORIES = ['Electricity', 'Plumbing', 'Doors/Locks', 'Other / Unlisted Trade']
export const GLOBAL_TRIAGE_THRESHOLD = 70
export const P2_URGENT_THRESHOLD = 40

export const GENDER_RESTRICTION_OPTIONS = ['Male Only', 'Female Only', 'Both']
export const GENDER_RESTRICTION_STYLES = {
  'Male Only': { bg: '#e0e7ff', color: '#4338ca' },
  'Female Only': { bg: '#fce7f3', color: '#be185d' },
  'Both': { bg: '#ccfbf1', color: '#0d9488' },
}

export const STAFF_AVAILABILITY_OPTIONS = ['Available', 'On Leave', 'Sick']
export const STAFF_AVAILABILITY_STYLES = {
  'Available': { bg: '#dcfce7', color: '#16a34a' },
  'On Leave': { bg: '#fef3c7', color: '#d97706' },
  'Sick': { bg: '#fee2e2', color: '#dc2626' },
}

// Circular staff photo, falling back to initials-on-a-grey-circle when
// photo_url is null/empty (nobody has one set yet in the sandbox, but
// public.staff is the same company-wide table other systems also write to,
// so this reads whatever's there rather than needing its own upload path).
export function Avatar({ name, photoUrl, size = 36 }) {
  if (photoUrl) {
    return <img src={photoUrl} alt="" style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initials = (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: '#e2e8f0', color: '#64748b',
      fontSize: `${Math.round(size * 0.4)}px`, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {initials}
    </div>
  )
}

// Short label for a builder-picker <option> -- appends the availability
// status/note so managers see it's risky to assign before they pick it,
// without hiding the person outright (they may still need reassigning off
// their existing jobs while away).
export function builderOptionLabel(b) {
  if (!b.availability || b.availability === 'Available') return b.name
  return `${b.name} — ${b.availability}${b.availabilityNote ? `: ${b.availabilityNote}` : ''}`
}

export function priorityTierLabel(score) {
  if (score >= GLOBAL_TRIAGE_THRESHOLD) return 'P1 Critical'
  if (score >= P2_URGENT_THRESHOLD) return 'P2 Urgent'
  return 'P3 Routine'
}

export function priorityBadgeStyle(tier) {
  if (tier === 'P1 Critical') return { bg: '#fee2e2', color: '#dc2626' }
  if (tier === 'P2 Urgent') return { bg: '#fef3c7', color: '#d97706' }
  return { bg: '#f1f5f9', color: '#64748b' }
}

export const statusColour = (status) => {
  if (status === 'Assigned')    return '#3b82f6'
  if (status === 'In Progress') return '#0d9488'
  if (status === 'On Hold')     return '#d97706'
  if (status === 'Completed')   return '#9333ea'
  if (status === 'Archived')    return '#64748b'
  if (status === 'Cancelled')   return '#94a3b8'
  return '#3b82f6'
}

export const formatUKDate = (isoString) => {
  if (!isoString) return ''
  const d = new Date(isoString)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export const formatUKDateTime = (isoString) => {
  if (!isoString) return ''
  const d = new Date(isoString)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`
}

export const filterSelectStyle = { padding: '8px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 600, color: '#0f172a', background: '#f8fafc', cursor: 'pointer' }
export const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
export const tdStyle = { padding: '12px 14px', verticalAlign: 'top', fontSize: '13px' }
export const actionBtnStyle = { padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }

export const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }
export const modalCardStyle = { background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }
export const modalTitleStyle = { margin: 0, fontSize: '16px', fontWeight: 800, color: '#0f172a' }
export const modalSubtitleStyle = { margin: '2px 0 0 0', fontSize: '13px', color: '#64748b' }
export const modalLabelStyle = { display: 'block', margin: '16px 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
export const modalTextareaStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }
export const modalErrorStyle = { margin: '10px 0 0 0', fontSize: '13px', color: '#ef4444', fontWeight: 600 }
export const modalCancelBtnStyle = { flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
export const modalConfirmBtnStyle = { flex: 2, padding: '10px', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }

export function roleBadgeStyle(role) {
  if (role === 'admin' || role === 'manager') return { bg: '#f3e8ff', color: '#9333ea' }
  if (role === 'builder') return { bg: '#dbeafe', color: '#1d4ed8' }
  return { bg: '#ccfbf1', color: '#0d9488' }
}

export function radioRowStyle(active) {
  return {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
    borderRadius: '10px', border: active ? '2px solid #1d4ed8' : '1px solid #e2e8f0',
    background: active ? '#eff6ff' : '#fff', cursor: 'pointer',
  }
}

export function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0
  const totalMinutes = Math.round(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}

// Staff eligible to be assigned tickets under a given PMMS role name
// (pmms.staff_roles), NOT the company-wide job_title, so this always matches
// who the Staff page lists under that role. Also excludes inactive staff.
// Each person carries `availability`/`availabilityNote` (from
// pmms.staff_availability) so pickers can flag someone as On Leave/Sick
// without hiding them -- they may still need reassigning off existing jobs.
export async function fetchAssignableStaffForRole(roleName) {
  const { data: roleRows, error: roleError } = await supabase
    .schema('pmms')
    .from('staff_roles')
    .select('staff_id')
    .eq('role', roleName)

  if (roleError || !roleRows?.length) return []

  const { data: staffRows, error: staffError } = await supabase
    .from('staff')
    .select('id, name')
    .in('id', roleRows.map(r => r.staff_id))
    .eq('active', true)
    .order('name')

  if (staffError || !staffRows?.length) return staffError ? [] : (staffRows || [])

  const { data: availRows } = await supabase
    .schema('pmms')
    .from('staff_availability')
    .select('staff_id, status, note')
    .in('staff_id', staffRows.map(s => s.id))

  const availByStaffId = {}
  ;(availRows || []).forEach(a => { availByStaffId[a.staff_id] = a })

  return staffRows.map(s => ({
    ...s,
    availability: availByStaffId[s.id]?.status || 'Available',
    availabilityNote: availByStaffId[s.id]?.note || '',
  }))
}

// Kept as a thin wrapper -- every existing call site asks for Builders
// specifically, and this reads better at the call site than the generic
// name.
export async function fetchAssignableBuilders() {
  return fetchAssignableStaffForRole('Builder')
}

// Staff eligible to be assigned a ticket in a given category, taking the
// Divisions feature into account: looks up which division the category
// belongs to (pmms.settings['maintenance_categories'][category].division,
// defaulting to 'Maintenance'), then finds every role tagged with that same
// division at 'builder' access level (plus the built-in 'Builder' role when
// the division is 'Maintenance', matching today's behavior exactly), and
// returns the union of staff assignable under any of those roles. This is
// what makes a Housekeeping-category ticket offer Housekeepers instead of
// Builders, without any of this needing to hardcode "Housekeeper" anywhere
// -- adding a future division's staff role needs no change here.
// Same lookup pmms.category_division() does in SQL (for RLS), pulled out
// as its own client-side helper so callers that just need "which division
// is this category in" (e.g. reporting) don't have to go through the
// heavier fetchAssignableStaffForCategory, which also does an unrelated
// staff-role join. Takes the already-fetched maintenance_categories
// settings row so callers that need this for many tickets only fetch it
// once instead of once per ticket.
export function resolveCategoryDivision(category, categoriesSettingsRow) {
  return categoriesSettingsRow?.setting_value?.[category]?.division || 'Maintenance'
}

export async function fetchAssignableStaffForCategory(category) {
  const { data: categoriesRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'maintenance_categories')
    .maybeSingle()

  const categoryDivision = resolveCategoryDivision(category, categoriesRow)

  const { data: rolesRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)

  const roleNames = normalizedCustomRoles
    .filter(r => r.accessLevel === 'builder' && (r.division || 'Maintenance') === categoryDivision)
    .map(r => r.name)

  if (categoryDivision === 'Maintenance') roleNames.push('Builder')

  const staffLists = await Promise.all(roleNames.map(fetchAssignableStaffForRole))
  const byId = {}
  staffLists.flat().forEach(s => { byId[s.id] = s })
  return Object.values(byId).sort((a, b) => a.name.localeCompare(b.name))
}

// Counts jobs whose recorded clock-in/out location was further than the
// configured threshold from the property -- the exact same "flagged"
// definition the Clocking page itself uses, so this number always matches
// what a manager finds after clicking through. Counts a live session once
// (by its clock-in) and a completed job once (if either its first clock-in
// or its last clock-out was out of range).
export async function fetchFlaggedClockingCount() {
  const { data: settingsRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'clock_distance_threshold_meters')
    .maybeSingle()
  const thresholdM = settingsRow?.setting_value != null ? Number(settingsRow.setting_value) : DEFAULT_CLOCK_DISTANCE_THRESHOLD_M

  const { data: openSessions } = await supabase
    .schema('pmms')
    .from('work_sessions')
    .select('ticket_id, clock_in_lat, clock_in_lng')
    .is('ended_at', null)

  const { data: completedTicketsRaw } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, property_id')
    .in('status', ['Completed', 'Archived'])
  const completedTickets = await attachProperties(completedTicketsRaw || [], 'address, postcode, latitude, longitude')

  let liveTickets = []
  if (openSessions && openSessions.length > 0) {
    const { data } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, property_id')
      .in('id', openSessions.map(s => s.ticket_id))
    liveTickets = await attachProperties(data || [], 'address, postcode, latitude, longitude')
  }

  const allProperties = [...liveTickets, ...completedTickets].map(t => t.property).filter(Boolean)
  const coordsByPropertyId = await ensurePropertyCoords(allProperties)

  let flaggedCount = 0

  ;(openSessions || []).forEach(s => {
    const ticket = liveTickets.find(t => t.id === s.ticket_id)
    const coords = ticket?.property ? coordsByPropertyId[ticket.property.id] : null
    if (coords && s.clock_in_lat != null && s.clock_in_lng != null) {
      const distance = distanceMetres(s.clock_in_lat, s.clock_in_lng, coords.latitude, coords.longitude)
      if (distance > thresholdM) flaggedCount += 1
    }
  })

  if (completedTickets.length > 0) {
    const { data: sessionData } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('ticket_id, started_at, ended_at, clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng')
      .in('ticket_id', completedTickets.map(t => t.id))
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: true })

    completedTickets.forEach(t => {
      const sessions = (sessionData || []).filter(s => s.ticket_id === t.id)
      if (sessions.length === 0) return
      const coords = t.property ? coordsByPropertyId[t.property.id] : null
      if (!coords) return

      const first = sessions[0]
      const last = sessions[sessions.length - 1]
      const inDistance = (first.clock_in_lat != null && first.clock_in_lng != null)
        ? distanceMetres(first.clock_in_lat, first.clock_in_lng, coords.latitude, coords.longitude)
        : null
      const outDistance = (last.clock_out_lat != null && last.clock_out_lng != null)
        ? distanceMetres(last.clock_out_lat, last.clock_out_lng, coords.latitude, coords.longitude)
        : null

      if ((inDistance != null && inDistance > thresholdM) || (outDistance != null && outDistance > thresholdM)) {
        flaggedCount += 1
      }
    })
  }

  return flaggedCount
}

export async function postSystemComment(ticketId, profile, body) {
  await supabase
    .schema('pmms')
    .from('comments')
    .insert({
      ticket_id: ticketId,
      author_id: profile.id,
      author_name: profile.name,
      role: profile.role,
      body,
    })
}

export async function postAuditEvent(ticketId, profile, action, summary) {
  await supabase
    .schema('pmms')
    .from('audit_events')
    .insert({
      ticket_id: ticketId,
      actor_id: profile.id,
      actor_name: profile.name,
      action,
      summary,
    })
}

export async function createNotification(staffId, ticketId, message) {
  await supabase
    .schema('pmms')
    .from('notifications')
    .insert({ staff_id: staffId, ticket_id: ticketId, message })
}
