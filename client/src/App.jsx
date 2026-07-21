import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { roleFromJobTitle, normalizeCustomRoles, accessLevelForRole, hideSettingsForRole, divisionForRole, canCreateEventsForRole } from './lib/roles'
import { logLoginEvent } from './lib/loginEvents'
import Login from './pages/Login'
import SetPassword from './pages/SetPassword'
import AdminDashboard from './pages/AdminDashboard'
import BuilderDashboard from './pages/BuilderDashboard'
import SplashScreen from './pages/SplashScreen'

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
        fetchProfile(session.user.email).then(resolvedProfile => {
          if (event === 'SIGNED_IN' && resolvedProfile) {
            logLoginEvent(resolvedProfile, session.user.email, 'Signed In')
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
    const { data: rows } = await supabase
      .from('staff')
      .select('id, name, email, job_title, photo_url, must_reset_password, active, skills')
      .eq('email', email)
      .order('id')
      .limit(2)

    if (rows?.length > 1) {
      console.warn(`Multiple staff rows found for email ${email} -- using the first one. This should be cleaned up.`)
    }
    const data = rows?.[0] ?? null

    if (!data) { setProfile(data); setLoading(false); return null }

    let role = roleFromJobTitle(data.job_title)
    let hideSettings = false
    let division = null
    let canCreateEvents = false

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
    if (data.active === false) role = null

    const resolvedProfile = { ...data, role, hideSettings, division, canCreateEvents }
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
    return '/no-access'
  }

  if (loading || !minSplashDone) return <SplashScreen />

  return (
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
      <Route path="/no-access" element={
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
          <p style={{ color: '#64748b', fontWeight: 600 }}>You do not have access to this system.</p>
        </div>
      } />
      <Route path="/deactivated" element={
        <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
          <p style={{ color: '#64748b', fontWeight: 600 }}>Your account has been deactivated. Contact your admin if you believe this is a mistake.</p>
        </div>
      } />
      <Route path="*" element={<Navigate to={session ? homeForRole() : '/login'} replace />} />
    </Routes>
  )
}
