import { supabase } from './supabase'

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
