import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ILIKE treats _ and % as wildcards -- both are legal characters in a real
// email's local part, so an unescaped ILIKE lookup could match more than
// just the intended address. Escaping them keeps this a case-insensitive
// exact match, not a search.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

// ── Verify caller + resolve their staff_id, no role requirement ─────────────
// Same identity resolution as authorizeAdmin.ts (verify the bearer token,
// resolve the public.staff row deterministically), minus the "must be
// Admin" check -- for actions any authenticated staff member should be able
// to trigger for themselves, e.g. notify-chat-mention only ever acts on a
// message the caller sent, so there's nothing here that needs Admin-level
// trust the way create-staff-account/reset-staff-password do.
export async function authorizeStaff(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user?.email) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401 })
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // .ilike (not .eq) -- Supabase Auth always lowercases the session email,
  // but staff.email is free-typed and has landed with capitals before,
  // which silently failed this lookup and denied a real staff member every
  // action gated by this check (found live 2026-08-12, via App.jsx's
  // matching login-side bug).
  const { data: staffRows, error: staffError } = await adminClient
    .from('staff')
    .select('id')
    .ilike('email', escapeLikePattern(userData.user.email))
    .order('id')
    .limit(2)

  if (staffError || !staffRows?.length) {
    throw new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403 })
  }
  const staffRow = staffRows[0]

  return { adminClient, callerStaffId: staffRow.id as string }
}
