import { useEffect, useState, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { COLORS } from './lib/colors'
import { roleFromJobTitle, normalizeCustomRoles, accessLevelForRole, hideSettingsForRole, hideDiagnosticsForRole, hideStaffRolesForRole, divisionForRole, canCreateEventsForRole } from './lib/roles'
import { logLoginEvent, consumeGenuineLoginAttempt } from './lib/loginEvents'
import { consumeSuppressSignInLog } from './lib/impersonation'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import SplashScreen from './pages/SplashScreen'
import ImpersonationBanner from './components/ImpersonationBanner'
import UpdateAvailableBadge from './components/UpdateAvailableBadge'

// Lazy-loaded so an admin's browser never downloads the builder bundle (and
// vice versa) -- each becomes its own chunk Vite fetches only once routing
// actually lands on it, instead of both being in the single main bundle
// every user downloads regardless of role.
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const BuilderDashboard = lazy(() => import('./pages/BuilderDashboard'))
const SubmitterDashboard = lazy(() => import('./pages/SubmitterDashboard'))

// ILIKE treats _ and % as wildcards -- both are legal characters in a real
// email's local part, so an unescaped ILIKE lookup could match more than
// just the intended address. Escaping them keeps this a case-insensitive
// exact match, not a search.
function escapeLikePattern(value) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export default function App() {
  const [session, setSession]   = useState(null)
  const [profile, setProfile]   = useState(null)
  const [loading, setLoading]   = useState(true)
  // Keeps the splash screen up for a minimum stretch even when the session
  // check resolves instantly, so the animation actually gets seen instead of
  // flashing past -- but never adds extra wait beyond however long the real
  // check takes if that's longer.
  const [minSplashDone, setMinSplashDone] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setMinSplashDone(true), 2600)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) fetchProfile(data.session.user.email)
      else setLoading(false)
    })

    // Branches on the real event now (previously discarded as `_event` and
    // treated every state change identically) -- a genuine sign-in logs a
    // pmms.login_events row. INITIAL_SESSION (fires once on page load/
    // refresh when an existing session is restored) and TOKEN_REFRESHED are
    // deliberately not logged, so refreshing the page doesn't spam the
    // activity trail.
    //
    // Sign-out is deliberately NOT logged here -- by the time SIGNED_OUT
    // fires, supabase.auth.signOut() has already cleared the session, so an
    // insert attempted from this listener has no valid credentials and
    // silently 401s (confirmed live). Each dashboard's handleSignOut logs
    // the event itself, before calling signOut(), while the session is
    // still good -- see AdminDashboard.jsx/BuilderDashboard.jsx.
    //
    // The subscription is captured and torn down on unmount -- React
    // StrictMode double-invokes this effect in development, and without
    // this cleanup the previous (never-removed) listener kept firing
    // alongside the new one, logging every real sign-in twice.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      if (session) {
        // consumeSuppressSignInLog() must be called synchronously here,
        // before fetchProfile's await -- it's what stops a "View As"
        // session-swap (verifyOtp/setSession both fire SIGNED_IN, same as
        // a real credentialed sign-in) from being logged as a genuine
        // pmms.login_events row. See client/src/lib/impersonation.js.
        const suppressLog = event === 'SIGNED_IN' && consumeSuppressSignInLog()
        // supabase-js also fires SIGNED_IN when a backgrounded tab simply
        // regains focus (it silently re-validates the stored session on
        // visibilitychange -- intentional upstream behaviour, see
        // supabase/gotrue-js#284), not just on a real credentialed login.
        // Without this flag every tab switch looked identical to a fresh
        // sign-in, so the reload below (and, separately, the login-events
        // insert) fired on every tab switch, not just real logins -- found
        // live 2026-08-21 right after this reload was added. Login.jsx sets
        // this synchronously right before calling signInWithPassword().
        const genuineLogin = event === 'SIGNED_IN' && consumeGenuineLoginAttempt()
        fetchProfile(session.user.email).then(resolvedProfile => {
          if (event === 'SIGNED_IN' && resolvedProfile && !suppressLog && genuineLogin) {
            // Deliberately kept even though the JWT-expiry and tab-switch
            // auto-reloads were removed for interrupting active work --
            // this one can't do that. It only ever fires on a fresh login
            // (nothing in progress to lose) or after a session already
            // expired and redirected here (which already unmounted
            // whatever screen was open and lost any unsaved input before
            // this point -- the reload isn't what costs it). Still the one
            // reliable, frequent-enough moment to pull a tab stuck on old
            // code onto the current build. See git history around
            // 2026-08-21 for the auto-assign bug this exists to prevent.
            logLoginEvent(resolvedProfile, session.user.email, 'Signed In').then(() => {
              window.location.reload()
            })
          }
        })
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(email) {
    // .limit(2) instead of .single() -- staff is a company-wide table PMMS
    // doesn't fully control, and has had duplicate-email rows before. A
    // duplicate here must not hard-crash login; take the first match and
    // warn so it gets noticed and cleaned up. order('id') makes "the first
    // match" deterministic -- every other email lookup in this app (Edge
    // Functions included) orders the same way, so they all resolve to the
    // same row instead of potentially disagreeing with each other.
    //
    // .ilike (not .eq) -- Supabase Auth always lowercases session.user.email,
    // but public.staff.email is free-typed on a table PMMS doesn't fully
    // control and has landed with capitals before (e.g. "Arunan.A@..."). A
    // case-sensitive .eq() against that silently finds nothing, profile
    // never resolves, and the app is stuck rendering nothing at all -- found
    // live 2026-08-12. escapeLikePattern keeps this an exact match rather
    // than a real wildcard search, since email addresses can legally contain
    // ILIKE's own special characters (_, %).
    const { data: rows } = await supabase
      .from('staff')
      .select('id, name, email, job_title, photo_url, must_reset_password, active, skills')
      .ilike('email', escapeLikePattern(email))
      .order('id')
      .limit(2)

    if (rows?.length > 1) {
      console.warn(`Multiple staff rows found for email ${email} -- using the first one. This should be cleaned up.`)
    }
    const data = rows?.[0] ?? null

    if (!data) { setProfile(data); setLoading(false); return null }

    let role = roleFromJobTitle(data.job_title)
    let hideSettings = false
    let hideDiagnostics = false
    let hideStaffRoles = false
    let division = null
    let canCreateEvents = false
    // The raw assigned PMMS Role name itself (e.g. "Maintenance Assistant"),
    // not just what it derives (role/division/etc above) -- needed by any
    // feature gated on a specific named role rather than the coarser
    // access-level/division vocabulary (see Property Onboarding's nav gate
    // in AdminDashboard.jsx, added 2026-08-21 after job_title-based gating
    // turned out to target a role that doesn't actually exist).
    let pmmsRole = null

    // job_title lives on a company-wide table PMMS doesn't control -- a
    // rename there (even a legitimate one) can otherwise silently lock
    // someone out with no recovery but a DB edit or code change. A PMMS
    // Role assignment (pmms.staff_roles, managed on the Admin page) can
    // grant login access directly instead -- built-in Admin/Builder always
    // do, and a custom role (e.g. "Maintenance Manager") does if it was
    // configured with an access level on the Admin page's Roles panel. This
    // only ever ADDS access on top of job_title-based routing, never removes it.
    const { data: roleRow } = await supabase
      .schema('pmms')
      .from('staff_roles')
      .select('role')
      .eq('staff_id', data.id)
      .maybeSingle()

    if (roleRow?.role) {
      pmmsRole = roleRow.role
      const { data: settingsRow } = await supabase
        .schema('pmms')
        .from('settings')
        .select('setting_value')
        .eq('setting_key', 'custom_roles')
        .maybeSingle()

      const normalizedCustomRoles = normalizeCustomRoles(settingsRow?.setting_value)
      const accessLevel = accessLevelForRole(roleRow.role, normalizedCustomRoles)
      if (accessLevel) role = accessLevel
      // UI-only convenience, not a database restriction -- see roles.js.
      hideSettings = hideSettingsForRole(roleRow.role, normalizedCustomRoles)
      hideDiagnostics = hideDiagnosticsForRole(roleRow.role, normalizedCustomRoles)
      hideStaffRoles = hideStaffRolesForRole(roleRow.role, normalizedCustomRoles)
      // Which division (if any) this role is scoped to -- the real
      // restriction is enforced by RLS (pmms.current_division()); this is
      // just so the UI can adapt (e.g. narrowing the Pipeline's category
      // filter for a division-scoped manager).
      division = divisionForRole(roleRow.role, normalizedCustomRoles)
      // UI-only convenience (shows/hides the "+ New Event" button) -- the
      // real restriction is enforced server-side by
      // pmms.current_can_create_events().
      canCreateEvents = canCreateEventsForRole(roleRow.role, normalizedCustomRoles)
    }

    // Deactivating someone (the Admin page's "Deactivate" button) must
    // actually cut off access, not just hide them from staff lists/KPIs --
    // this is a remove-only check, applied last, and it overrides every
    // access grant above (job_title, PMMS Admin/Builder/custom role) with
    // no exception.
    if (data.active === false) { role = null; pmmsRole = null }

    const resolvedProfile = { ...data, role, hideSettings, hideDiagnostics, hideStaffRoles, division, canCreateEvents, pmmsRole }
    setProfile(resolvedProfile)
    setLoading(false)
    return resolvedProfile
  }

  function homeForRole() {
    if (!profile) return '/login'
    if (profile.active === false) return '/deactivated'
    // Checked before role routing -- an admin-issued temp password must be
    // replaced before the account can do anything else in the system.
    if (profile.must_reset_password) return '/set-password'
    if (profile.role === 'admin' || profile.role === 'manager') return '/admin'
    if (profile.role === 'builder') return '/builder'
    if (profile.role === 'submitter') return '/submit'
    return '/no-access'
  }

  if (loading || !minSplashDone) return <SplashScreen />

  return (
    <>
      {/* AdminDashboard's own sidebar has a "Return to my account" button
          (guaranteed visible, no z-index/layout fights); BuilderDashboard
          and SubmitterDashboard have no equivalent chrome, so they still
          need the banner. (Found live: submitter was missing here entirely
          -- View As a submitter never showed any way back, not flaky.) */}
      {(profile?.role === 'builder' || profile?.role === 'submitter') && <ImpersonationBanner />}
      <UpdateAvailableBadge />
      <Suspense fallback={<SplashScreen />}>
      <Routes>
      <Route path="/login" element={!session ? <Login /> : <Navigate to={homeForRole()} replace />} />
      <Route path="/set-password" element={session ? <SetPassword profile={profile} onDone={() => fetchProfile(session.user.email)} /> : <Navigate to="/login" replace />} />
      <Route path="/admin" element={
        session && (profile?.role === 'admin' || profile?.role === 'manager')
          ? (profile?.must_reset_password ? <Navigate to="/set-password" replace /> : <AdminDashboard profile={profile} />)
          : <Navigate to="/login" replace />
      } />
      <Route path="/builder" element={
        session && profile?.role === 'builder'
          ? (profile?.must_reset_password ? <Navigate to="/set-password" replace /> : <BuilderDashboard profile={profile} />)
          : <Navigate to="/login" replace />
      } />
      <Route path="/submit" element={
        session && profile?.role === 'submitter'
          ? (profile?.must_reset_password ? <Navigate to="/set-password" replace /> : <SubmitterDashboard profile={profile} />)
          : <Navigate to="/login" replace />
      } />
      <Route path="/no-access" element={
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
          <p style={{ color: COLORS.slate500, fontWeight: 600 }}>You do not have access to this system.</p>
        </div>
      } />
      <Route path="/deactivated" element={
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
          <p style={{ color: COLORS.slate500, fontWeight: 600 }}>Your account has been deactivated. Contact your admin if you believe this is a mistake.</p>
        </div>
      } />
      <Route path="*" element={<Navigate to={session ? homeForRole() : '/login'} replace />} />
      </Routes>
      </Suspense>
    </>
  )
}
