import { useState, useEffect, useCallback, useRef, Fragment, lazy, Suspense } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { NavIcon } from '../lib/icons'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { pushNotificationsSupported, hasActivePushSubscription, enablePushNotifications } from '../lib/pushNotifications'
import gbchLogo from '../assets/gbch-logo.svg'
import { EVENTS_FEATURE_ENABLED, resolveStaffPhotoUrl } from './admin/shared'
import { getImpersonationMarker, returnToAdmin } from '../lib/impersonation'
import { countUnreadMessages } from '../lib/chat'
import { countUnreadDms } from '../lib/dm'
import { fetchDivisions } from '../lib/divisions'

// Lazy-loaded: an admin/manager only ever looks at a handful of these tabs
// in a given session, so each becomes its own chunk fetched on first visit
// instead of all 18 admin pages loading up front in the main bundle.
const AdminDashboardPage = lazy(() => import('./admin/AdminDashboard'))
const AdminPipeline = lazy(() => import('./admin/AdminPipeline'))
const AdminProperties = lazy(() => import('./admin/AdminProperties'))
const AdminCompliance = lazy(() => import('./admin/AdminCompliance'))
const AdminVoids = lazy(() => import('./admin/AdminVoids'))
const AdminSignOff = lazy(() => import('./admin/AdminSignOff'))
const AdminBuilders = lazy(() => import('./admin/AdminBuilders'))
const AdminClocking = lazy(() => import('./admin/AdminClocking'))
const AdminRaiseTicket = lazy(() => import('./admin/AdminRaiseTicket'))
const AdminStock = lazy(() => import('./admin/AdminStock'))
const AdminReports = lazy(() => import('./admin/AdminReports'))
const AdminSettings = lazy(() => import('./admin/AdminSettings'))
const AdminAccess = lazy(() => import('./admin/AdminAccess'))
const AdminHelp = lazy(() => import('./admin/AdminHelp'))
const AdminBuilderGuide = lazy(() => import('./admin/AdminBuilderGuide'))
const AdminHousekeeping = lazy(() => import('./admin/AdminHousekeeping'))
const AdminEvents = lazy(() => import('./admin/AdminEvents'))
const AdminViewAs = lazy(() => import('./admin/AdminViewAs'))
const AdminTeamChat = lazy(() => import('./admin/AdminTeamChat'))
const AiTicketLogging = lazy(() => import('./admin/ai-trial/AiTicketLogging'))
const AiPriorityScoring = lazy(() => import('./admin/ai-trial/AiPriorityScoring'))
const AiComplianceDigest = lazy(() => import('./admin/ai-trial/AiComplianceDigest'))

