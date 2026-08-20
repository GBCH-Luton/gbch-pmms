import { supabase } from './supabase'
import { COLORS } from './colors'
import { compressImage } from './imageCompression'
import { getSignedUrl } from './storage'

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
  COLORS.teal600, COLORS.violet600, COLORS.amber500, COLORS.blue700, COLORS.pink600, COLORS.lime600, COLORS.cyan600, COLORS.purple600,
  COLORS.orange700, COLORS.indigo700, COLORS.sky700, COLORS.yellow700, COLORS.pink700, COLORS.green700,
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
//
// One channel object per division carries both bindings (new messages
// and read-receipt updates) rather than opening a second WebSocket
// subscription. `onReadUpdate` fires on both INSERT (someone's first
// ever read in this division) and UPDATE (the upsert hitting their
// existing row on every later read).
export function subscribeToChannel(division, onInsert, onReadUpdate) {
  const channel = supabase
    .channel(`chat:${division}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'pmms', table: 'chat_messages', filter: `division=eq.${division}` },
      (payload) => onInsert(payload.new)
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'pmms', table: 'chat_channel_reads', filter: `division=eq.${division}` },
      (payload) => onReadUpdate?.(payload.new)
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
    let compressed
    try {
      compressed = await compressImage(photoFile)
    } catch (compressErr) {
      return { error: compressErr.message }
    }
    const path = `${senderId}/${Date.now()}-${compressed.name}`
    const { error: uploadError } = await supabase.storage.from('chat-photos').upload(path, compressed)
    if (uploadError) return { error: `Photo upload failed: ${uploadError.message}` }
    photoUrl = await getSignedUrl('chat-photos', path)
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

// Shared, cross-user read watermark (unlike the localStorage-only
// getLastReadAt/markChannelRead pair above) -- one row per
// division+staff member, upserted every time the channel is opened or
// a new message arrives while it's open. This is what powers the
// "Seen by ..." line other people can see, not your own unread badge.
export async function fetchChannelReads(division) {
  const { data, error } = await supabase
    .schema('pmms')
    .from('chat_channel_reads')
    .select('staff_id, last_read_at')
    .eq('division', division)
  if (error) return {}
  return Object.fromEntries((data || []).map((r) => [r.staff_id, r.last_read_at]))
}

export async function markChannelReadRemote(division, staffId) {
  await supabase
    .schema('pmms')
    .from('chat_channel_reads')
    .upsert({ division, staff_id: staffId, last_read_at: new Date().toISOString() }, { onConflict: 'division,staff_id' })
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

// Unlike countUnreadMentions (mentions-only, localStorage watermark --
// what drives the mentions-only push), this counts EVERY new message
// in a division against the shared server-side watermark
// (pmms.chat_channel_reads). For an admin/manager overseeing a
// division's channel, any new message matters, not just ones that
// mention them.
export async function countUnreadMessages(division, myStaffId) {
  const { data: readRow } = await supabase
    .schema('pmms')
    .from('chat_channel_reads')
    .select('last_read_at')
    .eq('division', division)
    .eq('staff_id', myStaffId)
    .maybeSingle()

  let query = supabase
    .schema('pmms')
    .from('chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('division', division)
  if (readRow?.last_read_at) query = query.gt('created_at', readRow.last_read_at)

  const { count } = await query
  return count || 0
}
