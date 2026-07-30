import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { pushNotificationsSupported, hasActivePushSubscription, enablePushNotifications } from '../lib/pushNotifications'
import gbchLogo from '../assets/gbch-logo.svg'
import AdminDashboardPage from './admin/AdminDashboard'
import AdminPipeline from './admin/AdminPipeline'
import AdminProperties from './admin/AdminProperties'
import AdminCompliance from './admin/AdminCompliance'
import AdminVoids from './admin/AdminVoids'
import AdminSignOff from './admin/AdminSignOff'
import AdminBuilders from './admin/AdminBuilders'
import AdminClocking from './admin/AdminClocking'
import AdminRaiseTicket from './admin/AdminRaiseTicket'
import AdminStock from './admin/AdminStock'
import AdminReports from './admin/AdminReports'
import AdminSettings from './admin/AdminSettings'
import AdminAccess from './admin/AdminAccess'
import AdminHelp from './admin/AdminHelp'
import AdminHousekeeping from './admin/AdminHousekeeping'
import AdminEvents from './admin/AdminEvents'
import AdminViewAs from './admin/AdminViewAs'
import AdminTeamChat from './admin/AdminTeamChat'
import { EVENTS_FEATURE_ENABLED, resolveStaffPhotoUrl } from './admin/shared'
import { getImpersonationMarker, returnToAdmin } from '../lib/impersonation'
import { countUnreadMessages } from '../lib/chat'
import { fetchDivisions } from '../lib/divisions'

const NAV_ITEMS = [
  // Grouped by what they're actually for: core ticket lifecycle first,
  // then property/division monitoring, then people-ops, then stock, then
  // reports/config at the bottom (2026-07-22 reorder).
  { key: 'dashboard', label: 'Dashboard', icon: '🏠', Component: AdminDashboardPage },
  // RLS on pmms.chat_messages is the real restriction (division-scoped),
  // not this nav item -- visible to any admin/manager, no divisions/
  // divisionOnly gating needed here.
  { key: 'team-chat', label: 'Team Chat', icon: '💬', Component: AdminTeamChat },
  { key: 'pipeline', label: 'Pipeline', icon: '🛠️', Component: AdminPipeline },
  { key: 'raise-ticket', label: 'Log a Ticket', icon: '📝', Component: AdminRaiseTicket },
  { key: 'sign-off', label: 'Sign-Off', icon: '✅', Component: AdminSignOff },
  ...(EVENTS_FEATURE_ENABLED ? [{ key: 'events', label: 'Events', icon: '📅', Component: AdminEvents }] : []),
  { key: 'properties', label: 'Properties', icon: '🏢', Component: AdminProperties },
  { key: 'voids', label: 'Voids', icon: '🔑', Component: AdminVoids, divisions: ['Maintenance'] },
  // Division dashboards, grouped together in this order -- Landlord
  // Liaison goes here too once it exists.
  { key: 'compliance', label: 'Compliance', icon: '🛡️', Component: AdminCompliance, divisions: ['Maintenance', 'Compliance'] },
  { key: 'housekeeping', label: 'Housekeeping', icon: '🧹', Component: AdminHousekeeping, divisionOnly: 'Housekeeping' },
  { key: 'builders', label: 'Staff', icon: '👥', Component: AdminBuilders },
  { key: 'clocking', label: 'Clocking', icon: '⏱️', Component: AdminClocking },
  { key: 'stock', label: 'Stock', icon: '📦', Component: AdminStock, divisions: ['Maintenance'] },
  { key: 'reports', label: 'Reports', icon: '📈', Component: AdminReports },
  // These three are rendered in the profile popover, not the main nav list
  // (see SidebarContent) -- still present here so NAV_ITEMS/isNavItemVisible
  // keep working as the single source of truth for routing + visibility.
  { key: 'settings', label: 'Settings', icon: '⚙️', Component: AdminSettings },
  { key: 'admin', label: 'Admin', icon: '🔐', Component: AdminAccess, adminOnly: true },
  { key: 'view-as', label: 'View As...', icon: '👁️', Component: AdminViewAs, adminOnly: true },
  { key: 'help', label: 'Help & Guide', icon: '📖', Component: AdminHelp, adminOnly: true },
]

