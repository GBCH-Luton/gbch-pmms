import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'
import { generateTempPassword } from '../_shared/tempPassword.ts'
import { findAuthUserByEmail } from '../_shared/findAuthUserByEmail.ts'

// Ensures a staff member has a working login with a fresh temp password,
// forcing them to set a new one on next login -- covers both a genuine
// reset (they already had a login) and a first-time login (a staff row
// that exists, e.g. from the original company import, but was never given
// PMMS access). Acts on a specific staff row id (never "whichever row has
// this email") since this database has had duplicate-email staff rows
// before.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── 1 & 2. Verify caller + confirm they're a PMMS admin ─────────────────
    const { adminClient } = await authorizeAdmin(req)

    // ── 3. Parse and validate the request body ──────────────────────────────
    const body = await req.json().catch(() => null)
    const staffId = body?.staffId
    if (!staffId) {
      return new Response(JSON.stringify({ error: 'staffId is required' }), { status: 400, headers: corsHeaders })
    }

    // ── 4. Find the target staff row + their auth account ───────────────────
    const { data: staffRow, error: staffError } = await adminClient
      .from('staff')
      .select('id, email, name')
      .eq('id', staffId)
      .maybeSingle()
    if (staffError || !staffRow) {
      return new Response(JSON.stringify({ error: 'Staff record not found' }), { status: 404, headers: corsHeaders })
    }

    const authUser = await findAuthUserByEmail(adminClient, staffRow.email || '')

    const tempPassword = generateTempPassword()

    if (authUser) {
      // ── 5a. Auth account exists — update the password ─────────────────────
      const { error: updateError } = await adminClient.auth.admin.updateUserById(authUser.id, { password: tempPassword })
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 400, headers: corsHeaders })
      }
    } else {
      // ── 5b. No auth account yet — create one on the spot ───────────────────
      // (a staff row with no login, e.g. from the original company import)
      const { error: createError } = await adminClient.auth.admin.createUser({
        email: staffRow.email, password: tempPassword, email_confirm: true,
      })
      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), { status: 400, headers: corsHeaders })
      }
    }

    // ── 6. Flag the staff record — login will redirect them to set a new password ─
    const { error: flagError } = await adminClient
      .from('staff')
      .update({ must_reset_password: true })
      .eq('id', staffId)
    if (flagError) {
      return new Response(JSON.stringify({ error: flagError.message }), { status: 400, headers: corsHeaders })
    }

    // ── 7. Return the temp password — shown once, never stored in plain text ──
    return new Response(JSON.stringify({ tempPassword }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
