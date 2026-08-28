// Shared constants, style tokens, and formatting helpers used across the
// admin/* page components, so the pipeline table, builder profile modal,
// and dashboard KPIs all render tickets/priorities/dates identically.

import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { distanceMetres, ensurePropertyCoords } from '../../lib/geo'
import { normalizeCustomRoles } from '../../lib/roles'
import { attachProperties } from '../../lib/properties'

const DEFAULT_CLOCK_DISTANCE_THRESHOLD_M = 250

// Shared by AdminReports.jsx (date-range trend view) and AdminPipeline.jsx
// (Print/Export date-range filter) -- both need the same type="date"
// input value formatting.
export function isoDateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

// Paused 2026-07-22 -- the managers want to settle how Compliance/Landlord
// Liaison division access should work before revisiting cross-division
// ticket coordination. The Events table, RLS, and page all still exist
// (see AdminEvents.jsx) -- this just pulls its nav item and the two
// Pipeline/Raise-Ticket entry points out of view. Flip back to true to
// bring it all back with no rebuilding.
export const EVENTS_FEATURE_ENABLED = false

// Hidden 2026-08-09 to make room for Quick Guide in the sidebar -- the AI
// Trial pages, RLS and route all still exist (see admin/ai-trial/*.jsx)
// this just pulls its nav item out of view. Flip back to true to bring it
// back with no rebuilding.
export const AI_TRIAL_FEATURE_ENABLED = false

// Hidden, then restored the same day (2026-08-15). Turned out the
// dedicated division page (AdminLandlordLiaison.jsx: open ticket queue +
// landlord directory) duplicates what Pipeline already gives the Landlord
// Liaison Manager herself, so this stays scoped to Admin/unscoped
// Maintenance Manager oversight only (see the `divisions` list on the nav
// item and `landlordLiaisonVisible` on the main dashboard) -- same
// asymmetric treatment Void Aging/Gardens/Housekeeping's summary already
// get, just narrower than Compliance/Housekeeping's own nav items, which
// also stay visible to the division manager themselves.
export const LANDLORD_LIAISON_PAGE_ENABLED = true

// Disabled 2026-08-20 on a management request -- tickets raised by anyone
// without their own assignment picker (Ticket Submitter role, Landlord
// Liaison Manager) no longer get silently routed to a builder via
// suggestAutoAssignBuilder; they land Pending/unassigned for a real manager
// to assign by hand instead, same as before the RLS fixes in
// suggestAutoAssignBuilder's own history. Does NOT affect the pre-filled
// suggestion shown to managers in AdminRaiseTicket's own picker (canAssignBuilder
// === true) -- that one's always reviewed/overridable before submit, so it
// wasn't in scope.
//
// Lives in pmms.settings, NOT a hardcoded JS constant -- deliberately never
// cached, fetched fresh every time a ticket is about to be raised. Found
// live 2026-08-24 (ticket #414): a hardcoded constant only reflects
// whatever was true when a tab's JS was last loaded, so a tab left open
// since before this flag existed (or before any future flip) keeps
// enforcing the old value indefinitely -- a genuine sign-in forces a
// reload, but a tab that's simply stayed authenticated for days without
// one never gets the memo. Reading this from the database at the moment
// of submission closes that gap regardless of how stale the rest of the
// tab's code is. Defaults to false (the current desired state) if the
// settings row is ever missing, not true -- a missing setting should never
// silently re-enable something that was deliberately turned off.
export async function fetchAutoAssignOnRaiseEnabled() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'auto_assign_on_raise_enabled')
    .maybeSingle()
  return data?.setting_value === true
}

// Temporary garden survey campaign (2026-08-20) -- support workers (Ticket
// Submitter role) visit properties daily and can record garden state/photos
// while they're there, cheaper than waiting on an admin to do it via the
// real Gardens tab. Gates the "Garden Check" nav item on SubmitterDashboard
// (see GardenSurvey.jsx + pmms.garden_survey_properties()/
// submit_garden_survey() in scripts/add_garden_survey_campaign.sql). Flip
// to false once every property's been covered to pull the menu -- the
// underlying data/functions stay in place, nothing to rebuild if a similar
// sweep is ever needed again.
export const GARDEN_SURVEY_CAMPAIGN_ENABLED = true

export const GLOBAL_TRIAGE_THRESHOLD = 70
export const P2_URGENT_THRESHOLD = 40

// Builder v2 Stop-sheet reasons that keep a builder locked to a break timer
// on the same ticket rather than releasing them back to the job list (see
// BuilderDashboard.jsx's handleStop). Centralised here -- rather than left
// as BuilderDashboard.jsx's own local constant -- so the "where is everyone
// right now" views (AdminClocking.jsx's Today's Attendance, AdminDashboard's
// Where's the Team) can recognise the same on-hold-but-away state instead of
// misreading it as "Available".
export const SHORT_TRIP_REASONS = ['Going to the Office', 'Lunch Break', 'Getting materials myself']

// One entry per activity_log.activity_category value -- lets Where's the
// Team and Clocking's history tell "Buying Materials" apart from "Going to
// Another Job"/"Going to the Office" instead of all three reading as one
// generic "Travelling". Colours are distinct from every other status tone
// already in use (green=in, slate=out, teal=on a job, amber=hold/early,
// red=no access) so none of these reads as a false alarm.
export const ACTIVITY_CATEGORY_META = {
  lunch: { label: 'On lunch break', leftVerb: 'started lunch break', backVerb: 'back from lunch', dot: COLORS.violet600, chipBg: COLORS.violet100, chipFg: COLORS.violet600 },
  materials: { label: 'Buying materials', leftVerb: 'left for materials', backVerb: 'back from materials run', dot: COLORS.pink600, chipBg: COLORS.pink100, chipFg: COLORS.pink600 },
  job: { label: 'Heading to another job', leftVerb: 'left site — heading to another job', backVerb: 'arrived on site', dot: COLORS.indigo700, chipBg: COLORS.indigo100, chipFg: COLORS.indigo700 },
  office: { label: 'At the office', leftVerb: 'left for the office', backVerb: 'back from the office', dot: COLORS.purple600, chipBg: COLORS.purple50, chipFg: COLORS.purple600 },
  // Kathryn's property-visit legs (Log a Visit) split into two phases
  // within one activity_log row -- travel (started_at -> arrived_at) then
  // on site (arrived_at -> ended_at) -- so `travelLabel`/`arriveVerb` cover
  // the mid-point (arriving at the property) and `label`/`backVerb` cover
  // the on-site phase and its own finish, on top of the leftVerb/label
  // pair every other category already has for its single phase. Callers
  // that don't know about the extra fields (every builder-side category
  // above) just never read them.
  visit: {
    label: 'Visiting a property', travelLabel: 'Travelling to a property',
    leftVerb: 'left for a property visit', arriveVerb: 'arrived at the property', backVerb: 'finished the property visit',
    dot: COLORS.blue600, chipBg: COLORS.blue100, chipFg: COLORS.blue700,
  },
  // Travel-only legs with no on-site phase -- unlike builders' own
  // `office` above (which means "away from site, at the office, now
  // back"), for Kathryn the office IS home base, so arriving there just
  // closes the trip -- distinct key so the wording doesn't collide.
  visit_office: { label: 'Travelling to the office', leftVerb: 'left for the office', backVerb: 'arrived at the office', dot: COLORS.purple600, chipBg: COLORS.purple50, chipFg: COLORS.purple600 },
  visit_other: { label: 'Travelling', leftVerb: 'left', backVerb: 'arrived', dot: COLORS.slate500, chipBg: COLORS.slate100, chipFg: COLORS.slate600 },
}
// activity_category is null on rows written before this column existed --
// falls back to the old generic Travel/Break split rather than guessing.
export function activityCategoryMeta(activityType, activityCategory) {
  if (activityCategory && ACTIVITY_CATEGORY_META[activityCategory]) return ACTIVITY_CATEGORY_META[activityCategory]
  return activityType === 'Break'
    ? { label: 'On break', leftVerb: 'started break', backVerb: 'back from break', dot: COLORS.violet600, chipBg: COLORS.violet100, chipFg: COLORS.violet600 }
    : { label: 'Travelling', leftVerb: 'left site', backVerb: 'returned to site', dot: COLORS.violet600, chipBg: COLORS.violet100, chipFg: COLORS.violet600 }
}

export const GENDER_RESTRICTION_OPTIONS = ['Male Only', 'Female Only', 'Both']
export const GENDER_RESTRICTION_STYLES = {
  'Male Only': { bg: COLORS.indigo100, color: COLORS.indigo700 },
  'Female Only': { bg: COLORS.pink100, color: COLORS.pink700 },
  'Both': { bg: COLORS.teal100, color: COLORS.teal600 },
}

export const GARDEN_STATE_OPTIONS = ['Good', 'Needs Attention', 'Overgrown']
export const GARDEN_STATE_STYLES = {
  'Good': { bg: COLORS.green100, color: COLORS.green600 },
  'Needs Attention': { bg: COLORS.amber100, color: COLORS.amber600 },
  'Overgrown': { bg: COLORS.red100, color: COLORS.red600 },
}

// supabase-js resolves a non-2xx Edge Function response as `error`, with the
// JSON body only reachable via error.context (a Response) -- this digs the
// { error: "..." } message back out, falling back to the SDK's own message.
export async function extractFunctionError(error) {
  try {
    const parsed = await error.context?.json()
    if (parsed?.error) return parsed.error
  } catch {
    // fall through to the generic message below
  }
  return error.message || 'Something went wrong. Please try again.'
}

export const STAFF_AVAILABILITY_OPTIONS = ['Available', 'On Leave', 'Sick']
export const STAFF_AVAILABILITY_STYLES = {
  'Available': { bg: COLORS.green100, color: COLORS.green600 },
  'On Leave': { bg: COLORS.amber100, color: COLORS.amber600 },
  'Sick': { bg: COLORS.red100, color: COLORS.red600 },
}

