import { supabase } from './supabase'
import { compressImage } from './imageCompression'

const MESSAGE_LIMIT = 200
const CONVERSATION_SCAN_LIMIT = 500

// Who's eligible to start a new conversation with -- pmms.dm_contacts()
// (SECURITY DEFINER) already filters to active staff with a real PMMS
// role, same reasoning as pmms.chat_channel_members() for the @mention
// picker: a plain public.staff SELECT would either be empty (builders)
// or include people from other company systems entirely.
export async function fetchDmContacts() {
  const { data, error } = await supabase.schema('pmms').rpc('dm_contacts')
  return error ? [] : (data || [])
}

// One row per conversation partner: their most recent message (for the
// preview line) plus an unread count. Built client-side from a scan of
// recent rows rather than a database view -- there's no "how many
// conversations" scale concern here (a handful of staff, at most a few
// hundred DMs total), so this is simpler than maintaining a second table.
export async function fetchConversations(myStaffId) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('dm_messages')
    .select('id, sender_id, recipient_id, sender_name, body, photo_url, created_at, read_at')
    .or(`sender_id.eq.${myStaffId},recipient_id.eq.${myStaffId}`)
    .order('created_at', { ascending: false })
    .limit(CONVERSATION_SCAN_LIMIT)
  if (error) return []

  const byContact = new Map()
  for (const row of data || []) {
    const otherId = row.sender_id === myStaffId ? row.recipient_id : row.sender_id
    const existing = byContact.get(otherId)
    if (!existing) {
      byContact.set(otherId, { otherId, lastMessage: row, unreadCount: 0 })
    }
    if (row.recipient_id === myStaffId && !row.read_at) {
      byContact.get(otherId).unreadCount += 1
    }
  }
  return Array.from(byContact.values()).sort((a, b) => new Date(b.lastMessage.created_at) - new Date(a.lastMessage.created_at))
}

export async function fetchThreadMessages(myStaffId, otherStaffId) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('dm_messages')
    .select('id, sender_id, recipient_id, sender_name, body, photo_url, created_at, read_at')
    .or(`and(sender_id.eq.${myStaffId},recipient_id.eq.${otherStaffId}),and(sender_id.eq.${otherStaffId},recipient_id.eq.${myStaffId})`)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT)
  return error ? [] : (data || [])
}

// Single channel per session (not one per open thread) -- RLS on
// pmms.dm_messages already means the underlying postgres_changes feed
// only ever delivers rows this staff member sent or received, so one
// subscription covers every conversation at once. Whoever's using it
// decides what to do with a row that isn't the thread currently open
// (e.g. bump a conversation-list preview instead).
export function subscribeToDm(onInsert, onUpdate) {
  const channel = supabase
    .channel(`dm:${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'pmms', table: 'dm_messages' }, (payload) => onInsert(payload.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'pmms', table: 'dm_messages' }, (payload) => onUpdate?.(payload.new))
    .subscribe()

  return () => supabase.removeChannel(channel)
}

export async function postDm({ senderId, senderName, recipientId, body, photoFile }) {
  let photoUrl = null
  if (photoFile) {
    const compressed = await compressImage(photoFile)
    const path = `${senderId}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('chat-photos').upload(path, compressed)
    if (uploadError) return { error: `Photo upload failed: ${uploadError.message}` }
    photoUrl = supabase.storage.from('chat-photos').getPublicUrl(path).data.publicUrl
  }

  const { data, error } = await supabase
    .schema('pmms')
    .from('dm_messages')
    .insert({ sender_id: senderId, sender_name: senderName, recipient_id: recipientId, body, photo_url: photoUrl })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // Fire-and-forget, same as the mentions push -- a failed push must
  // never block the message itself from having been sent.
  supabase.functions.invoke('notify-dm-message', { body: { messageId: data.id } }).catch(() => {})
  return { error: null }
}

export async function markThreadRead(myStaffId, otherStaffId) {
  await supabase
    .schema('pmms')
    .from('dm_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', myStaffId)
    .eq('sender_id', otherStaffId)
    .is('read_at', null)
}

export async function countUnreadDms(myStaffId) {
  const { count } = await supabase
    .schema('pmms')
    .from('dm_messages')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', myStaffId)
    .is('read_at', null)
  return count || 0
}
