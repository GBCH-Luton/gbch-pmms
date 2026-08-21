import { supabase } from './supabase'

const GENUINE_LOGIN_KEY = 'pmms_genuine_login_attempt'

// Set synchronously by Login.jsx right before calling signInWithPassword(),
// consumed synchronously at the top of App.jsx's SIGNED_IN handler.
// Needed because supabase-js also fires SIGNED_IN when a backgrounded tab
// just regains focus -- it silently re-validates/refreshes the stored
// session on visibilitychange, by design (see supabase/gotrue-js#284,
// supabase/supabase-js#716), not just on a real credentialed sign-in. With
// no way to tell the two apart, every tab switch looked identical to a
// fresh login: App.jsx's login-triggered reload fired on every tab switch
// instead of only a real sign-in, and (a longer-standing, quieter version
// of the same bug) every tab switch was also logging a spurious "Signed In"
// row to pmms.login_events, not just real logins. sessionStorage (not a
// plain variable) survives the reload this same flag causes to happen.
export function markGenuineLoginAttempt() {
  sessionStorage.setItem(GENUINE_LOGIN_KEY, '1')
}

export function consumeGenuineLoginAttempt() {
  const val = sessionStorage.getItem(GENUINE_LOGIN_KEY)
  sessionStorage.removeItem(GENUINE_LOGIN_KEY)
  return val === '1'
}

// Fire-and-forget, same tone as the ticket-side postAuditEvent -- a
// login/logout that fails to log shouldn't block the sign-in itself.
// Resolves identity by email (matching every other lookup in this app --
// App.jsx's fetchProfile, pmms.current_staff_id(), current_access_level())
// rather than staff.user_id/auth.uid(), which is unused/unpopulated
// everywhere in the real app.
export async function logLoginEvent(profile, email, eventType) {
  await supabase
    .schema('pmms')
    .from('login_events')
    .insert({
      staff_id: profile?.id || null,
      staff_name: profile?.name || null,
      email,
      event_type: eventType,
      user_agent: navigator.userAgent,
    })
}
