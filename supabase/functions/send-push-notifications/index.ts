import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { authorizeAdmin } from '../_shared/authorizeAdmin.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// Every real caller of this function is a manager/admin action (a
// reassign with the push checkbox ticked, a direct assignment, or an
// automatic emergency alert triggered by a priority change) -- gated
// behind the same authorizeAdmin() check create-staff-account uses,
// rather than leaving it open to any authenticated request.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    await authorizeAdmin(req)

    const body = await req.json().catch(() => null)
    const staffIds = Array.isArray(body?.staffIds) ? body.staffIds : []
    const title = (body?.title || '').trim()
    const message = (body?.body || '').trim()

    if (!staffIds.length || !title) {
      return new Response(JSON.stringify({ error: 'staffIds and title are required' }), { status: 400, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const result = await sendWebPushToStaff(adminClient, staffIds, title, message)
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders })
    }
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
