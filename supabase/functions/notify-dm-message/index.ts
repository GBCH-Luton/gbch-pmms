import { corsHeaders } from '../_shared/cors.ts'
import { authorizeStaff } from '../_shared/authorizeStaff.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// Pushes a notification to the recipient of a direct message. Unlike Team
// Chat's notify-chat-mention (push only on an explicit @mention, since a
// channel message is otherwise addressed to everyone), a DM is always
// addressed to exactly one person -- so every DM pushes, the same way an
// @mention does.
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
      .from('dm_messages')
      .select('sender_id, sender_name, recipient_id, body')
      .eq('id', messageId)
      .maybeSingle()

    if (messageError || !message) {
      return new Response(JSON.stringify({ error: 'Message not found' }), { status: 404, headers: corsHeaders })
    }
    if (message.sender_id !== callerStaffId) {
      return new Response(JSON.stringify({ error: 'You can only notify for a message you sent' }), { status: 403, headers: corsHeaders })
    }

    const result = await sendWebPushToStaff(
      adminClient,
      [message.recipient_id],
      `${message.sender_name} sent you a message`,
      message.body || 'Sent a photo',
    )

    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
