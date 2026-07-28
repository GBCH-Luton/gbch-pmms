import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'

// Mints a real session for another staff member without their password, so
// an admin can "View As" them (see a builder's real dashboard, etc.). Uses
// Supabase's only supported way to do this server-side: generateLink()
// produces a magic-link token without actually sending an email; the client
// exchanges it via verifyOtp() to establish the real session. Every
// eligibility rule below is enforced here, not just hidden in the picker
// UI -- the client can't be trusted to gate this on its own.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { adminClient, callerStaffId } = await authorizeAdmin(req)

    const body = await req.json().catch(() => null)
    const targetStaffId = body?.staffId
    if (!targetStaffId) {
      return new Response(JSON.stringify({ error: 'staffId is required' }), { status: 400, headers: corsHeaders })
    }
    if (targetStaffId === callerStaffId) {
      return new Response(JSON.stringify({ error: 'You cannot view as yourself' }), { status: 400, headers: corsHeaders })
    }

    const { data: targetStaff, error: targetError } = await adminClient
      .from('staff')
      .select('id, name, email, active, must_reset_password')
      .eq('id', targetStaffId)
      .maybeSingle()
    if (targetError || !targetStaff) {
      return new Response(JSON.stringify({ error: 'Staff record not found' }), { status: 404, headers: corsHeaders })
    }
    if (targetStaff.active === false) {
      return new Response(JSON.stringify({ error: 'Cannot view as a deactivated staff member' }), { status: 400, headers: corsHeaders })
    }
    if (targetStaff.must_reset_password) {
      return new Response(JSON.stringify({ error: 'This staff member has a pending password reset and cannot be viewed as yet' }), { status: 400, headers: corsHeaders })
    }

    const { data: targetRoleRow } = await adminClient
      .schema('pmms')
      .from('staff_roles')
      .select('role')
      .eq('staff_id', targetStaffId)
      .maybeSingle()
    if (targetRoleRow?.role === 'Admin') {
      return new Response(JSON.stringify({ error: 'Cannot view as another Admin' }), { status: 400, headers: corsHeaders })
    }

    const { data: callerStaff } = await adminClient
      .from('staff')
      .select('name')
      .eq('id', callerStaffId)
      .maybeSingle()

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email: targetStaff.email,
    })
    if (linkError || !linkData?.properties?.hashed_token) {
      return new Response(JSON.stringify({ error: linkError?.message || 'Could not generate a session for this staff member' }), { status: 400, headers: corsHeaders })
    }

    const { data: eventRow, error: eventError } = await adminClient
      .schema('pmms')
      .from('impersonation_events')
      .insert({
        admin_staff_id: callerStaffId,
        admin_name: callerStaff?.name || null,
        target_staff_id: targetStaffId,
        target_name: targetStaff.name,
        user_agent: req.headers.get('user-agent') || null,
      })
      .select('id')
      .single()
    if (eventError) {
      return new Response(JSON.stringify({ error: eventError.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({
      email: targetStaff.email,
      hashedToken: linkData.properties.hashed_token,
      targetName: targetStaff.name,
      impersonationEventId: eventRow.id,
    }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
