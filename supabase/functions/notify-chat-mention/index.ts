import { corsHeaders } from '../_shared/cors.ts'
import { authorizeStaff } from '../_shared/authorizeStaff.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// Pushes a notification to whoever was @mentioned in a Team Chat message --
// deliberately NOT the existing send-push-notifications function (that one
// is Admin-gated via authorizeAdmin, for manager/admin-triggered alerts).
// Any staff member can @mention a colleague in chat, so this needs a caller
// model where any authenticated staff member can trigger it -- but only for
// a message they actually sent, and only to people actually recorded as
// mentioned on that row (never trusting staff IDs the client might send
// directly).
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { adminClient, callerStaffId } = await authorizeStaff(req)

    const body = await req.json().catch(() => null)
    const messageId = body?.messageId
    if (!messageId) {
      return new Response(JSON.stringify({ error: 'messageId is required' }), { status: 400, headers: corsHeaders })
    }

    const { data: message, error: messageError } = await adminClient
      .schema('pmms')
      .from('chat_messages')
      .select('sender_id, sender_name, division, body, mentioned_staff_ids')
      .eq('id', messageId)
      .maybeSingle()

    if (messageError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: corsHeaders })
    }
    if (message.sender_id !== callerStaffId) {
      return new Response(JSON.stringify({ error: 'You can only notify mentions for a message you sent' }), { status: 403, headers: corsHeaders })
    }

    const mentionedIds: string[] = message.mentioned_staff_ids || []
    if (mentionedIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, total: 0 }), { status: 200, headers: corsHeaders })
    }

    const result = await sendWebPushToStaff(
      adminClient,
      mentionedIds,
      `${message.sender_name} mentioned you in #${message.division}`,
      message.body,
    )

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
