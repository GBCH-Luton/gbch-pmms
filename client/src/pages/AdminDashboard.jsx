import { useState, useEffect, useCallback, useRef, Fragment, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { NavIcon } from '../lib/icons'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { pushNotificationsSupported, hasActivePushSubscription, enablePushNotifications } from '../lib/pushNotifications'
import gbchLogo from '../assets/gbch-logo.svg'
import { EVENTS_FEATURE_ENABLED, AI_TRIAL_FEATURE_ENABLED, LANDLORD_LIAISON_PAGE_ENABLED, resolveStaffPhotoUrl, ukDateKey, ukTimeHHMM, minutesLate, formatUKDate, formatUKDateTime } from './admin/shared'
import { getImpersonationMarker, returnToAdmin } from '../lib/impersonation'
import { countUnreadMessages } from '../lib/chat'
import { countUnreadDms } from '../lib/dm'
import { fetchDivisions } from '../lib/divisions'
import { fetchOnboardingMetrics } from '../lib/onboarding'
import { getCurrentPositionSafe } from '../lib/geo'
import { attachProperties } from '../lib/properties'
// Lazy, not a direct import -- this shell loads eagerly for every admin/
// manager, but the property picker it's for (Log a Visit) is only opened
// by manager-tier staff, occasionally. A direct import here would have
// pulled its ~39KB chunk into everyone's initial load, including builders
// and Admin, who never use it.
const PropertySearchSelect = lazy(() => import('../components/PropertySearchSelect'))

// Lazy-loaded: an admin/manager only ever looks at a handful of these tabs
// in a given session, so each becomes its own chunk fetched on first visit
// instead of all 18 admin pages loading up front in the main bundle.
const AdminDashboardPage = lazy(() => import('./admin/AdminDashboard'))
const AdminPipeline = lazy(() => import('./admin/AdminPipeline'))
const AdminProperties = lazy(() => import('./admin/AdminProperties'))
const AdminCompliance = lazy(() => import('./admin/AdminCompliance'))
const AdminLandlordLiaison = lazy(() => import('./admin/AdminLandlordLiaison'))
const AdminVoids = lazy(() => import('./admin/AdminVoids'))
const AdminSignOff = lazy(() => import('./admin/AdminSignOff'))
const AdminBuilders = lazy(() => import('./admin/AdminBuilders'))
const AdminClocking = lazy(() => import('./admin/AdminClocking'))
const AdminRaiseTicket = lazy(() => import('./admin/AdminRaiseTicket'))
const AdminRaiseMaintenanceTicket = lazy(() => import('./admin/AdminRaiseMaintenanceTicket'))
const AdminOnboardProperty = lazy(() => import('./admin/AdminOnboardProperty'))
const PropertyDimensionsAssessment = lazy(() => import('./admin/PropertyDimensionsAssessment'))
const AdminStock = lazy(() => import('./admin/AdminStock'))
const AdminReports = lazy(() => import('./admin/AdminReports'))
const AdminSettings = lazy(() => import('./admin/AdminSettings'))
const AdminAccess = lazy(() => import('./admin/AdminAccess'))
const AdminHelp = lazy(() => import('./admin/AdminHelp'))
const AdminBuilderGuide = lazy(() => import('./admin/AdminBuilderGuide'))
const AdminBuilderGuideV2 = lazy(() => import('./admin/AdminBuilderGuideV2'))
const AdminBuilderGuideV03 = lazy(() => import('./admin/AdminBuilderGuideV03'))
const AdminHousekeepingGuide = lazy(() => import('./admin/AdminHousekeepingGuide'))
const AdminLogAVisitGuide = lazy(() => import('./admin/AdminLogAVisitGuide'))
const AdminHousekeeping = lazy(() => import('./admin/AdminHousekeeping'))
const AdminEvents = lazy(() => import('./admin/AdminEvents'))
const AdminViewAs = lazy(() => import('./admin/AdminViewAs'))
const AdminTeamChat = lazy(() => import('./admin/AdminTeamChat'))
const AiTicketLogging = lazy(() => import('./admin/ai-trial/AiTicketLogging'))
const AiPriorityScoring = lazy(() => import('./admin/ai-trial/AiPriorityScoring'))
const AiComplianceDigest = lazy(() => import('./admin/ai-trial/AiComplianceDigest'))

const NAV_ITEMS = [
  // Grouped by what they're actually for: core ticket lifecycle first,
  // then property/division monitoring, then people-ops, then stock, then
  // reports/config at the bottom (2026-07-22 reorder).
  { key: 'dashboard', label: 'Dashboard', icon: 'dashboard', Component: AdminDashboardPage },
  // RLS on pmms.chat_messages is the real restriction (division-scoped),
  // not this nav item -- visible to any admin/manager, no divisions/
  // divisionOnly gating needed here.
  { key: 'team-chat', label: 'Team Chat', icon: 'chat', Component: AdminTeamChat },
  { key: 'pipeline', label: 'Pipeline', icon: 'pipeline', Component: AdminPipeline },
  { key: 'raise-ticket', label: 'Log a Ticket', icon: 'ticket', Component: AdminRaiseTicket },
  // Temporary (2026-08-25): Housekeeping Manager needs to raise tickets
  // outside her own division's categories for a while. Gated on the exact
  // named Role (not job_title/division alone), same reasoning as Onboard a
  // Property below -- remove this whole item (and AdminRaiseMaintenanceTicket.jsx,
  // and the matching RLS policies) once that need ends, see
  // [[project_housekeeping_manager_temp_raise_access]].
  { key: 'raise-maintenance-ticket', label: 'Temp Log Tickets', icon: 'ticket', Component: AdminRaiseMaintenanceTicket, visibleTo: p => p.pmmsRole === 'Housekeeping Manager' },
  { key: 'sign-off', label: 'Sign-Off', icon: 'check', Component: AdminSignOff },
  ...(EVENTS_FEATURE_ENABLED ? [{ key: 'events', label: 'Events', icon: 'calendar', Component: AdminEvents }] : []),
  // Properties / Onboard a Property / Dimensions Assessment grouped
  // together in this order (2026-08-26) -- all three are property-record
  // work, kept adjacent rather than scattered through the list.
  { key: 'properties', label: 'Properties', icon: 'building', Component: AdminProperties },
  // Room-by-room new-property walk -> real tickets on any Fail -> Landlord
  // Liaison review -> property flips Live. Restricted to exactly the roles
  // it's for -- neither divisions nor divisionOnly fit "one specific named
  // PMMS Role, regardless of division", so this is one of the nav items
  // using visibleTo instead. Gated on the assigned Role's own name
  // (profile.pmmsRole, e.g. "Maintenance Assistant" -- an existing manager-
  // access custom role, not a job_title), not job_title -- an earlier
  // version of this gate checked job_title === 'Assistant Manager', which
  // turned out not to be a real job_title in this company's data at all.
  // Admin added 2026-08-26 (same p.role === 'admin' check as Dimensions
  // Assessment below) -- explicitly NOT Maintenance Manager, who is
  // otherwise unscoped/sees-everything but has no reason to be walking
  // properties himself.
  { key: 'onboard-property', label: 'Onboard a Property', icon: 'sunrise', Component: AdminOnboardProperty, visibleTo: p => p.role === 'admin' || p.pmmsRole === 'Maintenance Assistant' || p.division === 'Landlord Liaison' },
  // Room-by-room floor measurements, feeding the Property Profile's own
  // "Dimensions" tab (see PropertyDimensionsTab.jsx) -- built for the
  // Landlord Liaison, replacing a Microsoft Forms form nobody else could
  // see the results of. visibleTo (not divisions/divisionOnly, same
  // reasoning as Onboard a Property above) deliberately matches exactly who
  // can already see that Property Profile tab (admin, unscoped managers,
  // and Landlord Liaison -- Housekeeping/Compliance's own narrower
  // DIVISION_PROFILE_TABS lists don't include it) -- otherwise the "Redo
  // Assessment" button's navigation would silently land on the Dashboard
  // instead for anyone allowed to see the tab but not this nav item
  // (isNavItemVisible gates actual page rendering, not just the sidebar).
  { key: 'property-dimensions', label: 'Dimensions Assessment', icon: 'building', Component: PropertyDimensionsAssessment, visibleTo: p => p.role === 'admin' || p.division === 'Landlord Liaison' },
  { key: 'voids', label: 'Voids', icon: 'key', Component: AdminVoids, divisions: ['Maintenance'] },
  // Division dashboards, grouped together in this order.
  { key: 'compliance', label: 'Compliance', icon: 'shield', Component: AdminCompliance, divisions: ['Maintenance', 'Compliance'] },
  // Restored for the Landlord Liaison Manager herself 2026-08-18 (was
  // Maintenance-only oversight since 2026-08-15) -- same as Compliance/
  // Housekeeping's own nav items, now visible to Admin/unscoped
  // Maintenance Manager oversight AND the Landlord Liaison Manager.
  ...(LANDLORD_LIAISON_PAGE_ENABLED ? [{ key: 'landlord-liaison', label: 'Landlord Liaison', icon: 'building', Component: AdminLandlordLiaison, divisions: ['Maintenance', 'Landlord Liaison'] }] : []),
  // Was divisionOnly (Housekeeping Manager/Admin only) until the main
  // dashboard grew its own Housekeeping KPI section for Admin/unscoped
  // Maintenance Manager oversight -- broadened to match Compliance's own
  // `divisions` gating so those tiles' click-through actually opens
  // something instead of silently landing on nothing.
  { key: 'housekeeping', label: 'Housekeeping', icon: 'broom', Component: AdminHousekeeping, divisions: ['Maintenance', 'Housekeeping'] },
  { key: 'builders', label: 'Staff', icon: 'users', Component: AdminBuilders },
  { key: 'clocking', label: 'Clocking', icon: 'clock', Component: AdminClocking },
  { key: 'stock', label: 'Stock', icon: 'box', Component: AdminStock, divisions: ['Maintenance'] },
  { key: 'reports', label: 'Reports', icon: 'chart', Component: AdminReports },
  // Sits in AI Trial's old slot (see AI_TRIAL_FEATURE_ENABLED, hidden
  // 2026-08-09). Made adminOnly 2026-08-15 -- was originally open to any
  // manager on the theory that a division-scoped manager might want to
  // browse another division's guide for context, but in practice this is
  // training material for onboarding, not something a working manager
  // needs in their own nav (a Landlord Liaison Manager, for instance, has
  // no use for it at all). Each child also carries adminOnly itself, same
  // defense-in-depth pattern as AI Trial below.
  {
    key: 'quick-guide', label: 'Quick Guide', icon: 'phone', adminOnly: true,
    children: [
      { key: 'builder-guide', label: 'Builder', Component: AdminBuilderGuide, adminOnly: true },
      { key: 'builder-guide-v2', label: 'Builder v.2', Component: AdminBuilderGuideV2, adminOnly: true },
      { key: 'builder-guide-v03', label: 'Builder v0.3', Component: AdminBuilderGuideV03, adminOnly: true },
      { key: 'housekeeper-guide', label: 'Housekeeper', Component: AdminHousekeepingGuide, adminOnly: true },
      { key: 'log-a-visit-guide', label: 'Log a Visit', Component: AdminLogAVisitGuide, adminOnly: true },
    ],
  },
  // Trial section, admin-only while it's being tried out and shown to
  // managers -- free, rule-based (no external AI service, no cost), see
  // client/src/pages/admin/ai-trial/keywordEngine.js. Each child also
  // carries adminOnly itself (not just the parent) so the defense-in-depth
  // check below (activeNavItem + isNavItemVisible) still holds if one is
  // ever resolved directly by key.
  ...(AI_TRIAL_FEATURE_ENABLED ? [{
    key: 'ai-trial', label: 'AI Trial', icon: 'sparkle', adminOnly: true,
    children: [
      { key: 'ai-ticket', label: 'Ticket Logging', Component: AiTicketLogging, adminOnly: true },
      { key: 'ai-priority', label: 'Priority Scoring', Component: AiPriorityScoring, adminOnly: true },
      { key: 'ai-compliance', label: 'Compliance Digest', Component: AiComplianceDigest, adminOnly: true },
    ],
  }] : []),
  // These three are rendered in the profile popover, not the main nav list
  // (see SidebarContent) -- still present here so NAV_ITEMS/isNavItemVisible
  // keep working as the single source of truth for routing + visibility.
  { key: 'settings', label: 'Settings', icon: 'gear', Component: AdminSettings },
  { key: 'admin', label: 'Admin', icon: 'lock', Component: AdminAccess, adminOnly: true },
  { key: 'view-as', label: 'View As...', icon: 'eye', Component: AdminViewAs, adminOnly: true },
  { key: 'help', label: 'Help & Guide', icon: 'book', Component: AdminHelp, adminOnly: true },
]

const POPOVER_ITEM_KEYS = ['settings', 'admin', 'view-as', 'help']

// Visual grouping dividers in the main nav: Dashboard alone, then the
// ticket lifecycle (Pipeline/Log a Ticket/Sign-Off), then Properties/
// Onboard a Property/Dimensions Assessment as their own section (2026-08-26),
// then division monitoring (Voids/Compliance/Housekeeping), then people-ops
// (Staff/Clocking), then Stock/Reports, then Quick Guide (and AI Trial,
// while re-enabled) set apart on their own.
const DIVIDER_AFTER_KEYS = ['team-chat', 'sign-off', 'property-dimensions', 'housekeeping', 'clocking', 'reports']

const PENDING_SIGN_OFF_POLL_MS = 20000

// Settings is hidden per-role via profile.hideSettings (a UI-only
// convenience for e.g. a "Maintenance Assistant" role -- see roles.js),
// separate from the access-level-based adminOnly flag above.
//
// Two different division-filtering shapes, deliberately not one:
//
// `divisions` (opt-out allow-list, e.g. Compliance/Voids/Stock): hidden
// only for a manager explicitly scoped to a *different* division. An
// unscoped manager (today's default for every existing role) keeps
// seeing these exactly as before -- no regression, matching the
// guarantee the ticket-level RLS division scoping already established.
//
// `divisionOnly` (opt-in only, e.g. the new Housekeeping item): shown
// only to a manager explicitly scoped to that division, or an Admin.
// Using `divisions` semantics here would have been wrong -- an unscoped
// manager (e.g. today's Maintenance Manager) would incorrectly also see
// a brand-new item nobody has ever seen before, since there's no
// existing visibility to "regress" from.
function isNavItemVisible(item, profile) {
  if (item.adminOnly && profile.role !== 'admin') return false
  if (item.key === 'settings' && profile.hideSettings) return false
  // UI-only: hides the whole Admin page (not just its Recent Login
  // Activity/Error & Crash Log/Roles panels, see hideDiagnostics/
  // hideStaffRoles in roles.js) for an admin-level custom role whose Staff
  // panel access still isn't meant to be that broad.
  if (item.key === 'admin' && profile.hideAdminAccess) return false
  if (item.divisions && profile.division && !item.divisions.includes(profile.division)) return false
  if (item.divisionOnly && profile.role !== 'admin' && profile.division !== item.divisionOnly) return false
  // A third, narrower shape for the one item (Onboard a Property) gated by
  // job_title, not division -- neither divisions nor divisionOnly fit a
  // job_title condition, so this is a plain predicate instead.
  if (item.visibleTo && !item.visibleTo(profile)) return false
  return true
}

// A lone "." or other punctuation-only text technically passes .trim(),
// letting someone tap through the clock-in gate's required "Other" note
// without actually describing anything -- found live 2026-09-01 (a
// staff member's note was literally "."), same fix as
// BuilderDashboard.jsx's own hasMeaningfulNote. Requires at least one
// real letter/digit instead of just non-empty.
function hasMeaningfulNote(note) {
  return /[a-zA-Z0-9]/.test(note)
}

export default function AdminDashboard({ profile }) {
  // Kept in the URL (?page=...), not plain useState -- so a browser refresh
  // (which fully reboots the SPA and loses all in-memory state) lands back
  // on the same admin page instead of always resetting to the dashboard
  // home tab. replace: true on every navigation (see goToPage) so clicking
  // around the sidebar doesn't pile up browser-back history entries -- this
  // is only meant to survive a refresh, not become a back-button feature.
  const [searchParams, setSearchParams] = useSearchParams()
  const currentPage = searchParams.get('page') || 'dashboard'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // Desktop-only -- the mobile drawer (SidebarContent's other instance,
  // rendered without allowCollapse) always shows full labels regardless of
  // this, since it's a temporary overlay you explicitly open, not a
  // persistent rail competing for screen space. Persisted the same way the
  // dashboard's per-section collapse state already is.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Collapsed by default for anyone who's never touched the toggle --
    // only an explicit 'false' (they expanded it themselves at some
    // point) overrides that, so an existing user's own choice still
    // sticks either way.
    try {
      const stored = localStorage.getItem('pmms_sidebar_collapsed')
      return stored === null ? true : stored === 'true'
    } catch { return true }
  })

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('pmms_sidebar_collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }
  const [pendingSignOffCount, setPendingSignOffCount] = useState(0)
  const [totalTicketsCount, setTotalTicketsCount] = useState(0)
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0)
  const [onboardActionCount, setOnboardActionCount] = useState(0)
  const [pipelineInitialFilter, setPipelineInitialFilter] = useState(null)
  const [pipelineInitialPriorityFilter, setPipelineInitialPriorityFilter] = useState(null)
  const [pipelineInitialStuckFilter, setPipelineInitialStuckFilter] = useState(null)
  const [pipelineInitialNeedsFollowupFilter, setPipelineInitialNeedsFollowupFilter] = useState(null)
  const [pipelineInitialTicketNumber, setPipelineInitialTicketNumber] = useState(null)
  // Reports/Clocking's "jump to Pipeline with this filter already applied"
  // links (see AdminReports.jsx's KPI tiles, chart bars, and table rows)
  // route through these same five, rather than one bespoke prop per
  // possible combination.
  const [pipelineInitialCategory, setPipelineInitialCategory] = useState(null)
  const [pipelineInitialDivision, setPipelineInitialDivision] = useState(null)
  const [pipelineInitialBuilder, setPipelineInitialBuilder] = useState(null)
  const [pipelineInitialProperty, setPipelineInitialProperty] = useState(null)
  const [pipelineInitialFromDate, setPipelineInitialFromDate] = useState(null)
  const [pipelineInitialToDate, setPipelineInitialToDate] = useState(null)
  // Generic "jump out to X, then come back to exactly where you were"
  // link -- goToPage's own history "replace" (not "push", deliberately,
  // so normal sidebar clicks don't clutter the browser's Back button)
  // means there's otherwise no way back from a link like Clocking's
  // History modal opening a ticket in Pipeline. { label, page, opts }
  // -- opts is whatever goToPage(page, opts) would normally take, so the
  // "back" link is just another goToPage call, same as any nav click.
  const [returnTo, setReturnTo] = useState(null)
  // Clocking-specific: reopens the History modal for a given staff/date
  // when arriving via a returnTo link, rather than just landing back on
  // a bare Clocking page with the modal closed again.
  const [clockingInitialReopenHistory, setClockingInitialReopenHistory] = useState(null)
  const [propertiesInitialFilter, setPropertiesInitialFilter] = useState(null)
  const [complianceInitialTierFilter, setComplianceInitialTierFilter] = useState(null)
  const [voidsInitialTierFilter, setVoidsInitialTierFilter] = useState(null)
  const [buildersInitialStaffId, setBuildersInitialStaffId] = useState(null)
  const [dimensionsInitialPropertyId, setDimensionsInitialPropertyId] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushError, setPushError] = useState('')

  // Every manager-tier role (accessLevel 'manager' in custom_roles --
  // Maintenance Manager, Maintenance Assistant, Housekeeping Manager,
  // Compliance Manager, Landlord Liaison Manager, any future one) gets
  // their own daily clock-in/out, same rules as builders (late/early
  // flags, stale-shift lockout) -- mirrors BuilderDashboard.jsx's own
  // handleClockInForDay/attemptClockOutForDay almost exactly, minus the
  // in-progress-job/away-activity blockers on clocking out (not applicable
  // to a manager -- no jobs of their own). Originally built for Landlord
  // Liaison Manager alone (2026-08-17), extended to every manager-tier
  // role 2026-08-28 -- explicitly excludes Admin (accessLevel 'admin'
  // never matches 'manager', see accessLevelForRole in lib/roles.js). The
  // existing check-clock-out-reminders auto-clockout cron already applies
  // generically to any open pmms.daily_attendance row regardless of role,
  // so no backend change was needed for that part -- see
  // add_stale_shift_alerting.sql/check-clock-out-reminders for the
  // pre-existing 2-hour-grace auto-close this reuses as-is. Same for RLS:
  // pmms.daily_attendance/activity_log's manager_division_scoped_access
  // and manager_unscoped_full_access policies already cover ANY manager's
  // own rows, not just Landlord Liaison -- confirmed by reading
  // add_daily_attendance.sql/add_activity_log.sql before making this
  // change, no migration needed.
  //
  // The whole-app BLOCKING gate is skipped while an admin is impersonating
  // (View As) -- an admin testing on their own device has no reason to
  // have real GPS signal for the impersonated manager's shift, and being
  // forced through the clock-in screen just to preview another page would
  // defeat the point of View As. `showsDailyClockingUI` is the separate,
  // non-impersonation-gated flag: it controls whether the Clocking page's
  // own "Your Day" card (clock status, Clock Out, Log a Visit) fetches/
  // renders at all, so that card is still visible/testable during View As
  // even though the app-wide block isn't enforced.
  const showsDailyClockingUI = profile.role === 'manager'
  const requiresDailyClocking = showsDailyClockingUI && !getImpersonationMarker()
  const [dailyShift, setDailyShift] = useState(null)
  const [staleDailyShift, setStaleDailyShift] = useState(null)
  const [dailyShiftLoading, setDailyShiftLoading] = useState(true)
  const [dailyClockInDeadline, setDailyClockInDeadline] = useState('09:00')
  const [dailyClockOutDeadline, setDailyClockOutDeadline] = useState('17:00')
  const [clockingInForDay, setClockingInForDay] = useState(false)
  const [clockInForDayError, setClockInForDayError] = useState('')
  const [clockingOutForDay, setClockingOutForDay] = useState(false)
  const [clockOutForDayError, setClockOutForDayError] = useState('')
  const [earlyLeavePromptOpen, setEarlyLeavePromptOpen] = useState(false)
  const [earlyLeaveReason, setEarlyLeaveReason] = useState('')

  // Clock-in location gate -- same Office/Job/Property/Other choice as
  // BuilderDashboard.jsx's own gate (see add_clock_in_location.sql),
  // extended here so every manager-tier role picks one too, not just
  // builders. Unlike builders (RLS-restricted to properties/jobs they're
  // already on), a manager already has read access to every open ticket
  // and every property, so "A Job"/"A Property" are portfolio-wide lists
  // here rather than deduced from their own assigned jobs.
  const [gateStep, setGateStep] = useState('choose') // choose | pick-job | pick-property | confirm
  const [gateLocationType, setGateLocationType] = useState(null) // 'office' | 'job' | 'property' | 'other'
  const [gateLocationTicketId, setGateLocationTicketId] = useState(null)
  const [gateLocationPropertyId, setGateLocationPropertyId] = useState(null)
  const [gateLocationPropertyAddress, setGateLocationPropertyAddress] = useState('')
  const [gateOtherNote, setGateOtherNote] = useState('')
  const [gateOpenTickets, setGateOpenTickets] = useState(null) // lazy-fetched, null = not yet fetched
  // Resolved label for today's "Clocked in from" display -- a single-row
  // fetch by id rather than keeping a portfolio-wide tickets/properties
  // list loaded just for this, since this shell doesn't otherwise need one.
  const [dailyShiftLocationLabel, setDailyShiftLocationLabel] = useState('')
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false)

  // Property-visit logging (see [[feedback_clocking_vs_logging_terminology]]
  // -- "logging", never "clocking", for a sub-day trip). Reuses
  // pmms.activity_log the exact same way builders' own "Going to Another
  // Job" travel does: an open row means she's away right now, which is
  // what makes her show up as "Away" on Where's the Team in real time.
  //
  // Each trip is a two-phase state machine within ONE row (see
  // add_activity_log_arrived_at.sql), not two chained rows:
  //   started_at -> arrived_at   = travelling (drive time, mileage
  //                                 captured here, same reasoning as a
  //                                 builder's own mileage-on-arrival --
  //                                 the real distance is only known once
  //                                 it's actually driven)
  //   arrived_at -> ended_at     = on site (only for activity_category
  //                                 'visit', i.e. a property -- 'visit_
  //                                 office'/'visit_other' have no on-site
  //                                 phase, arriving just closes the leg)
  // This is what lets hours-travelling, hours-on-site, and visit count
  // all be computed later without guessing. Finishing a property visit
  // re-opens the destination picker immediately (openLeg -> travelPicker)
  // so the next leg starts right away -- Office / Lunch Break / Another
  // Property / Other / (if this is that continuation) done for now with
  // no further leg logged, since going home was never a tracked business
  // trip to begin with, same as a builder's own commute isn't.
  const [openLeg, setOpenLeg] = useState(null)
  const [travelPickerOpen, setTravelPickerOpen] = useState(false)
  const [travelDestType, setTravelDestType] = useState(null) // 'property' | 'other' | null (office/lunch/done fire immediately, no sub-step)
  const [travelShowDoneOption, setTravelShowDoneOption] = useState(false)
  const [travelProperties, setTravelProperties] = useState([])
  const [travelPropertyId, setTravelPropertyId] = useState('')
  const [travelOtherText, setTravelOtherText] = useState('')
  const [travelError, setTravelError] = useState('')
  const [travelSaving, setTravelSaving] = useState(false)
  const [arrivalOpen, setArrivalOpen] = useState(false)
  const [arrivalMiles, setArrivalMiles] = useState(null)
  const [arrivalError, setArrivalError] = useState('')
  const [arrivalSaving, setArrivalSaving] = useState(false)
  const [finishSaving, setFinishSaving] = useState(false)
  const [finishError, setFinishError] = useState('')

  // Keyed on profile.id, not a plain mount-only []  -- View As swaps the
  // Supabase session (and this shell's `profile` prop) onto the
  // impersonated staff member WITHOUT remounting this component (same
  // route, same component instance), so a mount-only effect would only
  // ever fetch whatever identity was active when the page first loaded --
  // the admin's own account, before switching into View As -- and never
  // re-fetch for her. Found live: the "Your Day" card stayed stuck on
  // "Not clocked in" (and Log a Visit stayed hidden, since it's nested
  // inside the same dailyShift-is-set branch) even after she was
  // genuinely clocked in, because this never re-ran for her identity.
  useEffect(() => {
    if (!showsDailyClockingUI) { setDailyShiftLoading(false); return }
    fetchDailyShift()
    fetchOpenLeg()
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'daily_clock_in_deadline').maybeSingle()
      .then(({ data }) => { if (data?.setting_value) setDailyClockInDeadline(data.setting_value) })
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'daily_clock_out_reminder_time').maybeSingle()
      .then(({ data }) => { if (data?.setting_value) setDailyClockOutDeadline(data.setting_value) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id])

  async function fetchDailyShift() {
    const { data } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .select('id, work_date, clock_in_at, late_flag, clock_in_location_type, clock_in_location_ticket_id, clock_in_location_property_id, clock_in_location_note')
      .eq('staff_id', profile.id)
      .is('clock_out_at', null)
      .order('clock_in_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // Same stale-shift rule as BuilderDashboard.jsx: a shift still open
    // from a previous calendar day past stale_shift_hours blocks a fresh
    // clock-in until a manager closes it via AdminClocking's "Clock Out
    // For Them" -- no auto clock-out at this stage (only the same-day,
    // 2-hour-grace cron does that), so an old unresolved shift is never
    // silently guessed at.
    if (data) {
      const { data: thresholdRow } = await supabase
        .schema('pmms').from('settings').select('setting_value')
        .eq('setting_key', 'stale_shift_hours').maybeSingle()
      const thresholdHours = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 16
      const hoursOpen = (Date.now() - new Date(data.clock_in_at).getTime()) / 3600000
      if (data.work_date !== ukDateKey() && hoursOpen >= thresholdHours) {
        setStaleDailyShift(data)
        setDailyShift(null)
        setDailyShiftLoading(false)
        return
      }
    }
    setStaleDailyShift(null)
    setDailyShift(data || null)
    setDailyShiftLoading(false)
  }

  useEffect(() => {
    if (!dailyShift) { setDailyShiftLocationLabel(''); return }
    let cancelled = false
    const t = dailyShift.clock_in_location_type
    if (t === 'office') {
      setDailyShiftLocationLabel('The Office')
    } else if (t === 'other') {
      setDailyShiftLocationLabel(dailyShift.clock_in_location_note || '')
    } else if (t === 'job' && dailyShift.clock_in_location_ticket_id) {
      supabase.schema('pmms').from('tickets').select('ticket_number, property_id').eq('id', dailyShift.clock_in_location_ticket_id).maybeSingle()
        .then(async ({ data }) => {
          if (cancelled || !data) return
          const [withProp] = await attachProperties([data], 'address')
          setDailyShiftLocationLabel(`Job #${data.ticket_number}${withProp?.property?.address ? ' — ' + withProp.property.address : ''}`)
        })
    } else if (t === 'property' && dailyShift.clock_in_location_property_id) {
      supabase.schema('pmms').from('properties').select('address').eq('id', dailyShift.clock_in_location_property_id).maybeSingle()
        .then(({ data }) => { if (!cancelled) setDailyShiftLocationLabel(data?.address || '') })
    } else {
      setDailyShiftLocationLabel('')
    }
    return () => { cancelled = true }
  }, [dailyShift?.id, dailyShift?.clock_in_location_type])

  // Which open tickets to offer under "A Job" -- lazy-fetched (same
  // pattern as openTravelPicker's own travelProperties fetch below) since
  // this is only needed if the gate's "A Job" option is actually picked.
  // Unlike BuilderDashboard.jsx's own gatePropertyOptions (deduced from a
  // builder's own assigned jobs, since builders have no general tickets/
  // properties RLS access), a manager already has read access to every
  // open ticket, so this is portfolio-wide rather than "their own".
  async function fetchGateOpenTickets() {
    if (gateOpenTickets !== null) return
    const { data } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, property_id')
      .not('status', 'in', '("Completed","Archived","Cancelled")')
      .order('ticket_number', { ascending: false })
    const withProps = await attachProperties(data || [], 'address')
    setGateOpenTickets(withProps)
  }

  async function handleDailyClockIn() {
    setClockInForDayError('')
    // An admin clocking in FOR her while impersonating (to test the
    // Clocking page's own card, reachable here since the whole-app gate
    // no longer forces this screen during View As -- see
    // showsDailyClockingUI/requiresDailyClocking above) has no reason to
    // have real GPS signal, or to have picked a location gate step at all
    // (that card has its own plain button, no picker), so this skips both
    // requirements entirely rather than blocking on validation a real
    // clock-in would enforce. A real manager, not impersonated, still goes
    // through the normal GPS + location-choice required path.
    const impersonating = !!getImpersonationMarker()
    if (!impersonating) {
      if (!gateLocationType) { setClockInForDayError('Please choose where you\'re clocking in from.'); return }
      if (gateLocationType === 'other' && !hasMeaningfulNote(gateOtherNote)) { setClockInForDayError('Please describe where you are.'); return }
    }
    setClockingInForDay(true)
    const position = impersonating ? null : await getCurrentPositionSafe()
    if (!position && !impersonating) {
      setClockingInForDay(false)
      setClockInForDayError("Couldn't get your location. Make sure location is turned on and you have signal, then try again.")
      return
    }

    const now = new Date()
    const { data, error } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .insert({
        staff_id: profile.id,
        work_date: ukDateKey(now.getTime()),
        clock_in_at: now.toISOString(),
        clock_in_lat: position?.latitude ?? null,
        clock_in_lng: position?.longitude ?? null,
        late_flag: ukTimeHHMM(now.getTime()) > dailyClockInDeadline,
        clock_in_location_type: gateLocationType,
        clock_in_location_ticket_id: gateLocationType === 'job' ? gateLocationTicketId : null,
        clock_in_location_property_id: gateLocationType === 'property' ? gateLocationPropertyId : null,
        clock_in_location_note: gateLocationType === 'other' ? gateOtherNote.trim() : null,
      })
      .select('id, work_date, clock_in_at, late_flag, clock_in_location_type, clock_in_location_ticket_id, clock_in_location_property_id, clock_in_location_note')
      .single()

    setClockingInForDay(false)
    if (error) { setClockInForDayError(error.message); return }
    setDailyShift(data)
    // Reset the gate for next time (tomorrow's clock-in) -- otherwise a
    // stale pick from today would silently pre-fill the confirm step.
    setGateStep('choose')
    setGateLocationType(null)
    setGateLocationTicketId(null)
    setGateLocationPropertyId(null)
    setGateLocationPropertyAddress('')
    setGateOtherNote('')
  }

  async function fetchOpenLeg() {
    const { data } = await supabase
      .schema('pmms')
      .from('activity_log')
      .select('id, activity_category, note, started_at, arrived_at, destination_property_id')
      .eq('staff_id', profile.id)
      .in('activity_category', ['visit', 'visit_office', 'visit_other', 'lunch'])
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setOpenLeg(data || null)
  }

  // Reuses travelProperties/setTravelProperties (Log a Visit's own property
  // list, same portfolio-wide fetch) for the clock-in gate's "A Property"
  // step too, rather than a second identical query.
  async function fetchGateProperties() {
    if (travelProperties.length === 0) {
      const { data } = await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability').order('address')
      setTravelProperties(data || [])
    }
  }

  // showDone: whether this picker is a continuation right after Finishing
  // a Visit (adds a 5th "done for now" choice) vs a fresh open from the
  // baseline Start Travel button (just the 4 real destination types).
  async function openTravelPicker(showDone) {
    setTravelError('')
    setTravelDestType(null)
    setTravelPropertyId('')
    setTravelOtherText('')
    setTravelShowDoneOption(!!showDone)
    setTravelPickerOpen(true)
    if (travelProperties.length === 0) {
      const { data } = await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability').order('address')
      setTravelProperties(data || [])
    }
  }

  function closeTravelPicker() {
    setTravelPickerOpen(false)
  }

  async function startTravelLeg(category, destinationPropertyId, label) {
    setTravelError('')
    setTravelSaving(true)
    const payload = {
      staff_id: profile.id,
      activity_type: category === 'lunch' ? 'Break' : 'Travel',
      activity_category: category,
      started_at: new Date().toISOString(),
    }
    if (category !== 'lunch') { payload.destination_property_id = destinationPropertyId; payload.note = label }
    const { data, error } = await supabase
      .schema('pmms')
      .from('activity_log')
      .insert(payload)
      .select('id, activity_category, note, started_at, arrived_at, destination_property_id')
      .single()

    setTravelSaving(false)
    if (error) { setTravelError(error.message); return }
    setOpenLeg(data)
    setTravelPickerOpen(false)
  }

  // Office/Lunch/Done need no further input, so they fire immediately on
  // tap -- Property/Other reveal a sub-step (search box or free-text
  // input) below and wait for an explicit Start Travel tap instead.
  function chooseDestType(type) {
    setTravelError('')
    if (type === 'office') { startTravelLeg('visit_office', null, 'the office'); return }
    if (type === 'lunch') { startTravelLeg('lunch', null, null); return }
    if (type === 'done') { setTravelPickerOpen(false); return }
    setTravelDestType(type)
  }

  async function confirmTravelSubStep() {
    if (travelDestType === 'property') {
      const p = travelProperties.find(x => String(x.id) === travelPropertyId)
      if (!p) { setTravelError('Pick a property.'); return }
      await startTravelLeg('visit', p.id, p.address)
    } else if (travelDestType === 'other') {
      const text = travelOtherText.trim()
      if (!text) { setTravelError("Enter where you're heading."); return }
      await startTravelLeg('visit_other', null, text)
    }
  }

  function openArrival() {
    setArrivalMiles(null)
    setArrivalError('')
    setArrivalOpen(true)
  }

  // Property destinations only close the TRAVEL phase here (arrived_at
  // set, ended_at stays null) and move into the on-site phase -- Office/
  // Other have no on-site phase, so arriving closes the whole leg.
  async function submitArrival() {
    if (arrivalMiles === null) { setArrivalError("Enter miles driven, or 0 if you didn't drive."); return }
    setArrivalError('')
    setArrivalSaving(true)
    const isProperty = openLeg.activity_category === 'visit'
    const now = new Date().toISOString()
    const update = isProperty
      ? { arrived_at: now, mileage_logged: arrivalMiles }
      : { arrived_at: now, ended_at: now, mileage_logged: arrivalMiles }
    const { data, error } = await supabase
      .schema('pmms')
      .from('activity_log')
      .update(update)
      .eq('id', openLeg.id)
      .select('id, activity_category, note, started_at, arrived_at, destination_property_id')
      .single()

    setArrivalSaving(false)
    if (error) { setArrivalError(error.message); return }
    setArrivalOpen(false)
    setOpenLeg(isProperty ? data : null)
  }

  // Mileage was already captured on arrival -- this just closes the
  // on-site phase and hands straight into the destination picker for
  // whatever's next, per the flow the user asked for.
  async function handleFinishVisit() {
    setFinishError('')
    setFinishSaving(true)
    const { error } = await supabase.schema('pmms').from('activity_log').update({ ended_at: new Date().toISOString() }).eq('id', openLeg.id)
    setFinishSaving(false)
    if (error) { setFinishError(error.message); return }
    setOpenLeg(null)
    openTravelPicker(true)
  }

  async function handleBackFromLunch() {
    setFinishError('')
    const { error } = await supabase.schema('pmms').from('activity_log').update({ ended_at: new Date().toISOString() }).eq('id', openLeg.id)
    if (error) { setFinishError(error.message); return }
    setOpenLeg(null)
  }

  function attemptDailyClockOut() {
    setClockOutForDayError('')
    if (openLeg) { setClockOutForDayError('Finish logging your current trip before clocking out for the day.'); return }
    if (ukTimeHHMM() < dailyClockOutDeadline) {
      setEarlyLeaveReason('')
      setEarlyLeavePromptOpen(true)
      return
    }
    setClockOutConfirmOpen(true)
  }

  function submitEarlyLeaveDaily() {
    if (!earlyLeaveReason.trim()) { setClockOutForDayError('Please give a reason for finishing early.'); return }
    submitDailyClockOut(earlyLeaveReason.trim())
  }

  async function submitDailyClockOut(earlyReason) {
    setClockOutForDayError('')
    setClockingOutForDay(true)
    const position = await getCurrentPositionSafe()

    const { error } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .update({
        clock_out_at: new Date().toISOString(),
        clock_out_lat: position?.latitude ?? null,
        clock_out_lng: position?.longitude ?? null,
        ...(earlyReason ? { early_leave_reason: earlyReason } : {}),
      })
      .eq('id', dailyShift.id)

    setClockingOutForDay(false)
    if (error) { setClockOutForDayError(error.message); return }
    setEarlyLeavePromptOpen(false)
    setClockOutConfirmOpen(false)
    setDailyShift(null)
  }

  useEffect(() => {
    // Permission alone doesn't mean a subscription actually exists (a
    // browser can report "granted" with nothing ever subscribed) -- this
    // is the real check for whether the button should offer to enable.
    hasActivePushSubscription().then(setPushEnabled)
  }, [])

  async function handleEnableNotifications() {
    setPushError('')
    const result = await enablePushNotifications(profile.id)
    if (!result.success) { setPushError(result.message); return }
    setPushEnabled(true)
  }

  const fetchPendingSignOffCount = useCallback(async () => {
    // Matches AdminSignOff.jsx's own raiser-only rule -- only tickets THIS
    // person raised are theirs to sign off, so the badge should only ever
    // count what they'd actually see on that page. Admins never raise
    // tickets, so this is always 0 for them (they get the read-only
    // oversight table instead, which isn't an action queue).
    const { count } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Completed')
      .eq('raised_by', profile.id)

    setPendingSignOffCount(count || 0)
  }, [profile.id])

  // Actionable-for-THIS-viewer count, matching Sign-Off's badge convention
  // (a queue of things they'd act on, not a global total) -- what counts as
  // "actionable" differs by which of the two roles this nav item is for:
  // properties ready to walk for the Maintenance Assistant, or properties
  // waiting on her review for Landlord Liaison. Skipped entirely for
  // everyone else (the nav item itself is invisible to them, see
  // isNavItemVisible's visibleTo check) so this doesn't run a wasted query
  // for every other admin/manager on every poll.
  const fetchOnboardActionCount = useCallback(async () => {
    if (profile.pmmsRole === 'Maintenance Assistant') {
      const { toWalkIds } = await fetchOnboardingMetrics()
      setOnboardActionCount(toWalkIds.size)
    } else if (profile.division === 'Landlord Liaison') {
      const { count } = await supabase
        .schema('pmms')
        .from('property_onboarding_walks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_liaison_review')
      setOnboardActionCount(count || 0)
    } else {
      setOnboardActionCount(0)
    }
  }, [profile.pmmsRole, profile.division])

  const fetchTotalTicketsCount = useCallback(async () => {
    const { count } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id', { count: 'exact', head: true })

    setTotalTicketsCount(count || 0)
  }, [])

  const fetchChatUnreadTotal = useCallback(async () => {
    const divs = profile.division ? [profile.division] : await fetchDivisions()
    const [channelCounts, dmCount] = await Promise.all([
      Promise.all(divs.map(d => countUnreadMessages(d, profile.id))),
      countUnreadDms(profile.id),
    ])
    setChatUnreadTotal(channelCounts.reduce((a, b) => a + b, 0) + dmCount)
  }, [profile.division, profile.id])

  const refreshCounts = useCallback(async () => {
    await Promise.all([fetchPendingSignOffCount(), fetchTotalTicketsCount(), fetchChatUnreadTotal(), fetchOnboardActionCount()])
  }, [fetchPendingSignOffCount, fetchTotalTicketsCount, fetchChatUnreadTotal, fetchOnboardActionCount])

  useEffect(() => {
    refreshCounts()
    const interval = setInterval(refreshCounts, PENDING_SIGN_OFF_POLL_MS)
    return () => clearInterval(interval)
  }, [refreshCounts])

  async function handleSignOut() {
    // Logged here, before signOut() -- by the time the auth listener sees
    // the session go away, the token's already cleared and an insert from
    // there has no valid credentials (confirmed live: silent 401).
    await logLoginEvent(profile, profile.email, 'Signed Out')
    await supabase.auth.signOut()
  }

  function goToPage(key, opts = {}) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('page', key)
      return next
    }, { replace: true })
    setSidebarOpen(false)
    // Always decided fresh per call -- every navigation either carries its
    // own returnTo or it doesn't, never inherited from whatever the last
    // one happened to set.
    setReturnTo(opts.returnTo || null)
    if (key === 'clocking' && opts.reopenHistory) {
      setClockingInitialReopenHistory(opts.reopenHistory)
    }
    if (key === 'pipeline' && opts.statusFilter) {
      setPipelineInitialFilter(opts.statusFilter)
    }
    if (key === 'pipeline' && opts.priorityFilter) {
      setPipelineInitialPriorityFilter(opts.priorityFilter)
    }
    if (key === 'pipeline' && opts.stuckOnly) {
      setPipelineInitialStuckFilter(true)
    }
    if (key === 'pipeline' && opts.needsFollowupOnly) {
      setPipelineInitialNeedsFollowupFilter(true)
    }
    if (key === 'pipeline' && opts.ticketNumber) {
      setPipelineInitialTicketNumber(opts.ticketNumber)
    }
    if (key === 'pipeline' && opts.category) {
      setPipelineInitialCategory(opts.category)
    }
    if (key === 'pipeline' && opts.division) {
      setPipelineInitialDivision(opts.division)
    }
    if (key === 'pipeline' && opts.builderId) {
      setPipelineInitialBuilder(opts.builderId)
    }
    if (key === 'pipeline' && opts.propertyId) {
      setPipelineInitialProperty(opts.propertyId)
    }
    if (key === 'pipeline' && opts.fromDate) {
      setPipelineInitialFromDate(opts.fromDate)
    }
    if (key === 'pipeline' && opts.toDate) {
      setPipelineInitialToDate(opts.toDate)
    }
    if (key === 'properties' && opts.filterMode) {
      setPropertiesInitialFilter({ mode: opts.filterMode })
    }
    if (key === 'properties' && opts.propertyId) {
      setPropertiesInitialFilter({ propertyId: opts.propertyId, tab: opts.tab })
    }
    if (key === 'compliance' && opts.tierFilter) {
      setComplianceInitialTierFilter(opts.tierFilter)
    }
    if (key === 'voids' && opts.tierFilter) {
      setVoidsInitialTierFilter(opts.tierFilter)
    }
    if (key === 'builders' && opts.staffId) {
      setBuildersInitialStaffId(opts.staffId)
    }
    if (key === 'property-dimensions' && opts.propertyId) {
      setDimensionsInitialPropertyId(opts.propertyId)
    }
  }

  const navButtonStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '6px 12px', marginBottom: '1px',
    borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: 'clamp(12.5px, 1vw, 14px)', fontWeight: active ? 700 : 400,
    background: active ? COLORS.greenDark : 'transparent', color: COLORS.white, fontFamily: 'inherit',
  })
  const navIconStyle = { width: '18px', flexShrink: 0, textAlign: 'center', fontSize: '14px', lineHeight: 1 }

  // A real nested component, instantiated twice (desktop sidebar + mobile
  // drawer, below) -- React gives each JSX usage its own hook state, so
  // popoverOpen/popoverRef/triggerRef are automatically independent between
  // the two without any extra work. allowCollapse is true only for the
  // desktop instance -- see sidebarCollapsed's own comment above.
  function SidebarContent({ allowCollapse = false }) {
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [returning, setReturning] = useState(false)
    // Which parent-with-children nav items (AI Trial, Quick Guide) are
    // currently expanded, keyed by item.key -- a Set rather than one
    // boolean per group, since either could be independently open/closed.
    // Lazy-initialized so reopening the sidebar while already on a child
    // page doesn't collapse the section you're currently in.
    const [openGroups, setOpenGroups] = useState(() => new Set(
      NAV_ITEMS.filter(item => item.children?.some(c => c.key === currentPage)).map(item => item.key)
    ))
    const isCollapsed = allowCollapse && sidebarCollapsed
    const impersonationMarker = getImpersonationMarker()
    const popoverRef = useRef(null)

    // Collapsed-rail hover labels render via portal to document.body --
    // the nav list scrolls (overflow-y: auto) which forces overflow-x to
    // clip too, so a tooltip positioned inside it as a plain absolute child
    // never actually became visible. alignBottom is for the profile
    // trigger at the very bottom of the rail, where the label should hang
    // off the bottom edge rather than centering on a element near the
    // bottom of the screen.
    const [hoverTip, setHoverTip] = useState(null)
    function showTip(e, label, alignBottom = false) {
      if (!isCollapsed) return
      const rect = e.currentTarget.getBoundingClientRect()
      setHoverTip(alignBottom
        ? { label, left: rect.right + 10, bottom: window.innerHeight - rect.bottom, alignBottom: true }
        : { label, left: rect.right + 10, top: rect.top + rect.height / 2, alignBottom: false })
    }
    function hideTip() { setHoverTip(null) }

    function handleNavItemClick(item) {
      if (item.children) {
        if (isCollapsed) {
          setSidebarCollapsed(false)
          setOpenGroups(prev => new Set(prev).add(item.key))
        } else {
          setOpenGroups(prev => {
            const next = new Set(prev)
            if (next.has(item.key)) next.delete(item.key)
            else next.add(item.key)
            return next
          })
        }
      } else {
        goToPage(item.key)
      }
    }

    async function handleReturnToAdmin() {
      setReturning(true)
      await returnToAdmin()
      // App.jsx's onAuthStateChange (SIGNED_IN, suppressed) resolves the
      // admin's own profile again; routing redirects to /admin on its own.
    }
    const triggerRef = useRef(null)

    // Same click-outside pattern as PropertySearchSelect.jsx.
    useEffect(() => {
      function handleClickOutside(e) {
        if (popoverRef.current?.contains(e.target)) return
        if (triggerRef.current?.contains(e.target)) return
        setPopoverOpen(false)
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    const mainNavItems = NAV_ITEMS.filter(item => !POPOVER_ITEM_KEYS.includes(item.key) && isNavItemVisible(item, profile))
    const popoverItems = NAV_ITEMS.filter(item => POPOVER_ITEM_KEYS.includes(item.key) && isNavItemVisible(item, profile))

    function handlePopoverNav(key) {
      setPopoverOpen(false)
      goToPage(key)
    }

    async function handlePopoverSignOut() {
      setPopoverOpen(false)
      await handleSignOut()
    }

    return (
      <>
        {allowCollapse && (
          <button
            onClick={toggleSidebarCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              position: 'absolute', top: '50%', right: '-12px', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%',
              background: COLORS.brandNavy, border: `1px solid rgba(255,255,255,0.18)`, boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: COLORS.white, zIndex: 10,
            }}
          >
            <span style={{ display: 'flex', transform: isCollapsed ? 'rotate(180deg)' : 'none' }}>
              <NavIcon name="chevronLeft" size={13} />
            </span>
          </button>
        )}

        <button
          onClick={() => goToPage('dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '16px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.1)', width: '100%', textAlign: 'left', justifyContent: isCollapsed ? 'center' : 'flex-start' }}
        >
          <img src={gbchLogo} alt="GBCH" style={{ height: '32px', flexShrink: 0 }} />
          {!isCollapsed && <span style={{ fontSize: 'clamp(13px, 1.1vw, 15px)', fontWeight: 800, color: COLORS.white, whiteSpace: 'nowrap' }}>PMMS</span>}
        </button>

        {!isCollapsed && impersonationMarker && (
          <div style={{ padding: '10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <p style={{ margin: '0 0 6px', fontSize: '12px', color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
              Viewing as {impersonationMarker.targetName}
            </p>
            <button
              onClick={handleReturnToAdmin}
              disabled={returning}
              style={{
                width: '100%', background: COLORS.amber700, color: COLORS.white, border: 'none', borderRadius: '8px',
                padding: '8px 12px', fontSize: '13px', fontWeight: 700, cursor: returning ? 'default' : 'pointer',
              }}
            >
              {returning ? 'Returning…' : 'Return to my account'}
            </button>
          </div>
        )}

        <nav className="pmms-sidebar-nav" style={{ flex: 1, padding: '8px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
          {mainNavItems.map(item => {
            // Collapsed mode drops full count badges for a small corner dot
            // instead -- "something here needs attention," without the
            // space a 2-digit number badge would need on a 40px-wide rail.
            const alertCount = item.key === 'sign-off' ? pendingSignOffCount
              : item.key === 'pipeline' ? totalTicketsCount
              : item.key === 'team-chat' ? chatUnreadTotal
              : item.key === 'onboard-property' ? onboardActionCount
              : 0

            return (
              <Fragment key={item.key}>
                {item.children ? (
                  <>
                    <div onMouseEnter={(e) => showTip(e, item.label)} onMouseLeave={hideTip}>
                      <button
                        onClick={() => handleNavItemClick(item)}
                        style={{ ...navButtonStyle(item.children.some(c => c.key === currentPage)), justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '8px 0' : '6px 12px' }}
                      >
                        <span style={navIconStyle}><NavIcon name={item.icon} /></span>
                        {!isCollapsed && (
                          <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', transform: openGroups.has(item.key) ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>▶</span>
                          </span>
                        )}
                      </button>
                    </div>
                    {openGroups.has(item.key) && !isCollapsed && item.children.filter(child => isNavItemVisible(child, profile)).map(child => (
                      <button
                        key={child.key}
                        onClick={() => goToPage(child.key)}
                        style={{ ...navButtonStyle(currentPage === child.key), paddingLeft: '34px', fontSize: 'clamp(11.5px, 0.9vw, 13px)' }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.label}</span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div onMouseEnter={(e) => showTip(e, item.label)} onMouseLeave={hideTip}>
                    <button
                      onClick={() => goToPage(item.key)}
                      style={{ ...navButtonStyle(currentPage === item.key), justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '8px 0' : '6px 12px' }}
                    >
                      <span style={{ ...navIconStyle, position: 'relative' }}>
                        <NavIcon name={item.icon} />
                        {isCollapsed && alertCount > 0 && (
                          <span style={{ position: 'absolute', top: '-3px', right: '-1px', width: '8px', height: '8px', borderRadius: '50%', background: COLORS.red600, border: `1.5px solid ${COLORS.brandNavy}` }} />
                        )}
                      </span>
                      {!isCollapsed && (
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                          {alertCount > 0 && (
                            <span
                              style={{
                                background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
                                borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center', flexShrink: 0,
                              }}
                            >
                              {alertCount}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {DIVIDER_AFTER_KEYS.includes(item.key) && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '4px 4px' }} />
                )}
              </Fragment>
            )
          })}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
          {popoverOpen && (
            <div
              ref={popoverRef}
              style={isCollapsed ? {
                // Flyout to the right instead of stretching across the
                // 64px rail, which is too narrow for the item list.
                position: 'absolute', left: '60px', bottom: '16px', width: '200px',
                background: COLORS.brandNavyPanel, border: '1px solid rgba(255,255,255,0.16)', borderRadius: '10px',
                padding: '6px', boxShadow: '0 12px 28px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', zIndex: 30,
              } : {
                position: 'absolute', left: '16px', right: '16px', bottom: 'calc(100% + 8px)',
                background: COLORS.brandNavyPanel, border: '1px solid rgba(255,255,255,0.16)', borderRadius: '10px',
                padding: '6px', boxShadow: '0 12px 28px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', zIndex: 30,
              }}
            >
              {popoverItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => handlePopoverNav(item.key)}
                  style={navButtonStyle(currentPage === item.key)}
                >
                  <span style={navIconStyle}><NavIcon name={item.icon} /></span>
                  <span>{item.label}</span>
                </button>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.16)', margin: '4px 6px' }} />
              <button onClick={handlePopoverSignOut} style={navButtonStyle(false)}>
                <span style={navIconStyle}><NavIcon name="logout" /></span>
                <span>Sign out</span>
              </button>
            </div>
          )}

          <div onMouseEnter={(e) => showTip(e, profile.name, true)} onMouseLeave={hideTip}>
            <button
              ref={triggerRef}
              onClick={() => setPopoverOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', padding: '4px', margin: '-4px -4px 10px -4px', borderRadius: '8px', cursor: 'pointer', textAlign: isCollapsed ? 'center' : 'left', fontFamily: 'inherit', justifyContent: isCollapsed ? 'center' : 'flex-start' }}
            >
              {resolveStaffPhotoUrl(profile.photo_url) ? (
                <img src={resolveStaffPhotoUrl(profile.photo_url)} alt="" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: COLORS.white, fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {(profile.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
                </div>
              )}
              {!isCollapsed && (
                <>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</p>
                    <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.job_title}</p>
                  </div>
                  <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.6)', fontSize: '11px', transform: popoverOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▲</span>
                </>
              )}
            </button>
          </div>

          {!isCollapsed && pushNotificationsSupported() && (
            <button
              onClick={handleEnableNotifications}
              disabled={pushEnabled}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.1)', color: pushEnabled ? 'rgba(255,255,255,0.5)' : COLORS.white, fontWeight: 700, fontSize: '13px', cursor: pushEnabled ? 'default' : 'pointer' }}
            >
              🔔 {pushEnabled ? 'Notifications: On' : 'Enable Notifications'}
            </button>
          )}
          {!isCollapsed && pushError && <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: COLORS.red300 }}>{pushError}</p>}
        </div>

        {hoverTip && createPortal(
          <div
            style={{
              position: 'fixed', left: `${hoverTip.left}px`,
              top: hoverTip.alignBottom ? 'auto' : `${hoverTip.top}px`,
              bottom: hoverTip.alignBottom ? `${hoverTip.bottom}px` : 'auto',
              transform: hoverTip.alignBottom ? 'none' : 'translateY(-50%)',
              background: COLORS.brandNavy, color: COLORS.white, fontSize: '12px', fontWeight: 600,
              padding: '6px 10px', borderRadius: '6px', whiteSpace: 'nowrap',
              boxShadow: '0 4px 14px rgba(0,0,0,0.25)', pointerEvents: 'none', zIndex: 9999,
            }}
          >
            {hoverTip.label}
          </div>,
          document.body
        )}
      </>
    )
  }

  // Defense in depth: even though the nav button for admin-only pages is
  // hidden for non-admins, this guards against currentPage ever landing on
  // one some other way (there's no URL-based deep link into these pages
  // today, but the check is cheap and this is a security-adjacent feature).
  // Searches one level of children too, for the AI Trial submenu items.
  const activeNavItem = NAV_ITEMS.find(item => item.key === currentPage)
    || NAV_ITEMS.flatMap(item => item.children || []).find(child => child.key === currentPage)
  const ActivePage = (activeNavItem && isNavItemVisible(activeNavItem, profile))
    ? activeNavItem.Component
    : AdminDashboardPage

  // Gates the whole app -- no sidebar, no pages, nothing -- until she
  // clocks in for the day. Same all-or-nothing rule BuilderDashboard.jsx
  // already applies to builders, just at the shell level here since a
  // manager's "day" isn't scoped to any one page.
  if (requiresDailyClocking) {
    if (dailyShiftLoading) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100 }}>
          <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui, sans-serif' }}>Loading...</p>
        </div>
      )
    }
    if (staleDailyShift) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '360px', background: COLORS.white, borderRadius: '20px', padding: '28px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
            <img src={gbchLogo} alt="GBCH" style={{ height: '44px', marginBottom: '16px' }} />
            <p style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: COLORS.amber800 }}>⚠ Waiting on your manager</p>
            <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate600, lineHeight: 1.5 }}>
              Your shift from {formatUKDate(staleDailyShift.work_date)} (clocked in {formatUKDateTime(staleDailyShift.clock_in_at)}) was never closed out. A manager's been notified and needs to close it before you can clock in today.
            </p>
            <button onClick={fetchDailyShift} style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
              Check again
            </button>
            <button onClick={handleSignOut} style={{ marginTop: '18px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>
              Sign out
            </button>
          </div>
        </div>
      )
    }
    if (!dailyShift) {
      const greeting = <>
        <p style={{ fontSize: '13px', fontWeight: 800, color: COLORS.teal700, letterSpacing: '0.08em', textTransform: 'uppercase', margin: '0 0 16px' }}>GBCH PMMS</p>
        <h1 style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {profile.name.split(' ')[0]}</h1>
      </>

      let inner
      if (gateStep === 'pick-job') {
        inner = (
          <>
            {greeting}
            <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>Which job?</p>
            {gateOpenTickets === null ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Loading open jobs...</p>
            ) : gateOpenTickets.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No open jobs to pick from.</p>
            ) : (
              <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', overflow: 'hidden', background: COLORS.white, textAlign: 'left', maxHeight: '280px', overflowY: 'auto' }}>
                {gateOpenTickets.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => { setGateLocationTicketId(t.id); setGateStep('confirm') }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: i < gateOpenTickets.length - 1 ? `1px solid ${COLORS.slate200}` : 'none', background: COLORS.white, cursor: 'pointer' }}
                  >
                    <span style={{ display: 'block', fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#{t.ticket_number} · {t.category}</span>
                    <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 800, color: COLORS.slate900, marginTop: '2px' }}>{t.property?.address}</span>
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
          </>
        )
      } else if (gateStep === 'pick-property') {
        inner = (
          <>
            {greeting}
            <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>Which property?</p>
            {travelProperties.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>Loading properties...</p>
            ) : (
              <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', overflow: 'hidden', background: COLORS.white, textAlign: 'left', maxHeight: '280px', overflowY: 'auto' }}>
                {travelProperties.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => { setGateLocationPropertyId(p.id); setGateLocationPropertyAddress(p.address); setGateStep('confirm') }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: i < travelProperties.length - 1 ? `1px solid ${COLORS.slate200}` : 'none', background: COLORS.white, cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}
                  >
                    {p.address}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
          </>
        )
      } else if (gateStep === 'confirm') {
        const isOther = gateLocationType === 'other'
        const label = gateLocationType === 'office' ? 'The Office'
          : gateLocationType === 'job' ? (() => { const t = (gateOpenTickets || []).find(x => x.id === gateLocationTicketId); return t ? `Job #${t.ticket_number} — ${t.property?.address}` : 'A Job' })()
          : gateLocationType === 'property' ? gateLocationPropertyAddress
          : 'Other'
        inner = (
          <>
            {greeting}
            <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px 14px', margin: '0 0 16px 0', textAlign: 'left' }}>
              <p style={{ margin: 0, fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clocking in from</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>{label}</p>
            </div>
            {isOther && (
              <input
                type="text"
                autoFocus
                value={gateOtherNote}
                onChange={(e) => setGateOtherNote(e.target.value)}
                placeholder="Describe where you are..."
                style={{ width: '100%', padding: '13px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '16px' }}
              />
            )}
            <button
              onClick={handleDailyClockIn}
              disabled={clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))}
              style={{ width: '100%', padding: '16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: (clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))) ? 'not-allowed' : 'pointer', opacity: (clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))) ? 0.7 : 1 }}
            >
              {clockingInForDay ? 'Getting your location…' : '✓ Clock In for the Day'}
            </button>
            {clockInForDayError && <p style={{ margin: '12px 0 0 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInForDayError}</p>}
            <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
          </>
        )
      } else {
        inner = (
          <>
            {greeting}
            <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: COLORS.slate500, lineHeight: 1.5 }}>Where are you clocking in from?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { type: 'office', label: '🏢 The Office' },
                { type: 'job', label: '🔧 A Job' },
                { type: 'property', label: '🏘️ A Property' },
                { type: 'other', label: '📍 Other' },
              ].map(o => (
                <button
                  key={o.type}
                  onClick={() => {
                    setGateLocationType(o.type)
                    if (o.type === 'job') { fetchGateOpenTickets(); setGateStep('pick-job') }
                    else if (o.type === 'property') { fetchGateProperties(); setGateStep('pick-property') }
                    else setGateStep('confirm')
                  }}
                  style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, boxSizing: 'border-box' }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {clockInForDayError && <p style={{ margin: '12px 0 0 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInForDayError}</p>}
            <button onClick={handleSignOut} style={{ marginTop: '18px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>
              Sign out
            </button>
          </>
        )
      }

      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
          <div style={{ width: '100%', maxWidth: '380px', background: COLORS.white, borderRadius: '20px', padding: '28px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
            {inner}
          </div>
        </div>
      )
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif' }}>

      {/* Desktop sidebar */}
      <div
        className="admin-sidebar-desktop"
        style={{
          width: sidebarCollapsed ? '64px' : 'clamp(180px, 15vw, 240px)', minWidth: sidebarCollapsed ? '64px' : '180px',
          background: COLORS.brandNavy, display: 'flex', flexDirection: 'column', position: 'sticky',
          top: 'var(--pmms-banner-offset, 0px)', height: 'calc(100vh - var(--pmms-banner-offset, 0px))',
          transition: 'width 0.2s ease, min-width 0.2s ease',
        }}
      >
        <SidebarContent allowCollapse />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingTop: 'var(--pmms-banner-offset, 0px)' }}>

        {/* Mobile top bar */}
        <div
          className="admin-mobile-topbar"
          style={{ alignItems: 'center', justifyContent: 'space-between', background: COLORS.brandNavy, padding: '14px 16px', position: 'sticky', top: 'var(--pmms-banner-offset, 0px)', zIndex: 20 }}
        >
          <button
            onClick={() => goToPage('dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <img src={gbchLogo} alt="GBCH" style={{ height: '28px' }} />
            <span style={{ color: COLORS.white, fontWeight: 800, fontSize: '14px' }}>PMMS</span>
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
          >
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
          </button>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: '20px', width: '100%', boxSizing: 'border-box' }}>
          {showsDailyClockingUI && currentPage === 'clocking' && !dailyShiftLoading && !dailyShift && (
            <div style={{ marginBottom: '16px', padding: '14px 16px', borderRadius: '12px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}` }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Day</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate600 }}>Not clocked in for today yet.</span>
                <button
                  onClick={handleDailyClockIn}
                  disabled={clockingInForDay}
                  style={{ padding: '7px 12px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: clockingInForDay ? 'not-allowed' : 'pointer', opacity: clockingInForDay ? 0.7 : 1 }}
                >
                  {clockingInForDay ? 'Clocking in…' : '✓ Clock In for the Day'}
                </button>
              </div>
              {clockInForDayError && <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{clockInForDayError}</p>}
            </div>
          )}
          {showsDailyClockingUI && dailyShift && currentPage === 'clocking' && (
            <div style={{ marginBottom: '16px', padding: '14px 16px', borderRadius: '12px', background: dailyShift.late_flag ? COLORS.amber50 : COLORS.slate50, border: `1px solid ${dailyShift.late_flag ? COLORS.amber300 : COLORS.slate200}` }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Your Day</p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: dailyShift.late_flag ? COLORS.amber900 : COLORS.slate600 }}>
                  {dailyShift.late_flag ? '⚠ ' : '🟢 '}Clocked in since {formatUKDateTime(dailyShift.clock_in_at).split(' ').slice(-1)[0]}
                  {dailyShiftLocationLabel && ` — ${dailyShiftLocationLabel}`}
                  {dailyShift.late_flag && ` (${minutesLate(dailyShift.clock_in_at, dailyClockInDeadline)}m late)`}
                </span>
                <button
                  onClick={attemptDailyClockOut}
                  disabled={clockingOutForDay}
                  style={{ padding: '6px 4px', background: 'none', color: COLORS.slate500, border: 'none', fontSize: '12px', fontWeight: 700, textDecoration: 'underline', cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
                >
                  {clockingOutForDay ? 'Clocking out…' : 'Clock Out for the Day'}
                </button>
              </div>
              {clockOutForDayError && <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{clockOutForDayError}</p>}

              {/* Travel/visit logging -- see [[feedback_clocking_vs_logging_terminology]].
                  Each trip is a two-phase row: travelling (started_at ->
                  arrived_at, mileage captured on arrival) then, for a
                  property, on site (arrived_at -> ended_at). Finishing a
                  visit re-opens this same picker for whatever's next. */}
              <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${dailyShift.late_flag ? COLORS.amber200 : COLORS.slate200}` }}>
                {openLeg ? (
                  openLeg.activity_category === 'lunch' ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.violet600 }}>
                        🍽 On lunch break since {formatUKDateTime(openLeg.started_at).split(' ').slice(-1)[0]}
                      </span>
                      <button
                        onClick={handleBackFromLunch}
                        style={{ padding: '7px 12px', background: COLORS.blue600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✓ Back from Lunch
                      </button>
                    </div>
                  ) : openLeg.activity_category === 'visit' && openLeg.arrived_at ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.blue700 }}>
                        📍 At {openLeg.note} since {formatUKDateTime(openLeg.arrived_at).split(' ').slice(-1)[0]}
                      </span>
                      <button
                        onClick={handleFinishVisit}
                        disabled={finishSaving}
                        style={{ padding: '7px 12px', background: COLORS.blue600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: finishSaving ? 'not-allowed' : 'pointer', opacity: finishSaving ? 0.7 : 1 }}
                      >
                        {finishSaving ? 'Finishing…' : '✓ Finished Visit'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.blue700 }}>
                        🚗 Travelling — heading to {openLeg.note} since {formatUKDateTime(openLeg.started_at).split(' ').slice(-1)[0]}
                      </span>
                      <button
                        onClick={openArrival}
                        style={{ padding: '7px 12px', background: COLORS.blue600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        ✓ Arrived
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    onClick={() => openTravelPicker(false)}
                    style={{ padding: '7px 12px', background: COLORS.white, color: COLORS.blue700, border: `1px solid ${COLORS.blue200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                  >
                    🚗 Start Travel
                  </button>
                )}
                {finishError && <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{finishError}</p>}

                {arrivalOpen && (
                  <div style={{ marginTop: '10px', background: COLORS.white, border: `1px solid ${COLORS.slate300}`, borderRadius: '12px', padding: '14px' }}>
                    <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Miles driven for this trip</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
                      <button
                        onClick={() => setArrivalMiles(m => Math.max(0, (m ?? 0) - 0.5))}
                        style={{ width: '36px', height: '36px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        step="0.5"
                        value={arrivalMiles ?? ''}
                        onChange={(e) => setArrivalMiles(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                        style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '8px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '15px', fontWeight: 700, boxSizing: 'border-box' }}
                      />
                      <button
                        onClick={() => setArrivalMiles(m => (m ?? 0) + 0.5)}
                        style={{ width: '36px', height: '36px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '16px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                      >
                        +
                      </button>
                    </div>
                    {arrivalError && <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{arrivalError}</p>}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <button onClick={() => setArrivalOpen(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button
                        onClick={submitArrival}
                        disabled={arrivalSaving}
                        style={{ flex: 2, padding: '10px', background: COLORS.blue600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: arrivalSaving ? 'not-allowed' : 'pointer', opacity: arrivalSaving ? 0.7 : 1 }}
                      >
                        {arrivalSaving ? 'Saving…' : 'Confirm Arrival'}
                      </button>
                    </div>
                  </div>
                )}

                {travelPickerOpen && (
                  <div style={{ marginTop: '10px', background: COLORS.white, border: `1px solid ${COLORS.slate300}`, borderRadius: '12px', padding: '14px' }}>
                    <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Where are you heading?</p>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {[
                        ['property', '📍 A Property'],
                        ['office', '🏢 The Office'],
                        ['lunch', '🍽 Lunch Break'],
                        ['other', '✏️ Other'],
                        ...(travelShowDoneOption ? [['done', '✓ Nothing else — done for now']] : []),
                      ].map(([type, label]) => (
                        <button
                          key={type}
                          onClick={() => chooseDestType(type)}
                          disabled={travelSaving}
                          style={{
                            padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 700,
                            cursor: travelSaving ? 'not-allowed' : 'pointer',
                            background: travelDestType === type ? COLORS.blue600 : COLORS.white,
                            color: travelDestType === type ? COLORS.white : COLORS.slate600,
                            border: `1px solid ${travelDestType === type ? COLORS.blue600 : COLORS.slate200}`,
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {travelDestType === 'property' && (
                      <div style={{ marginTop: '10px' }}>
                        <Suspense fallback={<div style={{ height: '44px', borderRadius: '10px', background: COLORS.slate100 }} />}>
                          <PropertySearchSelect
                            properties={travelProperties}
                            value={travelPropertyId}
                            onChange={setTravelPropertyId}
                            placeholder="Search properties..."
                          />
                        </Suspense>
                      </div>
                    )}
                    {travelDestType === 'other' && (
                      <input
                        type="text"
                        value={travelOtherText}
                        onChange={(e) => setTravelOtherText(e.target.value)}
                        placeholder="Where are you heading..."
                        style={{ marginTop: '10px', width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box' }}
                      />
                    )}

                    {travelError && <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{travelError}</p>}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                      <button onClick={closeTravelPicker} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                        Cancel
                      </button>
                      {(travelDestType === 'property' || travelDestType === 'other') && (
                        <button
                          onClick={confirmTravelSubStep}
                          disabled={travelSaving}
                          style={{ flex: 2, padding: '10px', background: COLORS.blue600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: travelSaving ? 'not-allowed' : 'pointer', opacity: travelSaving ? 0.7 : 1 }}
                        >
                          {travelSaving ? 'Starting…' : 'Start Travel'}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {earlyLeavePromptOpen && (
                <div style={{ marginTop: '10px', background: COLORS.white, border: `1px solid ${COLORS.amber300}`, borderRadius: '12px', padding: '14px' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 800, color: COLORS.amber800 }}>⚠ You're finishing before {dailyClockOutDeadline}</p>
                  <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.slate500 }}>Just so it's on record why -- e.g. "all visits done", "doctor's appointment".</p>
                  <input
                    type="text"
                    value={earlyLeaveReason}
                    onChange={(e) => setEarlyLeaveReason(e.target.value)}
                    placeholder="Reason for finishing early..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '10px' }}
                  />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setEarlyLeavePromptOpen(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      onClick={submitEarlyLeaveDaily}
                      disabled={clockingOutForDay}
                      style={{ flex: 2, padding: '10px', background: COLORS.slate900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
                    >
                      {clockingOutForDay ? 'Clocking out…' : 'Confirm Clock Out'}
                    </button>
                  </div>
                </div>
              )}

              {clockOutConfirmOpen && (
                <div style={{ marginTop: '10px', background: COLORS.white, border: `1px solid ${COLORS.slate300}`, borderRadius: '12px', padding: '14px' }}>
                  <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Clock out for the day?</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => setClockOutConfirmOpen(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button
                      onClick={() => submitDailyClockOut(null)}
                      disabled={clockingOutForDay}
                      style={{ flex: 2, padding: '10px', background: COLORS.slate900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
                    >
                      {clockingOutForDay ? 'Clocking out…' : 'Yes, Clock Out'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <Suspense fallback={<p style={{ color: COLORS.slate400, fontSize: '13px' }}>Loading...</p>}>
            <ActivePage
              profile={profile}
              onTicketsChanged={refreshCounts}
              onNavigate={goToPage}
              returnTo={returnTo}
              initialReopenHistory={currentPage === 'clocking' ? clockingInitialReopenHistory : null}
              onInitialReopenHistoryConsumed={() => setClockingInitialReopenHistory(null)}
              initialStatusFilter={currentPage === 'pipeline' ? pipelineInitialFilter : null}
              initialPriorityFilter={currentPage === 'pipeline' ? pipelineInitialPriorityFilter : null}
              initialStuckFilter={currentPage === 'pipeline' ? pipelineInitialStuckFilter : null}
              initialNeedsFollowupFilter={currentPage === 'pipeline' ? pipelineInitialNeedsFollowupFilter : null}
              initialTicketNumberSearch={currentPage === 'pipeline' ? pipelineInitialTicketNumber : null}
              initialCategoryFilter={currentPage === 'pipeline' ? pipelineInitialCategory : null}
              initialDivisionFilter={currentPage === 'pipeline' ? pipelineInitialDivision : null}
              initialBuilderFilter={currentPage === 'pipeline' ? pipelineInitialBuilder : null}
              initialPropertyFilter={currentPage === 'pipeline' ? pipelineInitialProperty : null}
              initialFromDate={currentPage === 'pipeline' ? pipelineInitialFromDate : null}
              initialToDate={currentPage === 'pipeline' ? pipelineInitialToDate : null}
              onInitialFilterConsumed={() => {
                setPipelineInitialFilter(null); setPipelineInitialPriorityFilter(null); setPipelineInitialStuckFilter(null); setPipelineInitialNeedsFollowupFilter(null); setPipelineInitialTicketNumber(null)
                setPipelineInitialCategory(null); setPipelineInitialDivision(null); setPipelineInitialBuilder(null); setPipelineInitialProperty(null)
                setPipelineInitialFromDate(null); setPipelineInitialToDate(null)
              }}
              initialPropertiesFilter={currentPage === 'properties' ? propertiesInitialFilter : null}
              onPropertiesFilterConsumed={() => setPropertiesInitialFilter(null)}
              initialTierFilter={currentPage === 'compliance' ? complianceInitialTierFilter : currentPage === 'voids' ? voidsInitialTierFilter : null}
              onInitialTierFilterConsumed={() => { setComplianceInitialTierFilter(null); setVoidsInitialTierFilter(null) }}
              initialStaffId={currentPage === 'builders' ? buildersInitialStaffId : null}
              onInitialStaffIdConsumed={() => setBuildersInitialStaffId(null)}
              initialPropertyId={currentPage === 'property-dimensions' ? dimensionsInitialPropertyId : null}
              onInitialPropertyIdConsumed={() => setDimensionsInitialPropertyId(null)}
            />
          </Suspense>
        </div>
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, zIndex: 100, display: 'flex' }}>
          <div style={{ width: '260px', maxWidth: '80vw', background: COLORS.brandNavy, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SidebarContent />
          </div>
          <div onClick={() => setSidebarOpen(false)} style={{ flex: 1, background: 'rgba(15,23,42,0.5)' }} />
        </div>
      )}

    </div>
  )
}
