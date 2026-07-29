import { supabase } from './supabase'
import { compressImage } from './imageCompression'

const LAST_READ_PREFIX = 'pmms_chat_last_read_'
const MESSAGE_LIMIT = 200

// Deterministic per-sender colour so scanning a channel for who said what
// is quicker -- same sender always gets the same colour, chosen from a
// fixed set (not a generated hue) so every pairing stays legible. A small
// team can still collide by chance with any finite palette (confirmed
// live: 2 test accounts landed on the same one out of 8) -- a wider set
// makes that far less likely without changing the approach. Avoids
// #dc2626 (reserved for urgent/unread badges elsewhere in this app) and
// the brand green (already used for "your own" message bubbles).
const SENDER_COLOURS = [
  '#0d9488', '#7c3aed', '#f59e0b', '#1d4ed8', '#db2777', '#65a30d', '#0891b2', '#9333ea',
  '#c2410c', '#4338ca', '#0369a1', '#a16207', '#be185d', '#15803d',
]

export function colorForSender(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  return SENDER_COLOURS[hash % SENDER_COLOURS.length]
}

export async function fetchChannelMessages(division) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('chat_messages')
    .select('id, division, sender_id, sender_name, body, photo_url, mentioned_staff_ids, created_at')
    .eq('division', division)
    .order('created_at', { ascending: true })
    .limit(MESSAGE_LIMIT)
  return error ? [] : (data || [])
}

// This app's first use of Supabase Realtime -- everything else "live"
// today is setInterval polling. RLS applies to the underlying
// postgres_changes feed the same as any normal query, so a
// division-scoped manager/builder simply never receives events for a
// division they can't read; no extra filtering needed beyond the
// `filter` below (which is just an efficiency narrowing, not the real
// security boundary).
export function subscribeToChannel(division, onInsert) {
  const channel = supabase
    .channel(`chat:${division}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'pmms', table: 'chat_messages', filter: `division=eq.${division}` },
      (payload) => onInsert(payload.new)
    )
    .subscribe()

  return () => supabase.removeChannel(channel)
}

// Mentions are tracked structurally (mentionedStaffIds, collected by the
// composer's own @-picker), not parsed back out of the message text --
// far more reliable than matching "@Name" strings against the staff list
// after the fact. The push-on-mention call is fire-and-forget: a push
// failing must never block the message itself from having been sent.
export async function postMessage({ division, senderId, senderName, body, mentionedStaffIds, photoFile }) {
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
    .from('chat_messages')
    .insert({
      division, sender_id: senderId, sender_name: senderName, body, photo_url: photoUrl,
      mentioned_staff_ids: mentionedStaffIds || [],
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  if (mentionedStaffIds?.length) {
    supabase.functions.invoke('notify-chat-mention', { body: { messageId: data.id } }).catch(() => {})
  }
  return { error: null }
}

// Device-local (not synced across a staff member's devices) -- enough
// for a first pass. Used only to compute the unread-*mentions* badge,
// deliberately not "any new message," matching the same reasoning
// behind mentions-only push (see notify-chat-mention/index.ts).
export function getLastReadAt(division) {
  return localStorage.getItem(`${LAST_READ_PREFIX}${division}`) || null
}

export function markChannelRead(division) {
  localStorage.setItem(`${LAST_READ_PREFIX}${division}`, new Date().toISOString())
}

export async function countUnreadMentions(division, myStaffId) {
  const lastRead = getLastReadAt(division)
  let query = supabase
    .schema('pmms')
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('division', division)
    .contains('mentioned_staff_ids', [myStaffId])
  if (lastRead) query = query.gt('created_at', lastRead)

  const { count } = await query
  return count || 0
}