// public.staff is a company-wide table other systems also write to, and
// they don't all store photo_url the same way -- PMMS's own uploads always
// write a full https:// URL (via storage.getPublicUrl()), but at least one
// other system stores just a bare filename in a shared "staff-photos"
// bucket and reconstructs the full URL itself elsewhere. Resolving through
// getPublicUrl() here handles both: passing an already-absolute URL
// through unchanged, or turning a bare filename into a real URL.
export function resolveStaffPhotoUrl(photoUrl) {
  if (!photoUrl) return null
  if (/^https?:\/\//i.test(photoUrl)) return photoUrl
  return supabase.storage.from('staff-photos').getPublicUrl(photoUrl).data.publicUrl
}

// Circular staff photo, falling back to initials-on-a-grey-circle when
// photo_url is null/empty.
export function Avatar({ name, photoUrl, size = 36 }) {
  const resolvedUrl = resolveStaffPhotoUrl(photoUrl)
  if (resolvedUrl) {
    return <img src={resolvedUrl} alt="" style={{ width: `${size}px`, height: `${size}px`, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  }
  const initials = (name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div style={{
      width: `${size}px`, height: `${size}px`, borderRadius: '50%', background: COLORS.slate200, color: COLORS.slate500,
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

export function priorityTierLabel(score, p1Threshold = GLOBAL_TRIAGE_THRESHOLD, p2Threshold = P2_URGENT_THRESHOLD) {
  if (score >= p1Threshold) return 'P1 Critical'
  if (score >= p2Threshold) return 'P2 Urgent'
  return 'P3 Routine'
}

// Mirrors fetchComplianceAgingCounts/fetchStuckTicketsCount's own
// settings-fetch convention -- callers that don't yet fetch these
// should keep calling priorityTierLabel()/isTicketStuck() with no
// threshold args, which fall back to the GLOBAL_TRIAGE_THRESHOLD/
// P2_URGENT_THRESHOLD constants above unchanged.
export async function fetchPriorityThresholds() {
  const { data } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['priority_threshold_p1', 'priority_threshold_p2'])

  const map = {}
  ;(data || []).forEach(r => { map[r.setting_key] = r.setting_value })

  return {
    p1: map.priority_threshold_p1 != null ? Number(map.priority_threshold_p1) : GLOBAL_TRIAGE_THRESHOLD,
    p2: map.priority_threshold_p2 != null ? Number(map.priority_threshold_p2) : P2_URGENT_THRESHOLD,
  }
}

export function priorityBadgeStyle(tier) {
  if (tier === 'P1 Critical') return { bg: COLORS.red100, color: COLORS.red600 }
  if (tier === 'P2 Urgent') return { bg: COLORS.amber100, color: COLORS.amber600 }
  return { bg: COLORS.slate100, color: COLORS.slate500 }
}

export const statusColour = (status) => {
  if (status === 'Pending')     return COLORS.red600
  if (status === 'Assigned')    return COLORS.blue500
  if (status === 'In Progress') return COLORS.teal600
  if (status === 'On Hold')     return COLORS.amber600
  if (status === 'Completed')   return COLORS.purple600
  if (status === 'Archived')    return COLORS.slate500
  if (status === 'Cancelled')   return COLORS.slate400
  return COLORS.blue500
}

// Display-only -- the stored value stays 'Pending' everywhere (every
// comparison, RLS policy, and filter already keys off that literal
// string), this just changes what a human sees. "Unassigned" is a
// clearer description of what that status actually means than the
// original "Pending" label.
export function statusLabel(status) {
  return status === 'Pending' ? 'Unassigned' : status
}

// The 4 statuses a ticket can be "stuck" in -- Completed/Archived/Cancelled
// are terminal and never count, matching OPEN_TICKET_STATUS_EXCLUSION.
export const STUCK_ELIGIBLE_STATUSES = ['Pending', 'Assigned', 'In Progress', 'On Hold']

export function thresholdToMs({ value, unit } = {}) {
  return (Number(value) || 0) * (unit === 'days' ? 86400000 : 3600000)
}

export function getStuckThresholdMs(status, tier, thresholdsSetting) {
  const cell = thresholdsSetting?.[status]?.[tier]
  return cell ? thresholdToMs(cell) : null
}

// Pure and render-safe -- used identically by the Pipeline highlight/filter
// and the dashboard KPI tile, so they always agree on what counts as stuck.
export function isTicketStuck(ticket, thresholdsSetting, nowMs = Date.now(), p1Threshold = GLOBAL_TRIAGE_THRESHOLD, p2Threshold = P2_URGENT_THRESHOLD) {
  if (!thresholdsSetting || !STUCK_ELIGIBLE_STATUSES.includes(ticket.status)) return false
  const tier = ticket.priority_override || priorityTierLabel(ticket.priority_score, p1Threshold, p2Threshold)
  const thresholdMs = getStuckThresholdMs(ticket.status, tier, thresholdsSetting)
  if (thresholdMs == null) return false
  const changedAt = ticket.status_changed_at || ticket.created_at
  return (nowMs - new Date(changedAt).getTime()) >= thresholdMs
}

// Shared by the dashboard's "Ticket Pipeline"/"Compliance" tiles and the
// Pipeline/Compliance pages' own metrics strips, so they all stay pixel-
// identical. Flexbox (not a fixed-column grid) so it actually reflows on
// narrow screens the same way the rest of this dashboard's tile rows
// already do -- a fixed column count doesn't reflow, which squeezed these
// tiles or forced horizontal overflow on small devices. This also fills an
// uneven last row for free (each tile's flex-grow shares the leftover
// space) instead of needing a manual "span the gap" calculation.
// `kpis` items: { label, value, colour, ...whatever onTileClick needs }.
// `columns`, when passed, switches from the default flex-wrap (which packs
// as many tiles as fit per row, leaving an unbalanced lone tile on the last
// row -- exactly the "8 then 1" problem the Pipeline section hit with 9
// KPI tiles) to a fixed-column CSS grid instead, so a 9-tile set reliably
// lays out as 5-then-4 rather than however many happen to fit. Omitted
// (every other KpiTiles call site), behaviour is unchanged.
// Module-level, not per-component-instance -- a dashboard page can render
// several KpiTiles at once (Ticket Pipeline, Sign-Off & Mileage, etc.),
// and there's no reason each should run its own fetch/subscribe cycle for
// a value that's identical across all of them. First instance to mount
// kicks off the fetch; every other instance mounting while it's in
// flight awaits the same promise instead of firing a duplicate query.
let cachedKpiTilePaddingPx = null
let kpiTilePaddingFetchPromise = null
function fetchKpiTilePaddingPx() {
  if (cachedKpiTilePaddingPx != null) return Promise.resolve(cachedKpiTilePaddingPx)
  if (!kpiTilePaddingFetchPromise) {
    kpiTilePaddingFetchPromise = supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'kpi_tile_padding_px').maybeSingle()
      .then(({ data }) => {
        cachedKpiTilePaddingPx = Number(data?.setting_value) || 9
        return cachedKpiTilePaddingPx
      })
  }
  return kpiTilePaddingFetchPromise
}

export function KpiTiles({ kpis, onTileClick, columns }) {
  // Starts at the same default the Settings page ships with (9) so there's
  // no visible flash/resize once the real fetched value (usually also 9,
  // until someone actually changes it) lands a moment later.
  const [tilePaddingPx, setTilePaddingPx] = useState(cachedKpiTilePaddingPx ?? 9)
  useEffect(() => {
    let cancelled = false
    fetchKpiTilePaddingPx().then(px => { if (!cancelled) setTilePaddingPx(px) })
    return () => { cancelled = true }
  }, [])

  // `columns` used to mean a literal fixed column count
  // (`repeat(N, 1fr)`) -- rigid on a narrow screen, since N equal-width
  // columns don't reflow, they just get squeezed until every label wraps
  // onto three lines. auto-fit + minmax keeps the same "grid, not
  // flex-wrap" layout callers asked for (a tidy row-aligned block, unlike
  // the flex mode's own looser wrap) while letting the column count drop
  // on its own as the container narrows.
  //
  // The minmax max is 1fr again -- a fixed px cap left dead empty space
  // on the right of the row on a wide screen once the tile count's own
  // natural width didn't reach the container's full width (found live).
  // Tiles filling the row was never the problem; the excess height/
  // padding was -- that's handled below via tighter padding and explicit
  // line-height, independent of how wide each column stretches.
  return (
    <div style={columns
      ? { display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(clamp(90px, 10vw, 120px), 1fr))`, gap: '10px', marginBottom: '16px' }
      : { display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }
    }>
      {kpis.map((kpi) => (
        <button
          key={kpi.label}
          onClick={() => onTileClick?.(kpi)}
          style={{ ...(columns ? {} : { flex: '1 1 clamp(90px, 10vw, 130px)' }), background: kpi.colour, borderRadius: '14px', padding: `clamp(5px, 0.8vw, ${tilePaddingPx}px) clamp(8px, 1.2vw, 12px)`, border: 'none', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', textAlign: 'center' }}
        >
          {/* minHeight reserves room for a 2-line label at this font's tallest
              (clamp maxes at 10px * 1.1 line-height * 2 lines = 22px) --
              without it, a KpiTiles block whose labels happen to fit on one
              line (most of AdminDashboard's) renders visibly shorter than one
              with longer labels that wrap (Submitter Pipeline's own
              deliberately spelled-out wording, e.g. "Needs Your
              Confirmation") even though every tile uses this same component.
              Found live: submitter's tiles read as a different, smaller
              style entirely next to the admin/manager dashboard's. */}
          <p style={{ margin: '0 0 2px 0', fontSize: 'clamp(9px, 0.8vw, 10px)', lineHeight: 1.1, minHeight: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{kpi.label}</p>
          <p style={{ margin: 0, fontSize: 'clamp(18px, 2vw, 22px)', lineHeight: 1.1, fontWeight: 800, color: COLORS.white }}>{kpi.value}</p>
        </button>
      ))}
    </div>
  )
}

// Moved out of PropertyComplianceTab.jsx (where these used to be private to
// that one file) so the portfolio-wide Compliance page and dashboard tile
// can compute the exact same status a property's own tab already shows --
// same "single source of truth" precedent as isTicketStuck.
export const COMPLIANCE_TYPES = [
  { key: 'gas_safety', title: 'Gas Safety (CP12)' },
  { key: 'electrical_safety', title: 'Electrical Safety (EICR)' },
  { key: 'pat_testing', title: 'PAT Testing' },
  { key: 'fire_risk_assessment', title: 'Fire Risk Assessment' },
  { key: 'fire_alarm_test_log', title: 'Fire Alarm Test Log' },
  { key: 'fire_extinguisher_check', title: 'Fire Extinguisher Check', dateLabel: 'Next Due Date' },
  { key: 'fire_extinguisher_service', title: 'Fire Extinguisher Service' },
  { key: 'legionella_risk_assessment', title: 'Legionella Risk Assessment' },
  { key: 'asbestos_management', title: 'Asbestos Management' },
  { key: 'lift_safety', title: 'Lift Safety' },
  { key: 'health_safety_inspection', title: 'Health & Safety Inspection' },
]

export const RAG_STYLES = {
  green: { bg: COLORS.green100, color: COLORS.green600 },
  amber: { bg: COLORS.amber100, color: COLORS.amber600 },
  red: { bg: COLORS.red100, color: COLORS.red600 },
  grey: { bg: COLORS.slate100, color: COLORS.slate500 },
}

export function RagPill({ tier, label }) {
  const style = RAG_STYLES[tier]
  return (
    <span style={{ fontSize: '11px', fontWeight: 800, color: style.color, background: style.bg, padding: '4px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
      {label}
    </span>
  )
}

// Pure and render-safe -- used identically by the per-property Compliance
// tab, the portfolio-wide Compliance page, and the dashboard KPI tiles.
// thresholdDays defaults to 90 to match this app's behaviour before the
// value became admin-configurable.
export function computeComplianceAging(record, thresholdDays = 90) {
  if (!record) return { tier: 'red', label: 'No Record', daysLeft: null }
  if (record.not_applicable) return { tier: 'grey', label: 'N/A', daysLeft: null }
  if (!record.expiry_date) return { tier: 'red', label: 'No Record', daysLeft: null }

  const expiry = new Date(record.expiry_date)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysLeft = Math.floor((expiry - today) / 86400000)

  if (daysLeft < 0) return { tier: 'red', label: 'Expired', daysLeft }
  if (daysLeft <= thresholdDays) return { tier: 'amber', label: `Due in ${daysLeft}d`, daysLeft }
  return { tier: 'green', label: 'Valid', daysLeft }
}

// Shared by the dashboard's "Compliance" tiles and the portfolio Compliance
// page's own KPI strip, so both always agree exactly -- same cross-check
// precedent as fetchStuckTicketsCount().
export async function fetchComplianceAgingCounts() {
  const { data: properties } = await supabase.schema('pmms').from('properties').select('id')
  const { data: records } = await supabase.schema('pmms').from('property_compliance').select('*')
  const { data: thresholdRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'compliance_aging_threshold_days')
    .maybeSingle()
  const thresholdDays = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 90

  const recordsByKey = {}
  ;(records || []).forEach(r => { recordsByKey[`${r.property_id}:${r.cert_type}`] = r })

  const counts = { expired: 0, dueSoon: 0, noRecord: 0, valid: 0 }
  ;(properties || []).forEach(p => {
    COMPLIANCE_TYPES.forEach(type => {
      const record = recordsByKey[`${p.id}:${type.key}`]
      const aging = computeComplianceAging(record, thresholdDays)
      if (aging.tier === 'grey') return
      if (aging.label === 'No Record') counts.noRecord += 1
      else if (aging.label === 'Expired') counts.expired += 1
      else if (aging.tier === 'amber') counts.dueSoon += 1
      else counts.valid += 1
    })
  })
  return counts
}

// Mirrors computeComplianceAging's role: single source of truth reused by
// the per-property Rooms tab, the portfolio-wide Voids page, and the
// dashboard KPI tile. thresholdDays defaults to 45 to match the seeded
// void_aging_threshold_days setting. "amber" (Aging) kicks in at 50% of
// the threshold as a visual lead-in to the red/Overdue line -- there's no
// separate stored admin knob for it, same as GLOBAL_TRIAGE_THRESHOLD/
// P2_URGENT_THRESHOLD being a hardcoded ratio elsewhere in this file.
export function computeVoidAging(room, thresholdDays = 45) {
  if (!room || room.current_status !== 'Void') return null
  if (!room.void_since) return { tier: 'grey', label: 'Unknown', daysSince: null }

  const voidSince = new Date(room.void_since)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const daysSince = Math.floor((today - voidSince) / 86400000)

  if (daysSince >= thresholdDays) return { tier: 'red', label: 'Overdue', daysSince }
  if (daysSince >= thresholdDays * 0.5) return { tier: 'amber', label: 'Aging', daysSince }
  return { tier: 'green', label: 'Recent', daysSince }
}

// Shared by the dashboard's Void Aging tiles and the Voids page's own KPI
// strip, so both always agree exactly -- same cross-check precedent as
// fetchComplianceAgingCounts/fetchStuckTicketsCount.
export async function fetchVoidAgingCounts() {
  const { data: rooms } = await supabase
    .schema('pmms')
    .from('property_rooms')
    .select('current_status, void_since')
    .eq('current_status', 'Void')
  const { data: thresholdRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'void_aging_threshold_days')
    .maybeSingle()
  const thresholdDays = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 45

  const counts = { overdue: 0, aging: 0, recent: 0 }
  ;(rooms || []).forEach(r => {
    const aging = computeVoidAging(r, thresholdDays)
    if (!aging || aging.tier === 'grey') return
    if (aging.tier === 'red') counts.overdue += 1
    else if (aging.tier === 'amber') counts.aging += 1
    else counts.recent += 1
  })
  return counts
}

// Portfolio-wide "how is Housekeeping doing" counts, for the dashboard's
// Housekeeping KPI tiles -- same shape as fetchVoidAgingCounts/
// fetchGardenReviewAging. Reuses fetchRoutineVisitAging below (already
// AdminHousekeeping.jsx's own source of truth for per-property visit
// aging) rather than recomputing that logic a second time, and adds a
// pending-delay-reasons count on top, since that's the other thing
// AdminHousekeeping.jsx surfaces as needing manager attention.
export async function fetchHousekeepingCounts() {
  const visits = await fetchRoutineVisitAging()
  const counts = { overdue: 0, dueSoon: 0, ok: 0 }
  visits.forEach(v => {
    if (v.tier === 'red') counts.overdue += 1
    else if (v.tier === 'amber') counts.dueSoon += 1
    else if (v.tier === 'green') counts.ok += 1
  })

  const { data: pendingDelays } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id')
    .eq('delay_reason_status', 'pending')

  return { ...counts, pendingDelays: pendingDelays?.length || 0 }
}

// Per-property "when is this cleaner's next routine visit due" view, for
// the Housekeeping manager screen (walkthrough: "which properties are
// coming up for their two-week visit, and which are overdue"). Mirrors
// check-routine-visits-due's own baseline logic exactly (last completed
// Routine Visit ticket, or cleaner_assigned_since) so the two always
// agree on what's overdue -- same cross-check precedent as
// fetchVoidAgingCounts/computeVoidAging.
export async function fetchRoutineVisitAging() {
  const { data: properties } = await supabase
    .schema('pmms')
    .from('properties')
    .select('id, address, assigned_cleaner_id, cleaner_assigned_since')
    .not('assigned_cleaner_id', 'is', null)

  if (!properties?.length) return []

  const { data: visitTickets } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('property_id, status, completed_at')
    .eq('category', 'Cleaning Rota')
    .eq('issue_tag', 'Routine 2-Week Visit')

  const { data: thresholdRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'routine_visit_flag_days')
    .maybeSingle()
  const flagDays = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 12

  const cleanerIds = [...new Set(properties.map(p => p.assigned_cleaner_id))]
  const { data: cleaners } = await supabase.from('staff').select('id, name').in('id', cleanerIds)
  const cleanerNameById = {}
  ;(cleaners || []).forEach(c => { cleanerNameById[c.id] = c.name })

  const nowMs = Date.now()
  return properties.map(property => {
    const ticketsForProperty = (visitTickets || []).filter(t => t.property_id === property.id)
    const lastCompleted = ticketsForProperty
      .filter(t => t.completed_at)
      .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())[0]
    const baseline = lastCompleted?.completed_at || property.cleaner_assigned_since
    const daysSince = baseline ? Math.floor((nowMs - new Date(baseline).getTime()) / 86400000) : null

    let tier = 'green'
    let label = 'OK'
    if (daysSince == null) { tier = 'grey'; label = 'Unknown' }
    else if (daysSince >= flagDays) { tier = 'red'; label = 'Overdue' }
    else if (daysSince >= flagDays * 0.5) { tier = 'amber'; label = 'Due Soon' }

    return {
      propertyId: property.id,
      address: property.address,
      cleanerId: property.assigned_cleaner_id,
      cleanerName: cleanerNameById[property.assigned_cleaner_id] || 'Unknown',
      daysSince,
      tier,
      label,
    }
  }).sort((a, b) => (b.daysSince ?? -1) - (a.daysSince ?? -1))
}

// UK growing-season convention shared with check-garden-service-due --
// Mar-Oct counts as summer (shorter interval), Nov-Feb as winter (longer).
// Uses the viewer's own local month, not Europe/London -- unlike the
// UK_DATE_FORMATTER helpers below, a month-granularity boundary doesn't
// need timezone precision the way a specific timestamp does.
function isUkSummerMonth(date) {
  const month = date.getMonth() + 1
  return month >= 3 && month <= 10
}

// Portfolio-wide "which gardens need review" counts, for the dashboard's
// Gardens section -- same shape and same 0.5x-threshold "aging" bucket
// convention as fetchVoidAgingCounts(), so a manager reads both the same
// way. A garden that's never been attended to (garden_last_attended_date
// is null) counts as overdue outright, same as a missing baseline
// anywhere else in this file.
export async function fetchGardenReviewAging() {
  const { data: properties } = await supabase
    .schema('pmms')
    .from('properties')
    .select('id, garden_last_attended_date, garden_state')
    .eq('has_garden', true)

  const { data: settingsRows } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['garden_service_days_summer', 'garden_service_days_winter'])
  const settingsMap = Object.fromEntries((settingsRows || []).map(r => [r.setting_key, r.setting_value]))
  const summerDays = settingsMap.garden_service_days_summer != null ? Number(settingsMap.garden_service_days_summer) : 90
  const winterDays = settingsMap.garden_service_days_winter != null ? Number(settingsMap.garden_service_days_winter) : 180
  const thresholdDays = isUkSummerMonth(new Date()) ? summerDays : winterDays

  const nowMs = Date.now()
  // overdue/aging/recent are review-cadence tiers (when it was last
  // attended, regardless of condition); needsAttention/overgrown are the
  // separate garden_state a manager sets by hand on the Gardens tab
  // (current condition, regardless of when it was last visited) -- a
  // garden can be recently-attended but still assessed Overgrown, or
  // overdue but still Good, so these two axes are deliberately counted
  // independently rather than folded into one tier.
  const counts = { overdue: 0, aging: 0, recent: 0, needsAttention: 0, overgrown: 0 }
  ;(properties || []).forEach(p => {
    if (!p.garden_last_attended_date) counts.overdue += 1
    else {
      const daysSince = Math.floor((nowMs - new Date(p.garden_last_attended_date).getTime()) / 86400000)
      if (daysSince >= thresholdDays) counts.overdue += 1
      else if (daysSince >= thresholdDays * 0.5) counts.aging += 1
      else counts.recent += 1
    }
    if (p.garden_state === 'Needs Attention') counts.needsAttention += 1
    else if (p.garden_state === 'Overgrown') counts.overgrown += 1
  })
  return counts
}

// Intl.DateTimeFormat pinned to Europe/London, NOT Date.prototype's
// getDate()/getHours() etc, which this used to use -- those read the
// VIEWING DEVICE's local clock/timezone, not genuine UK time, despite the
// function's name. Everyone in this company is UK-based, but whoever's
// looking at the page isn't guaranteed to be on a device set to UK time
// (found live: a Clocking page timestamp that didn't match its own
// database row at all). Intl also gets BST/GMT right automatically across
// the year, which a hardcoded "+1 hour" patch wouldn't.
const UK_DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric' })
const UK_TIME_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false })

export const formatUKDate = (isoString) => {
  if (!isoString) return ''
  return UK_DATE_FORMATTER.format(new Date(isoString))
}

export const formatUKDateTime = (isoString) => {
  if (!isoString) return ''
  const d = new Date(isoString)
  return `${UK_DATE_FORMATTER.format(d)} ${UK_TIME_FORMATTER.format(d)}`
}

const UK_DATETIME_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
})

function ukPartsOf(ms) {
  const parts = {}
  UK_DATETIME_PARTS_FORMATTER.formatToParts(new Date(ms)).forEach(p => { parts[p.type] = p.value })
  return parts
}

// Populates a `<input type="datetime-local">` (AdminClocking.jsx's
// "Correct Clock Times" modal) with genuine UK wall-clock time, paired
// with ukDateTimeInputValueToMs below for the reverse direction --
// together these replace a plain toLocalInputValue()/`new Date(str)`
// round-trip, which used the browser's own timezone on both ends. That
// was internally consistent (so editing without changing anything was
// harmless) right up until formatUKDateTime became genuinely UK-pinned --
// after that, the modal would pre-fill a DIFFERENT number than the
// read-only table shows for the exact same timestamp, and an admin
// "correcting" a time based on that mismatch would silently save the
// wrong UTC instant.
export function toUkDateTimeInputValue(ms) {
  const p = ukPartsOf(ms)
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}

// Reverse of the above -- interprets a "YYYY-MM-DDTHH:mm" string as UK
// wall-clock time (BST or GMT, whichever applies on that date) and
// returns the matching UTC instant in milliseconds. Standard
// guess-and-correct technique for timezone conversion without a date
// library: treat the typed numbers as if they were already UTC (a
// guess), see what UK wall-clock time that guess actually displays as,
// then shift the guess by the difference.
export function ukDateTimeInputValueToMs(value) {
  const guessMs = Date.parse(`${value}:00Z`)
  if (isNaN(guessMs)) return NaN
  const shown = ukPartsOf(guessMs)
  const shownAsUtcMs = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute))
  return guessMs - (shownAsUtcMs - guessMs)
}

// "Which UK calendar day is this" (for daily_attendance.work_date and
// grouping builder activity by day) -- same ukPartsOf() UK-pinned reading
// as everything else here, not the device's own local date.
export function ukDateKey(ms = Date.now()) {
  const p = ukPartsOf(ms)
  return `${p.year}-${p.month}-${p.day}`
}

// "HH:mm" in UK wall-clock time -- used to compare a clock-in against an
// HH:mm settings threshold (e.g. daily_clock_in_deadline) without pulling
// in a date library just to compare two times of day.
export function ukTimeHHMM(ms = Date.now()) {
  const p = ukPartsOf(ms)
  return `${p.hour}:${p.minute}`
}

// How many minutes after an "HH:mm" deadline a UK timestamp falls --
// used to show "12m late" rather than just a bare late flag. Negative/
// zero when on time; callers only display this when they already know
// the shift was late (daily_attendance.late_flag), so a caller never
// needs to handle "how early" as a separate case.
export function minutesLate(isoString, deadlineHHMM) {
  const p = ukPartsOf(new Date(isoString).getTime())
  const clockInMinutes = Number(p.hour) * 60 + Number(p.minute)
  const [dh, dm] = deadlineHHMM.split(':').map(Number)
  return clockInMinutes - (dh * 60 + dm)
}

// Plain calendar-date arithmetic on the "YYYY-MM-DD" string itself (via
// Date.UTC), not a local Date object -- a ukDateKey() string is already a
// UK calendar date, so shifting it a day either way should never risk
// drifting onto the wrong day depending on the browser's own timezone.
export function shiftDateKey(dateKey, days) {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

// Monday (week start) of the week containing a given date-key -- getUTCDay()
// returns 0 for Sunday, so it needs its own case rather than a plain mod 7
// to land on the Monday before it, not the Monday after.
export function mondayOfWeek(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number)
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return shiftDateKey(dateKey, day === 0 ? -6 : 1 - day)
}

// First of the calendar month containing a given date-key.
export function firstOfMonth(dateKey) {
  return `${dateKey.slice(0, 7)}-01`
}

// Aggregates pmms.daily_attendance for one staff member over an inclusive
// UK-calendar-date range into per-day rows plus summary counts -- shared
// by BuilderProfilePage.jsx (a manager looking at someone else's record)
// and BuilderDashboard.jsx's My Metrics page (a builder looking at their
// own, read-only), so both are guaranteed to ever agree on the same
// numbers rather than each computing it slightly differently.
// "Overtime" is a single per-day hours threshold (daily_overtime_threshold_hours,
// default 8) rather than a weekly total or "past the clock-out deadline" --
// see the design discussion this came out of.
export async function fetchAttendanceSummary(staffId, fromDateKey, toDateKey) {
  const { data: rows } = await supabase
    .schema('pmms')
    .from('daily_attendance')
    .select('id, work_date, clock_in_at, clock_out_at, late_flag, early_leave_reason, clock_in_override, clock_out_override, missed_clock_out')
    .eq('staff_id', staffId)
    .gte('work_date', fromDateKey)
    .lte('work_date', toDateKey)
    .order('work_date', { ascending: false })

  const { data: thresholdRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'daily_overtime_threshold_hours')
    .maybeSingle()
  const overtimeThresholdMs = (thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 8) * 3600000

  let totalMs = 0
  let lateCount = 0
  let earlyLeaveCount = 0
  let overtimeCount = 0
  let incompleteCount = 0
  let missedClockOutCount = 0
  const daySet = new Set()
  const todayKey = ukDateKey()

  const days = (rows || []).map(r => {
    // Still clocked in today isn't "0 hours worked" -- it's hours worked
    // so far, ticking up until they clock out. A still-open row from a
    // PAST day is different (see `incomplete` below): that's not live,
    // it's a gap, so it stays uncounted rather than crediting hours nobody
    // confirmed were actually worked.
    const isLive = !r.clock_out_at && r.work_date === todayKey
    const durationMs = r.clock_out_at ? (new Date(r.clock_out_at) - new Date(r.clock_in_at))
      : isLive ? (Date.now() - new Date(r.clock_in_at))
      : null
    const overtime = durationMs != null && durationMs > overtimeThresholdMs
    // A still-open row for TODAY just means they haven't clocked out yet --
    // normal, not an anomaly. Only a still-open row from a PAST day is a
    // genuinely forgotten clock-out worth flagging (see the Paulo Da Silva
    // case this distinction came from).
    const incomplete = !r.clock_out_at && r.work_date !== todayKey
    // Permanent record that a clock-out was missed, independent of
    // "incomplete" above -- stays true even after a manager's correction
    // closes it out, since fixing the record isn't the same as it never
    // having happened. Still-open past days count here too, even before
    // anyone's corrected them yet.
    const wasMissed = r.missed_clock_out || incomplete
    if (durationMs != null) totalMs += durationMs
    if (incomplete) incompleteCount += 1
    if (wasMissed) missedClockOutCount += 1
    if (r.late_flag) lateCount += 1
    if (r.early_leave_reason) earlyLeaveCount += 1
    if (overtime) overtimeCount += 1
    daySet.add(r.work_date)
    return { ...r, durationMs, overtime, incomplete, wasMissed, isLive }
  })

  return { days, totalMs, daysWorked: daySet.size, lateCount, earlyLeaveCount, overtimeCount, incompleteCount, missedClockOutCount }
}

// Trip-level mileage for one staff member over an inclusive UK-calendar-date
// range -- mirrors fetchAttendanceSummary's shape/purpose. Two sources, same
// as AdminClocking.jsx's Travel & Visits rollup already combines: job travel
// via tickets.mileage_logged_at (set at clock-in, see
// scripts/add_ticket_mileage_logged_at.sql), and property/office visit
// travel via activity_log.mileage_logged (set on arrival -- see the
// 'visit'/'visit_office'/'visit_other' categories, Kathryn's Log a Visit).
// Found live 2026-08-24: this only ever queried tickets, so anyone whose
// mileage comes entirely from visits (Landlord Liaison has no tickets
// assigned to her at all) always read 0 here despite Travel & Visits
// showing their real total. Bounds are converted through
// ukDateTimeInputValueToMs so "the whole of August" means UK
// midnight-to-midnight, not the viewer's own timezone.
export async function fetchMileageSummary(staffId, fromDateKey, toDateKey) {
  const fromMs = ukDateTimeInputValueToMs(`${fromDateKey}T00:00`)
  const toExclusiveMs = ukDateTimeInputValueToMs(`${shiftDateKey(toDateKey, 1)}T00:00`)
  const fromIso = new Date(fromMs).toISOString()
  const toExclusiveIso = new Date(toExclusiveMs).toISOString()

  const { data: ticketRows } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, ticket_number, property_id, mileage_logged, mileage_logged_at, transit_start')
    .eq('assigned_builder_id', staffId)
    .gt('mileage_logged', 0)
    .gte('mileage_logged_at', fromIso)
    .lt('mileage_logged_at', toExclusiveIso)

  const { data: activityRows } = await supabase
    .schema('pmms')
    .from('activity_log')
    .select('id, activity_category, note, arrived_at, destination_property_id, mileage_logged')
    .eq('staff_id', staffId)
    .in('activity_category', ['visit', 'visit_office', 'visit_other'])
    .gt('mileage_logged', 0)
    .gte('arrived_at', fromIso)
    .lt('arrived_at', toExclusiveIso)

  const withTicketProperties = await attachProperties(ticketRows || [], 'address')
  const withActivityProperties = await attachProperties(
    (activityRows || []).map(a => ({ ...a, property_id: a.destination_property_id })),
    'address'
  )

  let totalMiles = 0
  const dateSet = new Set()

  const ticketTrips = withTicketProperties.map(t => {
    const dateKey = ukDateKey(new Date(t.mileage_logged_at).getTime())
    totalMiles += Number(t.mileage_logged) || 0
    dateSet.add(dateKey)
    return { ...t, dateKey, kind: 'ticket', loggedAt: t.mileage_logged_at }
  })

  const activityTrips = withActivityProperties.map(a => {
    const dateKey = ukDateKey(new Date(a.arrived_at).getTime())
    totalMiles += Number(a.mileage_logged) || 0
    dateSet.add(dateKey)
    return { ...a, dateKey, kind: 'activity', loggedAt: a.arrived_at }
  })

  const trips = [...ticketTrips, ...activityTrips].sort((a, b) => new Date(b.loggedAt) - new Date(a.loggedAt))

  return { trips, totalMiles, tripCount: trips.length, daysWithTravel: dateSet.size, avgMilesPerTrip: trips.length ? totalMiles / trips.length : 0 }
}

// Time-away breakdown for one staff member over an inclusive UK-calendar-
// date range -- mirrors fetchAttendanceSummary/fetchMileageSummary's
// shape, but keyed off activity_log.started_at and split per
// activity_category (lunch/materials/job/office) so "how long on lunch
// this week" is an actual number instead of just two clock-face
// timestamps someone has to subtract by hand. Only completed entries
// (ended_at set) count towards the totals -- a still-open activity is
// already visible live on Where's the Team, this is a historical rollup.
export async function fetchActivitySummary(staffId, fromDateKey, toDateKey) {
  const fromMs = ukDateTimeInputValueToMs(`${fromDateKey}T00:00`)
  const toExclusiveMs = ukDateTimeInputValueToMs(`${shiftDateKey(toDateKey, 1)}T00:00`)

  const { data: rows } = await supabase
    .schema('pmms')
    .from('activity_log')
    .select('id, activity_type, activity_category, note, started_at, ended_at')
    .eq('staff_id', staffId)
    .gte('started_at', new Date(fromMs).toISOString())
    .lt('started_at', new Date(toExclusiveMs).toISOString())
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })

  const totalsByCategory = { lunch: 0, materials: 0, job: 0, office: 0 }
  let totalMs = 0
  const dateSet = new Set()

  const entries = (rows || []).map(r => {
    const durationMs = new Date(r.ended_at) - new Date(r.started_at)
    // Legacy rows predate activity_category -- fall back to the old
    // Travel/Break split so pre-2026-08-15 history still counts somewhere
    // rather than vanishing from the totals entirely.
    const category = r.activity_category || (r.activity_type === 'Break' ? 'lunch' : 'job')
    totalsByCategory[category] = (totalsByCategory[category] || 0) + durationMs
    totalMs += durationMs
    dateSet.add(ukDateKey(new Date(r.started_at).getTime()))
    return { ...r, category, durationMs }
  })

  return { entries, totalsByCategory, totalMs, daysWithActivity: dateSet.size, count: entries.length }
}

// Chronological, located stops for one staff member on one UK calendar day
// -- clock-in, every job visited (work_sessions), every activity_log leg
// (materials/office/lunch/heading to another job), clock-out. Powers
// BuilderProfilePage.jsx's Movement Trail map. Reuses the exact lat/lng
// columns [[project_staff_locations_map]]'s last-known-pin map already
// established (work_sessions/activity_log/daily_attendance), just replayed
// across a whole day instead of read live -- no new location capture
// needed. A stop with no coordinates recorded (GPS unavailable at the
// time, or a pre-GPS-capture historical row) is silently dropped rather
// than plotted at a wrong/default point.
export async function fetchMovementTrail(staffId, dateKey) {
  const fromIso = new Date(ukDateTimeInputValueToMs(`${dateKey}T00:00`)).toISOString()
  const toExclusiveIso = new Date(ukDateTimeInputValueToMs(`${shiftDateKey(dateKey, 1)}T00:00`)).toISOString()

  const [{ data: attendanceRow }, { data: sessions }, { data: activity }] = await Promise.all([
    supabase.schema('pmms').from('daily_attendance')
      .select('clock_in_at, clock_in_lat, clock_in_lng, clock_out_at, clock_out_lat, clock_out_lng')
      .eq('staff_id', staffId).eq('work_date', dateKey).maybeSingle(),
    supabase.schema('pmms').from('work_sessions')
      .select('id, ticket_id, started_at, ended_at, clock_in_lat, clock_in_lng')
      .eq('builder_id', staffId)
      .gte('started_at', fromIso).lt('started_at', toExclusiveIso),
    supabase.schema('pmms').from('activity_log')
      .select('id, activity_type, activity_category, note, started_at, started_lat, started_lng, ended_at, ended_lat, ended_lng, arrived_at, destination_ticket_id, destination_property_id')
      .eq('staff_id', staffId)
      .gte('started_at', fromIso).lt('started_at', toExclusiveIso),
  ])

  const ticketIds = new Set()
  ;(sessions || []).forEach(s => { if (s.ticket_id) ticketIds.add(s.ticket_id) })
  ;(activity || []).forEach(a => { if (a.destination_ticket_id) ticketIds.add(a.destination_ticket_id) })

  let ticketsById = {}
  if (ticketIds.size > 0) {
    const { data: ticketRows } = await supabase.schema('pmms').from('tickets')
      .select('id, ticket_number, description, property_id')
      .in('id', [...ticketIds])
    const withProps = await attachProperties(ticketRows || [], 'address, latitude, longitude')
    withProps.forEach(t => { ticketsById[t.id] = t })
  }

  const propertyIds = new Set()
  ;(activity || []).forEach(a => { if (a.destination_property_id) propertyIds.add(a.destination_property_id) })
  let propertiesById = {}
  if (propertyIds.size > 0) {
    const { data: propRows } = await supabase.schema('pmms').from('properties').select('id, address, latitude, longitude').in('id', [...propertyIds])
    ;(propRows || []).forEach(p => { propertiesById[p.id] = p })
  }

  // 'visit_office' legs (Log a Visit -> "the office") never set
  // destination_property_id at all -- there's no property picker for that
  // destination, it's just a fixed button -- so the destProperty/destTicket
  // fallback below still leaves them coordinate-less. Same physical place
  // every time though, and it already exists as a real property row
  // (status 'Internal', see property_internal_status_property_exclusion),
  // so resolve it once and reuse it the same way as any other destination
  // property fallback.
  let officeProperty = null
  if ((activity || []).some(a => a.activity_category === 'visit_office')) {
    const { data: officeRows } = await supabase.schema('pmms').from('properties')
      .select('id, address, latitude, longitude').eq('status', 'Internal').limit(1)
    officeProperty = officeRows?.[0] || null
  }

  const stops = []

  // No subtitle claiming "GBCH Office" here -- clock-in/out is GPS-tagged
  // from wherever the button was actually tapped, not guaranteed to be the
  // office (found live: Paulo Da Silva clocked out from his second job's
  // site on 2026-08-26, not back at base). The pin's map position already
  // shows exactly where they were; asserting a place name risks being
  // wrong rather than just being less specific.
  if (attendanceRow?.clock_in_at && attendanceRow.clock_in_lat != null && attendanceRow.clock_in_lng != null) {
    stops.push({ id: 'clockin', at: attendanceRow.clock_in_at, lat: attendanceRow.clock_in_lat, lng: attendanceRow.clock_in_lng, title: 'Clocked in', subtitle: '', kind: 'clockin' })
  }

  ;(sessions || []).forEach(s => {
    if (s.clock_in_lat == null || s.clock_in_lng == null) return
    const t = s.ticket_id ? ticketsById[s.ticket_id] : null
    stops.push({
      id: `job-${s.id}`,
      at: s.started_at,
      endAt: s.ended_at,
      lat: s.clock_in_lat, lng: s.clock_in_lng,
      title: t ? `Job #${t.ticket_number}${t.description ? ` — ${t.description}` : ''}` : 'Job',
      subtitle: t?.property?.address || '',
      kind: 'job',
    })
  })

  ;(activity || []).forEach(a => {
    let lat = a.ended_lat ?? a.started_lat
    let lng = a.ended_lng ?? a.started_lng
    const destTicket = a.destination_ticket_id ? ticketsById[a.destination_ticket_id] : null
    const destProperty = a.destination_property_id ? propertiesById[a.destination_property_id] : null
    if (lat == null || lng == null) {
      // Kathryn's Log a Visit flow doesn't capture a GPS fix on either end
      // of the trip at all (found live: both started_lat/lng and
      // ended_lat/lng null on every 'visit' row) -- but the destination is
      // always a known property with its own coordinates, so fall back to
      // those rather than dropping the stop entirely. Same fallback order
      // AdminDashboard.jsx's live "Where's the Team" map already uses for
      // this exact category (property first, GPS second) -- this just
      // needed the property's own lat/lng actually fetched to use it.
      const fallbackProperty = destProperty || destTicket?.property || (a.activity_category === 'visit_office' ? officeProperty : null)
      lat = fallbackProperty?.latitude ?? null
      lng = fallbackProperty?.longitude ?? null
    }
    if (lat == null || lng == null) return
    const meta = activityCategoryMeta(a.activity_type, a.activity_category)
    let subtitle = a.note || ''
    if (a.activity_category === 'job' && destTicket) {
      subtitle = `Job #${destTicket.ticket_number}${destTicket.property?.address ? ` — ${destTicket.property.address}` : ''}`
    } else if (destProperty) {
      subtitle = destProperty.address
    }
    stops.push({
      id: `activity-${a.id}`,
      at: a.arrived_at || a.started_at,
      endAt: a.ended_at,
      lat, lng,
      title: meta.label,
      subtitle,
      kind: 'activity',
    })
  })

  if (attendanceRow?.clock_out_at && attendanceRow.clock_out_lat != null && attendanceRow.clock_out_lng != null) {
    stops.push({ id: 'clockout', at: attendanceRow.clock_out_at, lat: attendanceRow.clock_out_lat, lng: attendanceRow.clock_out_lng, title: 'Clocked out', subtitle: '', kind: 'clockout' })
  }

  stops.sort((x, y) => new Date(x.at) - new Date(y.at))
  return stops
}

export const filterSelectStyle = { padding: '8px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 600, color: COLORS.slate900, background: COLORS.slate50, cursor: 'pointer' }
export const thStyle = { padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
export const tdStyle = { padding: '12px 14px', verticalAlign: 'top', fontSize: '13px' }
export const actionBtnStyle = { padding: '6px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, background: COLORS.white, color: COLORS.slate600, fontSize: '11px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }

export const modalOverlayStyle = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }
export const modalCardStyle = { background: COLORS.white, borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '460px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }
export const modalTitleStyle = { margin: 0, fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }
export const modalSubtitleStyle = { margin: '2px 0 0 0', fontSize: '13px', color: COLORS.slate500 }
export const modalLabelStyle = { display: 'block', margin: '16px 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }
export const modalTextareaStyle = { width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }
export const modalErrorStyle = { margin: '10px 0 0 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }
export const modalCancelBtnStyle = { flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }
export const modalConfirmBtnStyle = { flex: 2, padding: '10px', background: COLORS.blue700, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }

export function roleBadgeStyle(role) {
  if (role === 'admin' || role === 'manager') return { bg: COLORS.purple100, color: COLORS.purple600 }
  if (role === 'builder') return { bg: COLORS.blue100, color: COLORS.blue700 }
  return { bg: COLORS.teal100, color: COLORS.teal600 }
}

export function radioRowStyle(active) {
  return {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
    borderRadius: '10px', border: active ? `2px solid ${COLORS.blue700}` : `1px solid ${COLORS.slate200}`,
    background: active ? COLORS.blue50 : COLORS.white, cursor: 'pointer',
  }
}

export function formatDuration(ms) {
  if (!ms || ms < 0) ms = 0
  const totalMinutes = Math.round(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}h ${m}m`
}

// For durations that can realistically run into days (e.g. how long a
// ticket has been stuck) -- formatDuration()'s plain hour count gets
// unreadable past a day or two (e.g. "165h 14m"), so this switches to a
// "Xd Yh" form once it crosses 24h and only stays as "Xh Ym" below that.
export function formatDurationDays(ms) {
  if (!ms || ms < 0) ms = 0
  const totalMinutes = Math.round(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  return `${hours}h ${minutes}m`
}

// Computed once here so AdminReports.jsx's portfolio-wide and per-builder
// turnaround figures, and a staff profile's own KPI, all agree on the same
// definition (completed_at - created_at, averaged, never negative).
export function computeAvgTurnaroundMs(completedTickets) {
  if (!completedTickets || completedTickets.length === 0) return null
  return completedTickets.reduce((sum, t) => sum + Math.max(0, new Date(t.completed_at) - new Date(t.created_at)), 0) / completedTickets.length
}

// Time from a ticket being raised to it first being assigned to a
// builder -- distinct from total turnaround (created_at -> completed_at).
// Tickets with no first_assigned_at predate this feature and are excluded
// rather than treated as a fabricated ~0-minute response time.
export function computeAvgResponseMs(tickets) {
  const eligible = (tickets || []).filter(t => t.first_assigned_at)
  if (eligible.length === 0) return null
  return eligible.reduce((sum, t) => sum + Math.max(0, new Date(t.first_assigned_at) - new Date(t.created_at)), 0) / eligible.length
}

// Time actually spent working the job once assigned (first_assigned_at
// -> completed_at), distinct from total turnaround (created_at ->
// completed_at) and from response time (created_at -> first_assigned_at).
export function computeAvgAssignedToCompleteMs(completedTickets) {
  const eligible = (completedTickets || []).filter(t => t.first_assigned_at)
  if (eligible.length === 0) return null
  return eligible.reduce((sum, t) => sum + Math.max(0, new Date(t.completed_at) - new Date(t.first_assigned_at)), 0) / eligible.length
}

function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function shortDateLabel(date) {
  const dd = String(date.getDate()).padStart(2, '0')
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}`
}

// Weekly created-vs-completed bucketing, in the exact {label, values:[a,b]}
// shape SimpleBarChart expects -- shared by AdminReports.jsx's portfolio-
// wide trend and a staff profile's own per-builder trend, so both agree on
// how weeks are bucketed (Monday-start, inclusive of the end date's week).
export function buildWeeklyTrend(fromDate, toDate, createdList, completedList) {
  const weekBuckets = []
  let cursor = mondayOf(fromDate)
  const rangeEnd = new Date(new Date(toDate).getTime() + 86400000 - 1)
  while (cursor <= rangeEnd) {
    weekBuckets.push(new Date(cursor))
    cursor = new Date(cursor.getTime() + 7 * 86400000)
  }
  return weekBuckets.map(weekStart => {
    const weekEnd = new Date(weekStart.getTime() + 7 * 86400000)
    const createdCount = createdList.filter(t => {
      const c = new Date(t.created_at)
      return c >= weekStart && c < weekEnd
    }).length
    const completedCount = completedList.filter(t => {
      if (!t.completed_at) return false
      const c = new Date(t.completed_at)
      return c >= weekStart && c < weekEnd
    }).length
    // weekStartIso/weekEndIso: extra fields riding along on each bucket
    // purely for AdminReports.jsx's "click a bar to view those tickets in
    // Pipeline" links -- SimpleBarChart itself never reads them, and
    // BuilderProfilePage.jsx's own trend chart (buildWeeklyTrend's other
    // caller) just ignores them, same as it already ignores `values`
    // shape details it doesn't need.
    return {
      label: shortDateLabel(weekStart),
      values: [createdCount, completedCount],
      weekStartIso: weekStart.toISOString().slice(0, 10),
      weekEndIso: new Date(weekEnd.getTime() - 86400000).toISOString().slice(0, 10),
    }
  })
}

// The same duty-badge logic previously duplicated between AdminBuilders.jsx
// (the Staff list's "Live Field Radar") and the staff profile page --
// derives current on-the-job status purely from tickets already assigned
// to this one person.
export function computeDutyStatus(staffTickets, availabilityStatus) {
  const activeJobs = staffTickets.filter(t => t.status !== 'Completed' && t.status !== 'Archived')
  const inProgressJob = staffTickets.find(t => t.status === 'In Progress')

  // Availability overrides ticket-derived status -- someone marked On
  // Leave/Sick can't actually be on-site, even if a ticket is still
  // sitting "In Progress" because nobody paused or reassigned it when
  // they went off duty. Without this, "On Duty Now" and the duty badge
  // could contradict the availability badge shown right next to it.
  if (availabilityStatus === 'On Leave' || availabilityStatus === 'Sick') {
    return { activeJobs, inProgressJob, badge: { label: 'Off Duty', bg: COLORS.slate100, color: COLORS.slate400 }, onDuty: false }
  }

  let badge = { label: 'Standby / Idle', bg: COLORS.slate100, color: COLORS.slate400 }
  if (inProgressJob) badge = { label: 'On-Site Active', bg: COLORS.green100, color: COLORS.green600 }
  else if (activeJobs.length > 0) badge = { label: 'Assigned / Transit', bg: COLORS.blue100, color: COLORS.blue700 }

  return { activeJobs, inProgressJob, badge, onDuty: !!inProgressJob }
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
    .select('id, name, skills, gender')
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

// The "unscoped" half of every call site's own
// `profile.division ? fetchAssignableStaffForDivision(profile.division) : fetchAssignableBuilders()`
// ternary (AdminDashboard's Where's the Team, AdminClocking, AdminPipeline,
// AdminReports) -- for Admin or a manager with no division, this is meant
// to be "every builder-level person across every division", the unscoped
// mirror of what fetchAssignableStaffForDivision already returns for a
// division-scoped manager. It used to just be the literal built-in
// 'Builder' role, from before Housekeeping (or any other division) added
// its own builder-accessLevel custom role -- so an Admin or an unscoped
// manager silently never saw a Housekeeper anywhere in these 5 places
// (found live 2026-08-12: Housekeeper missing from Where's the Team for
// both Admin and Maintenance Manager). Now pulls every accessLevel:
// 'builder' role, built-in and custom alike, same as
// fetchAssignableStaffForDivision minus its division filter.
export async function fetchAssignableBuilders() {
  const { data: rolesRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const roleEntries = [
    { name: 'Builder', division: 'Maintenance' },
    ...normalizedCustomRoles.filter(r => r.accessLevel === 'builder').map(r => ({ name: r.name, division: r.division || 'Maintenance' })),
  ]

  const staffLists = await Promise.all(roleEntries.map(r => fetchAssignableStaffForRole(r.name)))
  const byId = {}
  // Tags each person with the division of the role they were fetched under,
  // so unscoped callers (Where's the Team) can offer a division filter on
  // top of the individual-person one without a second query.
  staffLists.forEach((list, i) => {
    list.forEach(s => { byId[s.id] = { ...s, division: roleEntries[i].division } })
  })
  return Object.values(byId).sort((a, b) => a.name.localeCompare(b.name))
}

// General "which staff can be assigned something" filter, keyed directly
// by division rather than resolved from one ticket's category (unlike
// fetchAssignableStaffForCategory below) -- for filter dropdowns (Pipeline,
// Reports) that aren't about a single ticket. No skill-narrowing step,
// matching fetchAssignableBuilders()'s own behaviour above (that's a
// Maintenance-specific refinement that doesn't apply to a general
// division-wide list).
export async function fetchAssignableStaffForDivision(division) {
  const { data: rolesRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)

  const roleNames = normalizedCustomRoles
    .filter(r => r.accessLevel === 'builder' && (r.division || 'Maintenance') === division)
    .map(r => r.name)

  if (division === 'Maintenance') roleNames.push('Builder')

  const staffLists = await Promise.all(roleNames.map(fetchAssignableStaffForRole))
  const byId = {}
  staffLists.flat().forEach(s => { byId[s.id] = s })
  return Object.values(byId).sort((a, b) => a.name.localeCompare(b.name))
}

// For "who's idle right now and since when/where" (Where's the Team,
// Clocking's Today's Attendance) -- the most recent ended work_sessions row
// per builder today gives both. Deliberately reuses what
// handleComplete/handlePause in BuilderDashboard.jsx already save
// (clock_out_lat/lng the moment a job ends, whether by completing or
// pausing it) rather than adding any new tracking -- that data just wasn't
// being surfaced anywhere before.
export async function fetchLastEndedSessionsToday(staffIds, todayKey) {
  if (!staffIds?.length) return {}
  const { data } = await supabase
    .schema('pmms')
    .from('work_sessions')
    .select('builder_id, ticket_id, ended_at, clock_out_lat, clock_out_lng')
    .in('builder_id', staffIds)
    .not('ended_at', 'is', null)
    .gte('ended_at', `${todayKey}T00:00:00`)
    .order('ended_at', { ascending: false })

  const byBuilder = {}
  ;(data || []).forEach(s => { if (!byBuilder[s.builder_id]) byBuilder[s.builder_id] = s })
  return byBuilder
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

// Shared between AdminRaiseTicket.jsx and SubmitterDashboard.jsx's own
// report form -- was only ever defined in the admin form, so a submitter
// had no way to say which floor/part of the flat an issue was in even
// though the data (property.layout_type) has been available to her via
// builder_properties() all along. Optional, not required -- most
// properties don't have real Floor Layout data entered yet (see
// PropertyCoreTab.jsx), so forcing a guess out of whoever's reporting
// just to get past this step isn't worth it.
export function floorContextOptions(property) {
  if (!property) return ['Ground Floor', 'First Floor']
  if (property.layout_type === 'Flat') return ['Main Flat Space', 'En-Suite Area']
  if (property.layout_type === '1-Floor') return ['Ground Floor']
  if (property.layout_type === '3-Floors') return ['Ground Floor', 'First Floor', 'Second Floor']
  return ['Ground Floor', 'First Floor'] // '2-Floors' (the DB default) plus any property with no Floor Layout set yet
}

export function floorContextLabel(property) {
  return (property?.layout_type === 'Flat' ? 'Which part of the flat?' : 'Which floor?') + ' (optional)'
}

// Shared between SubmitterDashboard.jsx (where these are asked) and
// AdminPipeline.jsx (where the answers need to be visible to a manager) --
// see add_submitter_signoff_quality_check.sql.
export const SIGNOFF_QUESTIONS = [
  { key: 'resolved', field: 'signoff_resolved', label: 'Was the issue resolved?' },
  { key: 'goodStandard', field: 'signoff_good_standard', label: 'Was the work done to a good standard?' },
  { key: 'clean', field: 'signoff_clean', label: 'Was the property left clean and tidy?' },
]

// ignoreSkills: true bypasses the skill-narrowing below entirely -- the
// override a manager reaches for when they need to assign outside a
// builder's tagged skills (Raise Ticket, Pipeline's reassign/bulk-reassign)
// rather than the skill filter just silently hiding that person as an
// option with no way around it. Directors approved this 2026-08-12: the
// filter itself stays as the default, only an explicit opt-in bypasses it.
export async function fetchAssignableStaffForCategory(category, { ignoreSkills = false } = {}) {
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

  // Compliance has no builder-level role of its own (only Compliance
  // Manager) -- physical compliance work (fire alarm/CO alarm/fire door
  // faults etc.) is actually done by tagged Maintenance builders. Reuses
  // the same opt-in staff.skills tag Maintenance categories use below,
  // just to ADD eligibility here instead of narrowing it. ignoreSkills
  // widens this to every Maintenance builder, the same override intent
  // the Maintenance skill-narrowing branch below already has.
  if (categoryDivision === 'Compliance') {
    const maintenanceBuilders = await fetchAssignableStaffForRole('Builder')
    maintenanceBuilders
      .filter(s => ignoreSkills || s.skills?.includes('Compliance Technician'))
      .forEach(s => { byId[s.id] = s })
  }

  const eligible = Object.values(byId)

  // Skill-narrowing only applies within Maintenance (the case this was
  // built for) -- Housekeeping etc. keep routing by role/division alone,
  // unchanged. A builder with no skills tagged at all is left untouched
  // (eligible for everything), so tagging is opt-in and nothing existing
  // breaks for anyone an admin hasn't gone and tagged.
  const filtered = (categoryDivision === 'Maintenance' && !ignoreSkills)
    ? eligible.filter(s => !s.skills?.length || s.skills.includes(category))
    : eligible

  return filtered.sort((a, b) => a.name.localeCompare(b.name))
}

const DEFAULT_CLOCK_FLAG_LOOKBACK_DAYS = 30

// Counts jobs whose recorded clock-in/out location was further than the
// configured threshold from the property -- the exact same "flagged"
// definition the Clocking page itself uses, so this number always matches
// what a manager finds after clicking through. Counts a live session once
// (by its clock-in) and a completed job once (if either its first clock-in
// or its last clock-out was out of range).
//
// Two things keep this from only ever going up, never down (found live --
// a manager had no way to bring this number down at all):
//   1. Completed/archived tickets are scoped to the last
//      clock_flag_lookback_days (default 30) by completed_at -- an old
//      flag ages out on its own instead of counting forever. Live
//      (still-open) sessions are never windowed -- they're happening now.
//   2. pmms.clocking_flag_dismissals (see
//      scripts/add_clocking_flag_dismissals.sql) lets a manager dismiss
//      one early from the Clocking page after checking it -- a dismissed
//      (ticket_id, kind) pair is excluded even within the window.
export async function fetchFlaggedClockingCount() {
  const { data: settingsRows } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['clock_distance_threshold_meters', 'clock_flag_lookback_days'])
  const settingsByKey = {}
  ;(settingsRows || []).forEach(r => { settingsByKey[r.setting_key] = r.setting_value })
  const thresholdM = settingsByKey.clock_distance_threshold_meters != null ? Number(settingsByKey.clock_distance_threshold_meters) : DEFAULT_CLOCK_DISTANCE_THRESHOLD_M
  const lookbackDays = settingsByKey.clock_flag_lookback_days != null ? Number(settingsByKey.clock_flag_lookback_days) : DEFAULT_CLOCK_FLAG_LOOKBACK_DAYS
  const cutoffIso = new Date(Date.now() - lookbackDays * 86400000).toISOString()

  const { data: dismissals } = await supabase
    .schema('pmms')
    .from('clocking_flag_dismissals')
    .select('ticket_id, kind')
  const isDismissed = (ticketId, kind) => (dismissals || []).some(d => d.ticket_id === ticketId && d.kind === kind)

  const { data: openSessions } = await supabase
    .schema('pmms')
    .from('work_sessions')
    .select('ticket_id, clock_in_lat, clock_in_lng')
    .is('ended_at', null)

  const { data: completedTicketsRaw } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, property_id, completed_at')
    .in('status', ['Completed', 'Archived'])
    .gte('completed_at', cutoffIso)
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
    if (isDismissed(s.ticket_id, 'clock_in')) return
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
      const inDistance = (first.clock_in_lat != null && first.clock_in_lng != null && !isDismissed(t.id, 'clock_in'))
        ? distanceMetres(first.clock_in_lat, first.clock_in_lng, coords.latitude, coords.longitude)
        : null
      const outDistance = (last.clock_out_lat != null && last.clock_out_lng != null && !isDismissed(t.id, 'clock_out'))
        ? distanceMetres(last.clock_out_lat, last.clock_out_lng, coords.latitude, coords.longitude)
        : null

      if ((inDistance != null && inDistance > thresholdM) || (outDistance != null && outDistance > thresholdM)) {
        flaggedCount += 1
      }
    })
  }

  return flaggedCount
}

export async function fetchStuckTicketsCount() {
  const { data: thresholdsRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'stuck_ticket_thresholds')
    .maybeSingle()
  if (!thresholdsRow?.setting_value) return 0

  const { data: openTickets } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, status, status_changed_at, created_at, priority_score, priority_override')
    .in('status', STUCK_ELIGIBLE_STATUSES)

  return (openTickets || []).filter(t => isTicketStuck(t, thresholdsRow.setting_value)).length
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

const OPEN_TICKET_STATUS_EXCLUSION = '("Completed","Archived","Cancelled")'

// Runs when a staff member is deactivated (see AdminAccess.jsx's
// handleToggleActive) -- managers told us a short holiday is fine to
// handle manually via the Pipeline page's bulk reassign, but someone
// actually leaving the company should be automatic, no prompt. Picks
// whichever eligible builder currently has the fewest open tickets
// overall (their real workload, not just this one category's queue) --
// the same four update/comment/audit/notification steps
// submitReassign/submitBulkReassign already use in AdminPipeline.jsx, just
// system-triggered instead of manager-triggered.
export async function autoReassignDepartingStaffTickets(staffId, staffName, profile) {
  const { data: ticketRows } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('id, ticket_number, status, category, assigned_builder_id, property_id')
    .eq('assigned_builder_id', staffId)
    .not('status', 'in', OPEN_TICKET_STATUS_EXCLUSION)

  const openTickets = await attachProperties(ticketRows || [])
  if (openTickets.length === 0) return { reassignedCount: 0, failures: [] }

  const { data: allOpenRows } = await supabase
    .schema('pmms')
    .from('tickets')
    .select('assigned_builder_id')
    .not('status', 'in', OPEN_TICKET_STATUS_EXCLUSION)

  const openCountByBuilder = {}
  ;(allOpenRows || []).forEach(t => {
    if (t.assigned_builder_id) openCountByBuilder[t.assigned_builder_id] = (openCountByBuilder[t.assigned_builder_id] || 0) + 1
  })

  const candidatesByCategory = {}
  const failures = []
  let reassignedCount = 0

  for (const t of openTickets) {
    if (!(t.category in candidatesByCategory)) {
      candidatesByCategory[t.category] = await fetchAssignableStaffForCategory(t.category)
    }
    const candidates = candidatesByCategory[t.category]

    if (candidates.length === 0) {
      await supabase.schema('pmms').from('tickets').update({ assigned_builder_id: null }).eq('id', t.id)
      await postSystemComment(t.id, profile, `Unassigned: ${staffName} was deactivated and no eligible builder was available to auto-reassign this ticket. Needs manual assignment.`)
      await postAuditEvent(t.id, profile, 'Unassigned', `${staffName} was deactivated; no eligible builder found for auto-reassignment.`)
      failures.push({ ticket: t, message: `No eligible builder available for "${t.category}"` })
      continue
    }

    const newBuilder = candidates.reduce((best, c) =>
      (openCountByBuilder[c.id] || 0) < (openCountByBuilder[best.id] || 0) ? c : best
    , candidates[0])

    const promoteToAssigned = t.status === 'Pending'
    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        assigned_builder_id: newBuilder.id,
        // Picked by this least-busy-eligible-builder logic, not a manager
        // -- see AdminPipeline.jsx's Assign Type column/filter.
        assign_type: 'Auto',
        ...(promoteToAssigned ? { status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null, first_assigned_at: new Date().toISOString() } : {}),
      })
      .eq('id', t.id)

    if (error) { failures.push({ ticket: t, message: error.message }); continue }

    const reasonText = `${staffName} left the company (automatic reassignment)`
    const statusNote = promoteToAssigned ? ` Status: ${statusLabel(t.status)} → Assigned.` : ''
    await postSystemComment(t.id, profile, `Reassigned from ${staffName} to ${newBuilder.name}. Reason: ${reasonText}`)
    await postAuditEvent(t.id, profile, 'Reassigned', `Reassigned from ${staffName} to ${newBuilder.name}.${statusNote} Reason: ${reasonText}`)
    await createNotification(newBuilder.id, t.id, `You've been assigned Job #${t.ticket_number} at ${t.property?.address || 'a property'}.`)

    // Spreads the load across candidates instead of dumping every one of
    // this person's same-category tickets on whoever was least busy first.
    openCountByBuilder[newBuilder.id] = (openCountByBuilder[newBuilder.id] || 0) + 1
    reassignedCount += 1
  }

  return { reassignedCount, failures }
}

// Same eligibility + least-open-tickets logic as
// autoReassignDepartingStaffTickets above, but for a single not-yet-created
// ticket rather than bulk-reassigning an existing one -- returns the
// suggested builder (or null if nobody's eligible) and leaves the actual
// insert/update to the caller, since AdminRaiseTicket needs to show the
// suggestion before submitting while SubmitterDashboard applies it silently.
// Accepts an already-fetched eligible list via `candidates` so callers that
// already called fetchAssignableStaffForCategory for their own dropdown
// (AdminRaiseTicket) don't have to fetch it a second time.
export async function suggestAutoAssignBuilder(category, { candidates: preFetched } = {}) {
  const candidates = preFetched ?? await fetchAssignableStaffForCategory(category)
  if (candidates.length === 0) return null

  // RPC, not a direct table read -- a submitter's session can only see
  // tickets she raised herself (submitter_select_own RLS), so a raw
  // `.from('tickets')` query here came back empty under her session and
  // this always fell back to picking the alphabetically-first eligible
  // candidate instead of the genuinely least-busy one. The RPC is
  // SECURITY DEFINER and returns only an aggregate count per builder --
  // no ticket details -- so it works the same for every caller
  // regardless of their own row-level access to tickets.
  const { data: openCounts } = await supabase.schema('pmms').rpc('open_ticket_counts_by_builder')

  const openCountByBuilder = {}
  ;(openCounts || []).forEach(row => { openCountByBuilder[row.builder_id] = Number(row.open_count) })

  return candidates.reduce((best, c) =>
    (openCountByBuilder[c.id] || 0) < (openCountByBuilder[best.id] || 0) ? c : best
  , candidates[0])
}

// Fire-and-forget, matching createNotification's style -- a push failing
// (no VAPID keys configured yet, a stale subscription, etc.) must never
// block the underlying assignment/ticket action.
export async function sendPushNotification(staffIds, title, body) {
  try {
    await supabase.functions.invoke('send-push-notifications', { body: { staffIds, title, body } })
  } catch {
    // swallow -- see comment above
  }
}

// Same pattern as fetchAssignableStaffForCategory, swapped from
// accessLevel === 'builder' to 'manager' -- there's no built-in
// 'Manager' role to fall back on the way 'Builder' is for Maintenance,
// since every manager role is a custom one. Admins are unioned in
// unconditionally since they're not scoped to any division.
export async function fetchManagersForDivision(division) {
  const { data: rolesRow } = await supabase
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const roleNames = normalizedCustomRoles
    .filter(r => r.accessLevel === 'manager' && (r.division || 'Maintenance') === division)
    .map(r => r.name)

  const [managerLists, admins] = await Promise.all([
    Promise.all(roleNames.map(fetchAssignableStaffForRole)),
    fetchAssignableStaffForRole('Admin'),
  ])

  const byId = {}
  ;[...managerLists.flat(), ...admins].forEach(s => { byId[s.id] = s })
  return Object.values(byId)
}

// Called wherever a ticket's effective priority tier becomes P1 Critical
// -- at creation, or via Pipeline's manual priority override.
export async function pushEmergencyAlert(ticket, division) {
  const managers = await fetchManagersForDivision(division)
  if (managers.length === 0) return
  await sendPushNotification(
    managers.map(m => m.id),
    'Emergency ticket raised',
    `Job #${ticket.ticket_number}: ${ticket.category} at ${ticket.property?.address || 'a property'}`
  )
}
