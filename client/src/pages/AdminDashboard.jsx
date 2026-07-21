import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
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

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', Component: AdminDashboardPage },
  { key: 'pipeline', label: 'Pipeline', Component: AdminPipeline },
  { key: 'properties', label: 'Properties', Component: AdminProperties },
  { key: 'compliance', label: 'Compliance', Component: AdminCompliance, divisions: ['Maintenance'] },
  { key: 'voids', label: 'Voids', Component: AdminVoids, divisions: ['Maintenance'] },
  { key: 'sign-off', label: 'Sign-Off', Component: AdminSignOff },
  { key: 'events', label: 'Events', Component: AdminEvents },
  { key: 'housekeeping', label: 'Housekeeping', Component: AdminHousekeeping, divisionOnly: 'Housekeeping' },
  { key: 'builders', label: 'Staff', Component: AdminBuilders },
  { key: 'clocking', label: 'Clocking', Component: AdminClocking },
  { key: 'raise-ticket', label: 'Log a Ticket', Component: AdminRaiseTicket },
  { key: 'stock', label: 'Stock', Component: AdminStock, divisions: ['Maintenance'] },
  { key: 'reports', label: 'Reports', Component: AdminReports },
  { key: 'settings', label: 'Settings', Component: AdminSettings },
  { key: 'admin', label: 'Admin', Component: AdminAccess, adminOnly: true },
  { key: 'help', label: 'Help & Guide', Component: AdminHelp, adminOnly: true },
]

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

  const refreshCounts = useCallback(async () => {
    await Promise.all([fetchPendingSignOffCount(), fetchTotalTicketsCount()])
  }, [fetchPendingSignOffCount, fetchTotalTicketsCount])

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
    display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', marginBottom: '4px',
    borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
    background: active ? '#19562e' : 'transparent', color: '#ffffff',
  })

  function SidebarContent() {
    return (
      <>
        <button
          onClick={() => goToPage('dashboard')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.1)', width: '100%', textAlign: 'left' }}
        >
          <img src={gbchLogo} alt="GBCH" style={{ height: '32px' }} />
          <span style={{ fontSize: '15px', fontWeight: 800, color: '#ffffff' }}>PMMS Admin</span>
        </button>

        <nav style={{ flex: 1, padding: '12px', overflowY: 'auto' }}>
          {NAV_ITEMS.filter(item => isNavItemVisible(item, profile)).map(item => (
            <button
              key={item.key}
              onClick={() => goToPage(item.key)}
              style={navButtonStyle(currentPage === item.key)}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                {item.label}
                {item.key === 'sign-off' && pendingSignOffCount > 0 && (
                  <span
                    style={{
                      background: '#dc2626', color: '#ffffff', fontSize: '11px', fontWeight: 800,
                      borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center',
                    }}
                  >
                    {pendingSignOffCount}
                  </span>
                )}
                {item.key === 'pipeline' && totalTicketsCount > 0 && (
                  <span
                    style={{
                      background: '#dc2626', color: '#ffffff', fontSize: '11px', fontWeight: 800,
                      borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center',
                    }}
                  >
                    {totalTicketsCount}
                  </span>
                )}
              </span>
            </button>
          ))}
        </nav>

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            {profile.photo_url ? (
              <img src={profile.photo_url} alt="" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: '#ffffff', fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {(profile.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</p>
              <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.job_title}</p>
            </div>
          </div>
          {pushNotificationsSupported() && (
            <button
              onClick={handleEnableNotifications}
              disabled={pushEnabled}
              style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.1)', color: pushEnabled ? 'rgba(255,255,255,0.5)' : '#ffffff', fontWeight: 700, fontSize: '13px', cursor: pushEnabled ? 'default' : 'pointer', marginBottom: '8px' }}
            >
              🔔 {pushEnabled ? 'Notifications: On' : 'Enable Notifications'}
            </button>
          )}
          {pushError && <p style={{ margin: '0 0 8px 0', fontSize: '11px', color: '#fca5a5' }}>{pushError}</p>}
          <button
            onClick={handleSignOut}
            style={{ width: '100%', padding: '10px', borderRadius: '10px', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#ffffff', fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}
          >
            Sign out
          </button>
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
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Desktop sidebar */}
      <div
        className="admin-sidebar-desktop"
        style={{ width: '240px', minWidth: '240px', background: '#0D1B3E', display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh' }}
      >
        <SidebarContent />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Mobile top bar */}
        <div
          className="admin-mobile-topbar"
          style={{ alignItems: 'center', justifyContent: 'space-between', background: '#0D1B3E', padding: '14px 16px', position: 'sticky', top: 0, zIndex: 20 }}
        >
          <button
            onClick={() => goToPage('dashboard')}
            style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <img src={gbchLogo} alt="GBCH" style={{ height: '28px' }} />
            <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '14px' }}>PMMS Admin</span>
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
          >
            <span style={{ width: '22px', height: '2px', background: '#ffffff', borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: '#ffffff', borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: '#ffffff', borderRadius: '2px' }} />
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
        <div style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex' }}>
          <div style={{ width: '260px', maxWidth: '80vw', background: '#0D1B3E', height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SidebarContent />
          </div>
          <div onClick={() => setSidebarOpen(false)} style={{ flex: 1, background: 'rgba(15,23,42,0.5)' }} />
        </div>
      )}

    </div>
  )
}