// Keys of every AI Trial submenu child -- used to auto-expand that section
// in the sidebar if you're already on one of its pages, and to resolve
// currentPage -> nav item for the ones nested under 'ai-trial' below.
// 'ai-reports' merged into the real Reports page (see AdminReports.jsx) --
// no longer a separate AI Trial child.
const AI_TRIAL_CHILD_KEYS = ['ai-ticket', 'ai-priority', 'ai-compliance']

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
  { key: 'sign-off', label: 'Sign-Off', icon: 'check', Component: AdminSignOff },
  ...(EVENTS_FEATURE_ENABLED ? [{ key: 'events', label: 'Events', icon: 'calendar', Component: AdminEvents }] : []),
  { key: 'properties', label: 'Properties', icon: 'building', Component: AdminProperties },
  { key: 'voids', label: 'Voids', icon: 'key', Component: AdminVoids, divisions: ['Maintenance'] },
  // Division dashboards, grouped together in this order -- Landlord
  // Liaison goes here too once it exists.
  { key: 'compliance', label: 'Compliance', icon: 'shield', Component: AdminCompliance, divisions: ['Maintenance', 'Compliance'] },
  { key: 'housekeeping', label: 'Housekeeping', icon: 'broom', Component: AdminHousekeeping, divisionOnly: 'Housekeeping' },
  { key: 'builders', label: 'Staff', icon: 'users', Component: AdminBuilders },
  { key: 'clocking', label: 'Clocking', icon: 'clock', Component: AdminClocking },
  // Read-only for admin AND manager -- deliberately not adminOnly, unlike
  // Help & Guide below. No divisions/divisionOnly gating either: Daily
  // Attendance is a company-wide layer, not Maintenance-specific.
  { key: 'builder-guide', label: 'Builder App Guide', icon: 'phone', Component: AdminBuilderGuide },
  { key: 'stock', label: 'Stock', icon: 'box', Component: AdminStock, divisions: ['Maintenance'] },
  { key: 'reports', label: 'Reports', icon: 'chart', Component: AdminReports },
  // Trial section, admin-only while it's being tried out and shown to
  // managers -- free, rule-based (no external AI service, no cost), see
  // client/src/pages/admin/ai-trial/keywordEngine.js. Each child also
  // carries adminOnly itself (not just the parent) so the defense-in-depth
  // check below (activeNavItem + isNavItemVisible) still holds if one is
  // ever resolved directly by key.
  {
    key: 'ai-trial', label: 'AI Trial', icon: 'sparkle', adminOnly: true,
    children: [
      { key: 'ai-ticket', label: 'Ticket Logging', Component: AiTicketLogging, adminOnly: true },
      { key: 'ai-priority', label: 'Priority Scoring', Component: AiPriorityScoring, adminOnly: true },
      { key: 'ai-compliance', label: 'Compliance Digest', Component: AiComplianceDigest, adminOnly: true },
    ],
  },
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
// ticket lifecycle (Pipeline/Log a Ticket/Sign-Off), then property/
// division monitoring (Properties/Voids/Compliance/Housekeeping), then
// people-ops (Staff/Clocking/Builder App Guide), then Stock/Reports, then
// the AI Trial section set apart on its own.
const DIVIDER_AFTER_KEYS = ['team-chat', 'sign-off', 'housekeeping', 'builder-guide', 'reports']

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
  if (item.divisions && profile.division && !item.divisions.includes(profile.division)) return false
  if (item.divisionOnly && profile.role !== 'admin' && profile.division !== item.divisionOnly) return false
  return true
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
    try { return localStorage.getItem('pmms_sidebar_collapsed') === 'true' } catch { return false }
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
  const [pipelineInitialFilter, setPipelineInitialFilter] = useState(null)
  const [pipelineInitialPriorityFilter, setPipelineInitialPriorityFilter] = useState(null)
  const [pipelineInitialStuckFilter, setPipelineInitialStuckFilter] = useState(null)
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
  const [propertiesInitialFilter, setPropertiesInitialFilter] = useState(null)
  const [complianceInitialTierFilter, setComplianceInitialTierFilter] = useState(null)
  const [voidsInitialTierFilter, setVoidsInitialTierFilter] = useState(null)
  const [buildersInitialStaffId, setBuildersInitialStaffId] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushError, setPushError] = useState('')

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
    const { count } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Completed')

    setPendingSignOffCount(count || 0)
  }, [])

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
    await Promise.all([fetchPendingSignOffCount(), fetchTotalTicketsCount(), fetchChatUnreadTotal()])
  }, [fetchPendingSignOffCount, fetchTotalTicketsCount, fetchChatUnreadTotal])

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
    if (key === 'pipeline' && opts.statusFilter) {
      setPipelineInitialFilter(opts.statusFilter)
    }
    if (key === 'pipeline' && opts.priorityFilter) {
      setPipelineInitialPriorityFilter(opts.priorityFilter)
    }
    if (key === 'pipeline' && opts.stuckOnly) {
      setPipelineInitialStuckFilter(true)
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
  }

  const navButtonStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '6px 12px', marginBottom: '1px',
    borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: active ? 700 : 400,
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
    // Lazy-initialized so reopening the sidebar while already on an AI
    // Trial page doesn't collapse the section you're currently in.
    const [aiTrialOpen, setAiTrialOpen] = useState(() => AI_TRIAL_CHILD_KEYS.includes(currentPage))
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
        if (isCollapsed) { setSidebarCollapsed(false); setAiTrialOpen(true) }
        else setAiTrialOpen(o => !o)
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
          {!isCollapsed && <span style={{ fontSize: '15px', fontWeight: 800, color: COLORS.white, whiteSpace: 'nowrap' }}>PMMS</span>}
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
                            <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', transform: aiTrialOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease' }}>▶</span>
                          </span>
                        )}
                      </button>
                    </div>
                    {aiTrialOpen && !isCollapsed && item.children.filter(child => isNavItemVisible(child, profile)).map(child => (
                      <button
                        key={child.key}
                        onClick={() => goToPage(child.key)}
                        style={{ ...navButtonStyle(currentPage === child.key), paddingLeft: '34px', fontSize: '13px' }}
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif' }}>

      {/* Desktop sidebar */}
      <div
        className="admin-sidebar-desktop"
        style={{
          width: sidebarCollapsed ? '64px' : '240px', minWidth: sidebarCollapsed ? '64px' : '240px',
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
          <Suspense fallback={<p style={{ color: COLORS.slate400, fontSize: '13px' }}>Loading...</p>}>
            <ActivePage
              profile={profile}
              onTicketsChanged={refreshCounts}
              onNavigate={goToPage}
              initialStatusFilter={currentPage === 'pipeline' ? pipelineInitialFilter : null}
              initialPriorityFilter={currentPage === 'pipeline' ? pipelineInitialPriorityFilter : null}
              initialStuckFilter={currentPage === 'pipeline' ? pipelineInitialStuckFilter : null}
              initialTicketNumberSearch={currentPage === 'pipeline' ? pipelineInitialTicketNumber : null}
              initialCategoryFilter={currentPage === 'pipeline' ? pipelineInitialCategory : null}
              initialDivisionFilter={currentPage === 'pipeline' ? pipelineInitialDivision : null}
              initialBuilderFilter={currentPage === 'pipeline' ? pipelineInitialBuilder : null}
              initialPropertyFilter={currentPage === 'pipeline' ? pipelineInitialProperty : null}
              initialFromDate={currentPage === 'pipeline' ? pipelineInitialFromDate : null}
              initialToDate={currentPage === 'pipeline' ? pipelineInitialToDate : null}
              onInitialFilterConsumed={() => {
                setPipelineInitialFilter(null); setPipelineInitialPriorityFilter(null); setPipelineInitialStuckFilter(null); setPipelineInitialTicketNumber(null)
                setPipelineInitialCategory(null); setPipelineInitialDivision(null); setPipelineInitialBuilder(null); setPipelineInitialProperty(null)
                setPipelineInitialFromDate(null); setPipelineInitialToDate(null)
              }}
              initialPropertiesFilter={currentPage === 'properties' ? propertiesInitialFilter : null}
              onPropertiesFilterConsumed={() => setPropertiesInitialFilter(null)}
              initialTierFilter={currentPage === 'compliance' ? complianceInitialTierFilter : currentPage === 'voids' ? voidsInitialTierFilter : null}
              onInitialTierFilterConsumed={() => { setComplianceInitialTierFilter(null); setVoidsInitialTierFilter(null) }}
              initialStaffId={currentPage === 'builders' ? buildersInitialStaffId : null}
              onInitialStaffIdConsumed={() => setBuildersInitialStaffId(null)}
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
