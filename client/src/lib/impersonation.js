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

// Supabase-js's internal auth calls are serialized behind a lock (the Web
// Locks API where available); if verifyOtp()/setSession() ever leaves that
// lock in a bad state, a later auth call can hang indefinitely -- neither
// resolving nor rejecting, so a plain try/catch never fires. Racing against
// a timeout is the only way to guarantee this can't hang the UI forever.
function withTimeout(promise, ms, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms)),
  ])
}

export async function returnToAdmin() {
  const marker = getImpersonationMarker()
  if (!marker) return { error: null }

  try {
    sessionStorage.setItem(SUPPRESS_KEY, '1')
    const { error } = await withTimeout(
      supabase.auth.setSession({
        access_token: marker.adminAccessToken,
        refresh_token: marker.adminRefreshToken,
      }),
      8000,
      'Timed out returning to your account.'
    )
    localStorage.removeItem(MARKER_KEY)

    if (error) {
      // The stashed admin session is no longer valid (e.g. impersonation
      // was left open long enough for the refresh token to expire) --
      // fall back to a clean sign-out rather than leaving the browser
      // stuck looking like the target with a broken "Return" button.
      await forceSignOutAndReload()
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
    // setSession() either threw outright or (more likely, based on live
    // testing) hung indefinitely without resolving or rejecting -- a known
    // failure mode of supabase-js's internal auth lock if a prior call
    // left it in a bad state. A plain retry through the same client would
    // risk hanging the exact same way, so this falls back to clearing
    // Supabase's own session storage directly and reloading the page --
    // a fresh page load can't inherit a stuck in-memory/Web-Lock state.
    localStorage.removeItem(MARKER_KEY)
    await forceSignOutAndReload()
    return { error: err?.message || 'Something went wrong returning to your account. Please sign in again.' }
  }
}

async function forceSignOutAndReload() {
  try {
    await withTimeout(supabase.auth.signOut(), 3000, 'signOut timed out')
  } catch {
    // signOut() itself hung/failed -- clear Supabase's own localStorage
    // session key directly rather than trying another auth-client call
    // that could hang the same way.
    Object.keys(localStorage)
      .filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
      .forEach(k => localStorage.removeItem(k))
  }
  window.location.href = '/login'
}
