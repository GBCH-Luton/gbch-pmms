import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ILIKE treats _ and % as wildcards -- both are legal characters in a real
// email's local part, so an unescaped ILIKE lookup could match more than
// just the intended address. Escaping them keeps this a case-insensitive
// exact match, not a search.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

// ── Verify caller + confirm they're a PMMS admin ────────────────────────────
// Verifies the caller's bearer token against Supabase Auth, resolves their
// public.staff row, then checks pmms.staff_roles for the PMMS "Admin" role --
// deliberately NOT public.staff.role, which is a shared, company-wide field
// this app already treats as untrustworthy for access control (someone
// being "admin" in some other system on this same Supabase project doesn't
// make them a PMMS admin, and vice versa -- see pmms.staff_roles' own design
// notes). Throws a Response the caller should return as-is on failure.
export async function authorizeAdmin(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Low-privilege client, scoped to the caller's own token -- only used to
  // verify who they are.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData?.user?.email) {
    throw new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401 })
  }

  // Service-role client -- only ever used server-side, never returned to
  // the client or logged.
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  // .limit(2) instead of .maybeSingle() -- staff is a company-wide table
  // PMMS doesn't fully control, and has had duplicate-email rows before. A
  // duplicate here must not hard-crash every admin action; take the first
  // match rather than erroring. order('id') makes "the first match"
  // deterministic -- every other email lookup in this app orders the same
  // way, so a caller's write (e.g. clear-force-reset-flag) and a later read
  // (e.g. App.jsx's login check) always agree on which row is "theirs"
  // instead of potentially picking different rows on different queries.
  //
  // .ilike (not .eq) -- Supabase Auth always lowercases the session email,
  // but staff.email is free-typed and has landed with capitals before,
  // which silently failed this lookup and denied a real admin every admin
  // action (found live 2026-08-12, via App.jsx's matching login-side bug).
  const { data: staffRows, error: staffError } = await adminClient
    .from('staff')
    .select('id')
    .ilike('email', escapeLikePattern(userData.user.email))
    .order('id')
    .limit(2)

  if (staffError || !staffRows?.length) {
    throw new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403 })
  }
  if (staffRows.length > 1) {
    console.warn(`Multiple staff rows found for email ${userData.user.email} -- using the first one.`)
  }
  const staffRow = staffRows[0]

  const { data: roleRow } = await adminClient
    .schema('pmms')
    .from('staff_roles')
    .select('role')
    .eq('staff_id', staffRow.id)
    .maybeSingle()

  if (roleRow?.role !== 'Admin') {
    throw new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403 })
  }

  return { adminClient, callerStaffId: staffRow.id as string }
}
