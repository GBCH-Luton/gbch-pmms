import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// ILIKE treats _ and % as wildcards -- both are legal characters in a real
// email's local part, so an unescaped ILIKE lookup could match more than
// just the intended address. Escaping them keeps this a case-insensitive
// exact match, not a search.
function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

// Clears the caller's OWN must_reset_password flag, right after they've set
// a new password. Resolves which staff row is "theirs" only from their own
// verified session token -- never from a client-supplied id -- so a user
// can only ever clear their own flag, nobody else's.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser()
    if (userError || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: corsHeaders })
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    // .limit(2) instead of .maybeSingle() -- staff is a company-wide table
    // PMMS doesn't fully control, and has had duplicate-email rows before. A
    // duplicate here must not hard-crash login right after a password reset;
    // take the first match rather than erroring. order('id') makes "the
    // first match" deterministic and matching every other email lookup in
    // this app -- without it, this function could clear one duplicate row's
    // flag while App.jsx's next login check reads a *different* row whose
    // flag is still true, permanently stuck on the set-password screen.
    //
    // .ilike (not .eq) -- Supabase Auth always lowercases the session email,
    // but staff.email is free-typed and has landed with capitals before,
    // which silently failed this lookup right after a brand new staff
    // member sets their password, leaving them stuck on this same screen
    // forever (found live 2026-08-12, via App.jsx's matching login-side bug).
    const { data: staffRows, error: staffError } = await adminClient
      .from('staff')
      .select('id')
      .ilike('email', escapeLikePattern(userData.user.email))
      .order('id')
      .limit(2)
    if (staffError || !staffRows?.length) {
      return new Response(JSON.stringify({ error: 'No staff record found for this account' }), { status: 403, headers: corsHeaders })
    }
    if (staffRows.length > 1) {
      console.warn(`Multiple staff rows found for email ${userData.user.email} -- using the first one.`)
    }
    const staffRow = staffRows[0]

    const { error: updateError } = await adminClient
      .from('staff')
      .update({ must_reset_password: false })
      .eq('id', staffRow.id)
    if (updateError) {
      return new Response(JSON.stringify({ error: updateError.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
