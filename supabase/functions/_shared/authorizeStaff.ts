import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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

  const { data: staffRows, error: staffError } = await adminClient
    .from('staff')
    .select('id')
    .eq('email', userData.user.email)
    .order('id')
    .limit(2)

  if (staffError || !staffRows?.length) {
    throw new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403 })
  }
  const staffRow = staffRows[0]

  return { adminClient, callerStaffId: staffRow.id as string }
}
