import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'
import { generateTempPassword } from '../_shared/tempPassword.ts'

// Creates a brand-new person: a Supabase Auth login (with a one-time temp
// password) + their public.staff row + their pmms.staff_roles assignment.
// Only for people who don't already have a staff record -- re-adding an
// existing person to a new PMMS role is handled entirely client-side
// (no auth account changes needed) and never reaches this function.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    // ── 1 & 2. Verify caller + confirm they're a PMMS admin ─────────────────
    const { adminClient } = await authorizeAdmin(req)

    // ── 3. Parse and validate the request body ──────────────────────────────
    const body = await req.json().catch(() => null)
    if (!body) {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders })
    }
    const name = (body.name || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    const jobTitle = (body.job_title || '').trim() || null
    const phone = (body.phone || '').trim() || null
    const role = (body.role || '').trim()
    const skills = Array.isArray(body.skills) ? body.skills : null
    if (!name || !email || !role) {
      return new Response(JSON.stringify({ error: 'name, email, and role are required' }), { status: 400, headers: corsHeaders })
    }

    // Refuse if a staff record for this email already exists -- that's the
    // "existing person, new role" case, which doesn't touch auth at all and
    // should never reach this function. .limit(1) instead of .maybeSingle()
    // -- if a duplicate-email row ever exists, .maybeSingle() would return
    // an (ignored) error and null data, letting this silently create a third
    // duplicate instead of refusing.
    const { data: existingStaffRows } = await adminClient
      .from('staff')
      .select('id')
      .eq('email', email)
      .limit(1)
    if (existingStaffRows?.length) {
      return new Response(JSON.stringify({ error: 'A staff record already exists for this email. Use the existing-staff assignment flow instead.' }), { status: 400, headers: corsHeaders })
    }

    const tempPassword = generateTempPassword()

    // ── 4/5. Create the auth account (or reuse an orphaned one) ─────────────
    let authUserId: string
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email, password: tempPassword, email_confirm: true,
    })

    if (createError) {
      // Auth account already exists for this email with no matching staff
      // row (e.g. a former staff member's account never got cleaned up) --
      // fall back to reusing it with a fresh temp password rather than
      // erroring out.
      const { data: listData, error: listError } = await adminClient.auth.admin.listUsers()
      const existingAuthUser = !listError ? listData?.users?.find(u => u.email?.toLowerCase() === email) : null
      if (!existingAuthUser) {
        return new Response(JSON.stringify({ error: createError.message }), { status: 400, headers: corsHeaders })
      }
      const { error: updateError } = await adminClient.auth.admin.updateUserById(existingAuthUser.id, { password: tempPassword })
      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), { status: 400, headers: corsHeaders })
      }
      authUserId = existingAuthUser.id
    } else {
      authUserId = created.user.id
    }

    // ── 6. Create the staff row ──────────────────────────────────────────────
    const { data: staffRow, error: staffError } = await adminClient
      .from('staff')
      .insert({ name, email, job_title: jobTitle, phone, skills, active: true, must_reset_password: true })
      .select()
      .single()

    if (staffError) {
      return new Response(JSON.stringify({ error: staffError.message }), { status: 400, headers: corsHeaders })
    }

    // ── 7. Assign the PMMS role -- roll back the staff row on failure so we
    // never leave an orphaned, role-less account ────────────────────────────
    const { error: roleError } = await adminClient
      .schema('pmms')
      .from('staff_roles')
      .upsert({ staff_id: staffRow.id, role }, { onConflict: 'staff_id' })

    if (roleError) {
      await adminClient.from('staff').delete().eq('id', staffRow.id)
      return new Response(JSON.stringify({ error: roleError.message }), { status: 400, headers: corsHeaders })
    }

    // ── 8. Return the temp password -- shown once, never stored in plain text ─
    return new Response(JSON.stringify({ tempPassword, staff: { ...staffRow, role } }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
