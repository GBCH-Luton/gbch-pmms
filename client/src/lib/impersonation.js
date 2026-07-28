import { supabase } from './supabase'

const MARKER_KEY = 'pmms_impersonation'
const SUPPRESS_KEY = 'pmms_suppress_signin_log'

// localStorage, not sessionStorage -- Supabase-js already persists the
// *active* session in localStorage for every user today, so this isn't a
// new exposure. Using sessionStorage here would strand the admin if they
// open a new tab while impersonating (shares localStorage, not
// sessionStorage) or close/reopen the browser before clicking Return.
export function getImpersonationMarker() {
  try {
    const raw = localStorage.getItem(MARKER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

// Read-and-clear in one synchronous step, called exactly once from inside
// App.jsx's SIGNED_IN handler before any await. Supabase-js fires SIGNED_IN
// for both verifyOtp() and setSession(), same as a real credentialed
// sign-in, and there's no other way to tell them apart -- this flag (set
// right before the programmatic swap) is what stops the impersonated
// session-swap from being logged as a real pmms.login_events row. Reading
// and removing synchronously, at the top of the handler, is what keeps this
// race-free: JS is single-threaded, so there's no window for a second event
// to see a stale flag or miss a real one.
export function consumeSuppressSignInLog() {
  const val = sessionStorage.getItem(SUPPRESS_KEY)
  sessionStorage.removeItem(SUPPRESS_KEY)
  return val === '1'
}

export async function startImpersonation({ hashedToken, targetName, impersonationEventId }) {
  const { data: { session: adminSession } } = await supabase.auth.getSession()
  if (!adminSession) return { error: 'No active admin session' }

  localStorage.setItem(MARKER_KEY, JSON.stringify({
    targetName,
    impersonationEventId,
    adminAccessToken: adminSession.access_token,
    adminRefreshToken: adminSession.refresh_token,
    startedAt: Date.now(),
  }))
  sessionStorage.setItem(SUPPRESS_KEY, '1')

  const { error } = await supabase.auth.verifyOtp({ token_hash: hashedToken, type: 'magiclink' })
  if (error) {
    localStorage.removeItem(MARKER_KEY)
    sessionStorage.removeItem(SUPPRESS_KEY)
    return { error: error.message }
  }
  return { error: null }
}

export async function returnToAdmin() {
  const marker = getImpersonationMarker()
  if (!marker) return { error: null }

  try {
    sessionStorage.setItem(SUPPRESS_KEY, '1')
    const { error } = await supabase.auth.setSession({
      access_token: marker.adminAccessToken,
      refresh_token: marker.adminRefreshToken,
    })
    localStorage.removeItem(MARKER_KEY)

    if (error) {
      // The stashed admin session is no longer valid (e.g. impersonation
      // was left open long enough for the refresh token to expire) --
      // fall back to a clean sign-out rather than leaving the browser
      // stuck looking like the target with a broken "Return" button.
      await supabase.auth.signOut().catch(() => {})
      return { error: error.message }
    }

    // Fire-and-forget, same tone as logLoginEvent elsewhere in this app --
    // a failed audit close-out shouldn't block getting the admin back to
    // their own account. Runs under the now-restored admin session, so
    // RLS (current_access_level() = 'admin') allows it.
    supabase.schema('pmms').from('impersonation_events')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', marker.impersonationEventId)
      .then(() => {})

    return { error: null }
  } catch (err) {
    // setSession() throwing outright (as opposed to returning {error}) was
    // previously left completely unhandled here, leaving the marker intact
    // and the banner's button stuck on "Returning..." forever with no
    // feedback. Clear the marker and force a clean sign-out so the admin
    // always ends up somewhere recoverable.
    localStorage.removeItem(MARKER_KEY)
    await supabase.auth.signOut().catch(() => {})
    return { error: err?.message || 'Something went wrong returning to your account. Please sign in again.' }
  }
}