const POPOVER_ITEM_KEYS = ['settings', 'admin', 'view-as', 'help']

// Visual grouping dividers in the main nav: Dashboard alone, then the
// ticket lifecycle (Pipeline/Log a Ticket/Sign-Off), then property/
// division monitoring (Properties/Voids/Compliance/Housekeeping), then
// people-ops (Staff/Clocking), then Stock/Reports.
const DIVIDER_AFTER_KEYS = ['team-chat', 'sign-off', 'housekeeping', 'clocking']

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
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingSignOffCount, setPendingSignOffCount] = useState(0)
  const [totalTicketsCount, setTotalTicketsCount] = useState(0)
  const [chatUnreadTotal, setChatUnreadTotal] = useState(0)
  const [pipelineInitialFilter, setPipelineInitialFilter] = useState(null)
  const [pipelineInitialPriorityFilter, setPipelineInitialPriorityFilter] = useState(null)
  const [pipelineInitialStuckFilter, setPipelineInitialStuckFilter] = useState(null)
  const [propertiesInitialFilter, setPropertiesInitialFilter] = useState(null)
  const [complianceInitialTierFilter, setComplianceInitialTierFilter] = useState(null)
  const [voidsInitialTierFilter, setVoidsInitialTierFilter] = useState(null)
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
    const counts = await Promise.all(divs.map(d => countUnreadMessages(d, profile.id)))
    setChatUnreadTotal(counts.reduce((a, b) => a + b, 0))
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
    setCurrentPage(key)
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
  }

  const navButtonStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '7px 12px', marginBottom: '1px',
    borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: active ? 700 : 400,
    background: active ? COLORS.greenDark : 'transparent', color: COLORS.white, fontFamily: 'inherit',
  })
  const navIconStyle = { width: '18px', flexShrink: 0, textAlign: 'center', fontSize: '14px', lineHeight: 1 }

  // A real nested component, instantiated twice (desktop sidebar + mobile
  // drawer, below) -- React gives each JSX usage its own hook state, so
  // popoverOpen/popoverRef/triggerRef are automatically independent between
  // the two without any extra work.
  function SidebarContent() {
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [returning, setReturning] = useState(false)
    const impersonationMarker = getImpersonationMarker()
    const popoverRef = useRef(null)

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
        <button
          onClick={() => goToPage('dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.1)', width: '100%', textAlign: 'left' }}
        >
          <img src={gbchLogo} alt="GBCH" style={{ height: '32px' }} />
          <span style={{ fontSize: '15px', fontWeight: 800, color: COLORS.white }}>PMMS</span>
        </button>

        {impersonationMarker && (
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

        <nav style={{ flex: 1, padding: '10px', overflowY: 'auto' }}>
          {mainNavItems.map(item => (
            <Fragment key={item.key}>
              <button
                onClick={() => goToPage(item.key)}
                style={navButtonStyle(currentPage === item.key)}
              >
                <span style={navIconStyle}>{item.icon}</span>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  {item.key === 'sign-off' && pendingSignOffCount > 0 && (
                    <span
                      style={{
                        background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
                        borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center', flexShrink: 0,
                      }}
                    >
                      {pendingSignOffCount}
                    </span>
                  )}
                  {item.key === 'pipeline' && totalTicketsCount > 0 && (
                    <span
                      style={{
                        background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
                        borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center', flexShrink: 0,
                      }}
                    >
                      {totalTicketsCount}
                    </span>
                  )}
                  {item.key === 'team-chat' && chatUnreadTotal > 0 && (
                    <span
                      style={{
                        background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
                        borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center', flexShrink: 0,
                      }}
                    >
                      {chatUnreadTotal}
                    </span>
                  )}
                </span>
              </button>
              {DIVIDER_AFTER_KEYS.includes(item.key) && (
                <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '6px 4px' }} />
              )}
            </Fragment>
          ))}
        </nav>

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', position: 'relative' }}>
          {popoverOpen && (
            <div
              ref={popoverRef}
              style={{
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
                  <span style={navIconStyle}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.16)', margin: '4px 6px' }} />
              <button onClick={handlePopoverSignOut} style={navButtonStyle(false)}>
                <span style={navIconStyle}>🚪</span>
                <span>Sign out</span>
              </button>
            </div>
          )}

          <button
            ref={triggerRef}
            onClick={() => setPopoverOpen(o => !o)}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', background: 'none', border: 'none', padding: '4px', margin: '-4px -4px 10px -4px', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
          >
            {resolveStaffPhotoUrl(profile.photo_url) ? (
              <img src={resolveStaffPhotoUrl(profile.photo_url)} alt="" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: COLORS.white, fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {(profile.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</p>
              <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.job_title}</p>
            </div>
            <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.6)', fontSize: '11px', transform: popoverOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>▲</span>
          </button>

          {pushNotificationsSupported() && (
            <button
              onClick={handleEnableNotifications}
              disabled={pushEnabled}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.1)', color: pushEnabled ? 'rgba(255,255,255,0.5)' : COLORS.white, fontWeight: 700, fontSize: '13px', cursor: pushEnabled ? 'default' : 'pointer' }}
            >
              🔔 {pushEnabled ? 'Notifications: On' : 'Enable Notifications'}
            </button>
          )}
          {pushError && <p style={{ margin: '8px 0 0 0', fontSize: '11px', color: COLORS.red300 }}>{pushError}</p>}
        </div>
      </>
    )
  }

  // Defense in depth: even though the nav button for admin-only pages is
  // hidden for non-admins, this guards against currentPage ever landing on
  // one some other way (there's no URL-based deep link into these pages
  // today, but the check is cheap and this is a security-adjacent feature).
  const activeNavItem = NAV_ITEMS.find(item => item.key === currentPage)
  const ActivePage = (activeNavItem && isNavItemVisible(activeNavItem, profile))
    ? activeNavItem.Component
    : AdminDashboardPage

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif' }}>

      {/* Desktop sidebar */}
      <div
        className="admin-sidebar-desktop"
        style={{ width: '240px', minWidth: '240px', background: COLORS.brandNavy, display: 'flex', flexDirection: 'column', position: 'sticky', top: 'var(--pmms-banner-offset, 0px)', height: 'calc(100vh - var(--pmms-banner-offset, 0px))' }}
      >
        <SidebarContent />
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
          <ActivePage
            profile={profile}
            onTicketsChanged={refreshCounts}
            onNavigate={goToPage}
            initialStatusFilter={currentPage === 'pipeline' ? pipelineInitialFilter : null}
            initialPriorityFilter={currentPage === 'pipeline' ? pipelineInitialPriorityFilter : null}
            initialStuckFilter={currentPage === 'pipeline' ? pipelineInitialStuckFilter : null}
            onInitialFilterConsumed={() => { setPipelineInitialFilter(null); setPipelineInitialPriorityFilter(null); setPipelineInitialStuckFilter(null) }}
            initialPropertiesFilter={currentPage === 'properties' ? propertiesInitialFilter : null}
            onPropertiesFilterConsumed={() => setPropertiesInitialFilter(null)}
            initialTierFilter={currentPage === 'compliance' ? complianceInitialTierFilter : currentPage === 'voids' ? voidsInitialTierFilter : null}
            onInitialTierFilterConsumed={() => { setComplianceInitialTierFilter(null); setVoidsInitialTierFilter(null) }}
          />
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
