// Division-scoped team chat, plus one-to-one Direct Messages. RLS on
// pmms.chat_messages (division match) and pmms.dm_messages (sender/
// recipient match) are the real restrictions -- see
// scripts/add_pmms_chat_messages_table.sql and
// scripts/add_pmms_dm_messages_table.sql. An unscoped Admin/Manager gets a
// channel picker across every division; a division-scoped Manager just
// sees their own division directly, no picker needed (same simplification
// already used on the Builder mobile view). Direct Messages aren't
// division-scoped, so that part of the rail always shows regardless.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { fetchDivisions } from '../../lib/divisions'
import { fetchChannelMessages, subscribeToChannel, postMessage, markChannelRead, markChannelReadRemote, fetchChannelReads, countUnreadMessages, colorForSender } from '../../lib/chat'
import { fetchDmContacts, fetchConversations, fetchThreadMessages, subscribeToDm, postDm, markThreadRead } from '../../lib/dm'
import { Avatar, formatUKDateTime } from './shared'
import { NavIcon } from '../../lib/icons'
import ChatComposer from '../../components/ChatComposer'
import PhotoLightbox from '../../components/PhotoLightbox'

const UNREAD_POLL_MS = 20000

export default function AdminTeamChat({ profile }) {
  const [mode, setMode] = useState('channel') // 'channel' | 'dm'
  const [divisions, setDivisions] = useState([])
  const [activeDivision, setActiveDivision] = useState(profile.division || null)
  const [members, setMembers] = useState([])
  const [messages, setMessages] = useState([])
  const [channelReads, setChannelReads] = useState({})
  const [unreadByDivision, setUnreadByDivision] = useState({})
  const [sending, setSending] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const listRef = useRef(null)

  const [conversations, setConversations] = useState([])
  const [activeContact, setActiveContact] = useState(null) // { id, name }
  const [dmMessages, setDmMessages] = useState([])
  const [dmSending, setDmSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dmContacts, setDmContacts] = useState([])
  const [contactSearch, setContactSearch] = useState('')

  const isUnscoped = !profile.division

  useEffect(() => {
    if (isUnscoped) {
      fetchDivisions().then(divs => {
        setDivisions(divs)
        setActiveDivision(prev => prev || divs[0])
      })
    }
  }, [])

  // Per-channel unread counts for the picker -- only meaningful when
  // there's more than one channel to pick between (isUnscoped). Polled
  // rather than pushed, same as every other count in this app.
  useEffect(() => {
    if (!isUnscoped || divisions.length === 0) return
    let cancelled = false

    async function refreshUnreadCounts() {
      const entries = await Promise.all(divisions.map(async d => [d, await countUnreadMessages(d, profile.id)]))
      if (!cancelled) setUnreadByDivision(Object.fromEntries(entries))
    }

    refreshUnreadCounts()
    const interval = setInterval(refreshUnreadCounts, UNREAD_POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [isUnscoped, divisions, profile.id])

  useEffect(() => {
    if (!activeDivision) return
    let cancelled = false

    fetchChannelMessages(activeDivision).then(rows => { if (!cancelled) setMessages(rows) })
    fetchChannelMembers(activeDivision).then(rows => { if (!cancelled) setMembers(rows) })
    fetchChannelReads(activeDivision).then(reads => { if (!cancelled) setChannelReads(reads) })
    markChannelRead(activeDivision)
    markChannelReadRemote(activeDivision, profile.id)

    const unsubscribe = subscribeToChannel(
      activeDivision,
      (newMessage) => {
        setMessages(prev => [...prev, newMessage])
        markChannelRead(activeDivision)
        markChannelReadRemote(activeDivision, profile.id)
      },
      (read) => {
        setChannelReads(prev => ({ ...prev, [read.staff_id]: read.last_read_at }))
      }
    )

    return () => { cancelled = true; unsubscribe() }
  }, [activeDivision])

  // Direct Messages: conversation list + contacts, loaded once regardless
  // of which mode is active so the rail's previews/unread badges are
  // always current, not just while a DM thread happens to be open.
  useEffect(() => {
    refreshConversations()
    fetchDmContacts().then(setDmContacts)

    const unsubscribe = subscribeToDm(
      (newMessage) => {
        setDmMessages(prev => {
          const inThisThread = activeContactRef.current && (
            (newMessage.sender_id === profile.id && newMessage.recipient_id === activeContactRef.current.id) ||
            (newMessage.sender_id === activeContactRef.current.id && newMessage.recipient_id === profile.id)
          )
          if (!inThisThread) return prev
          if (newMessage.recipient_id === profile.id) markThreadRead(profile.id, newMessage.sender_id)
          return [...prev, newMessage]
        })
        refreshConversations()
      },
      () => refreshConversations()
    )
    return unsubscribe
  }, [])

  // subscribeToDm's INSERT handler closes over activeContact from the
  // render it was created in (mount time, always null) -- a ref keeps it
  // reading the CURRENT open thread instead, without resubscribing every
  // time the user switches conversations.
  const activeContactRef = useRef(activeContact)
  useEffect(() => { activeContactRef.current = activeContact }, [activeContact])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages, dmMessages])

  async function refreshConversations() {
    const rows = await fetchConversations(profile.id)
    setConversations(rows)
  }

  async function fetchChannelMembers(division) {
    // Builders can only SELECT their own row in public.staff (see
    // pmms.chat_channel_members()'s own comment) -- this SECURITY DEFINER
    // function is what lets ANY caller, admin/manager/builder alike, get
    // the id/name list the @mention picker needs, without loosening
    // public.staff's RLS itself. Scoped to THIS division specifically
    // (plus Admins/unscoped managers, who can see every channel) -- an
    // earlier version returned everyone regardless of division, letting
    // someone @mention a person who could never see/respond in this
    // channel at all.
    const { data } = await supabase.schema('pmms').rpc('chat_channel_members', { target_division: division })
    return data || []
  }

  async function handleSend(body, mentionedIds, photoFile) {
    setSending(true)
    await postMessage({
      division: activeDivision, senderId: profile.id, senderName: profile.name,
      body, mentionedStaffIds: mentionedIds, photoFile,
    })
    setSending(false)
  }

  async function openDm(contact) {
    setMode('dm')
    setActiveContact(contact)
    setDmMessages(await fetchThreadMessages(profile.id, contact.id))
    await markThreadRead(profile.id, contact.id)
    refreshConversations()
  }

  async function handleSendDm(body, _mentionedIds, photoFile) {
    if (!activeContact) return
    setDmSending(true)
    await postDm({ senderId: profile.id, senderName: profile.name, recipientId: activeContact.id, body, photoFile })
    setDmSending(false)
  }

  const filteredContacts = dmContacts.filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase()))

  return (
    <div style={{ padding: '24px', display: 'flex', gap: '16px', height: 'calc(100vh - 48px)' }}>
      <div style={{ width: '220px', flexShrink: 0, background: COLORS.white, borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, overflowY: 'auto', height: 'fit-content', maxHeight: '100%' }}>
        {isUnscoped && (
          <>
            <p style={{ margin: 0, padding: '12px 16px', fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${COLORS.slate200}` }}>
              Channels
            </p>
            {divisions.map(d => (
              <button
                key={d}
                onClick={() => {
                  setMode('channel')
                  setActiveDivision(d)
                  setUnreadByDivision(prev => ({ ...prev, [d]: 0 }))
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left', padding: '10px 16px',
                  background: mode === 'channel' && activeDivision === d ? COLORS.green50 : 'none', border: 'none',
                  borderLeft: mode === 'channel' && activeDivision === d ? `3px solid ${COLORS.greenDark}` : '3px solid transparent',
                  fontSize: '13px', fontWeight: mode === 'channel' && activeDivision === d ? 800 : 600,
                  color: mode === 'channel' && activeDivision === d ? COLORS.greenDark : COLORS.slate900, cursor: 'pointer',
                }}
              >
                <span>💬 {d}</span>
                {unreadByDivision[d] > 0 && (
                  <span
                    style={{
                      background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800,
                      borderRadius: '999px', padding: '1px 8px', minWidth: '20px', textAlign: 'center', flexShrink: 0,
                    }}
                  >
                    {unreadByDivision[d]}
                  </span>
                )}
              </button>
            ))}
          </>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${COLORS.slate200}`, borderTop: isUnscoped ? `1px solid ${COLORS.slate200}` : 'none' }}>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Direct Messages</p>
          <button
            onClick={() => { setPickerOpen(true); setContactSearch('') }}
            style={{ background: 'none', border: 'none', color: COLORS.greenDark, fontSize: '11px', fontWeight: 800, cursor: 'pointer', padding: '2px 4px' }}
          >
            + New
          </button>
        </div>
        {conversations.length === 0 && (
          <p style={{ margin: 0, padding: '14px 16px', fontSize: '12px', color: COLORS.slate400 }}>No conversations yet</p>
        )}
        {conversations.map(c => {
          // The other party's name: read straight off the last message
          // when they sent it (sender_name is stored per-row already), or
          // fall back to the contacts list when I sent it last -- a DM row
          // only ever stores its own sender's name, not the recipient's.
          const otherName = c.lastMessage.sender_id === c.otherId ? c.lastMessage.sender_name : (dmContacts.find(dc => dc.id === c.otherId)?.name || '...')
          const isActive = mode === 'dm' && activeContact?.id === c.otherId
          return (
            <button
              key={c.otherId}
              onClick={() => openDm({ id: c.otherId, name: otherName })}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '9px 16px',
                background: isActive ? COLORS.green50 : 'none', border: 'none',
                borderLeft: isActive ? `3px solid ${COLORS.greenDark}` : '3px solid transparent',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              <Avatar name={otherName} size={30} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: isActive ? COLORS.greenDark : COLORS.slate900 }}>{otherName}</span>
                <span style={{ display: 'block', fontSize: '11.5px', color: COLORS.slate400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.lastMessage.body || (c.lastMessage.photo_url ? 'Photo' : '')}
                </span>
              </span>
              {c.unreadCount > 0 && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: COLORS.red600, flexShrink: 0 }} />}
            </button>
          )
        })}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: COLORS.white, borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, overflow: 'hidden', minWidth: 0 }}>
        {mode === 'channel' && (
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.slate200}` }}>
            <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>💬 {activeDivision || '...'} Team Chat</h1>
          </div>
        )}
        {mode === 'dm' && activeContact && (
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.slate200}` }}>
            <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Avatar name={activeContact.name} size={22} />
              {activeContact.name}
            </h1>
            <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: COLORS.slate500, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', background: COLORS.green50, color: COLORS.greenDark, fontSize: '10.5px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>
                <NavIcon name="lock" size={10} /> Private
              </span>
              Only you and {activeContact.name} can see this
            </p>
          </div>
        )}

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {mode === 'channel' && messages.length === 0 && (
            <p style={{ margin: 'auto', color: COLORS.slate400, fontSize: '13px' }}>No messages yet -- say hello 👋</p>
          )}
          {mode === 'channel' && messages.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', gap: '10px' }}>
              <Avatar name={m.sender_name} size={32} />
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: colorForSender(m.sender_id) }}>{m.sender_name}</span>
                  <span style={{ fontSize: '11px', color: COLORS.slate400 }}>{formatUKDateTime(m.created_at)}</span>
                </div>
                {m.body && <p style={{ margin: '2px 0 0', fontSize: '13.5px', color: COLORS.gray700 }}>{m.body}</p>}
                {m.photo_url && (
                  <img
                    src={m.photo_url}
                    alt=""
                    onClick={() => setLightboxUrl(m.photo_url)}
                    style={{ marginTop: '6px', maxWidth: '220px', maxHeight: '220px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, display: 'block', cursor: 'pointer' }}
                  />
                )}
                {i === messages.length - 1 && (() => {
                  const seenBy = members
                    .filter(mem => mem.id !== m.sender_id && mem.id !== profile.id && channelReads[mem.id] && new Date(channelReads[mem.id]) >= new Date(m.created_at))
                    .map(mem => mem.name)
                  return seenBy.length > 0 && (
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: COLORS.slate400 }}>Seen by {seenBy.join(', ')}</p>
                  )
                })()}
              </div>
            </div>
          ))}

          {mode === 'dm' && activeContact && dmMessages.length === 0 && (
            <p style={{ margin: 'auto', color: COLORS.slate400, fontSize: '13px' }}>No messages yet -- say hello 👋</p>
          )}
          {mode === 'dm' && dmMessages.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', gap: '10px' }}>
              <Avatar name={m.sender_name} size={32} />
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: colorForSender(m.sender_id) }}>{m.sender_id === profile.id ? 'You' : m.sender_name}</span>
                  <span style={{ fontSize: '11px', color: COLORS.slate400 }}>{formatUKDateTime(m.created_at)}</span>
                </div>
                {m.body && <p style={{ margin: '2px 0 0', fontSize: '13.5px', color: COLORS.gray700 }}>{m.body}</p>}
                {m.photo_url && (
                  <img
                    src={m.photo_url}
                    alt=""
                    onClick={() => setLightboxUrl(m.photo_url)}
                    style={{ marginTop: '6px', maxWidth: '220px', maxHeight: '220px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, display: 'block', cursor: 'pointer' }}
                  />
                )}
                {i === dmMessages.length - 1 && m.sender_id === profile.id && m.read_at && (
                  <p style={{ margin: '4px 0 0', fontSize: '11px', color: COLORS.slate400 }}>Seen by {activeContact.name}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {mode === 'channel' && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${COLORS.slate200}` }}>
            <ChatComposer
              members={members}
              onSend={handleSend}
              sending={sending}
              inputStyle={{ flex: 1, padding: '9px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', fontFamily: 'inherit' }}
              sendButtonStyle={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: COLORS.greenDark, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            />
          </div>
        )}
        {mode === 'dm' && activeContact && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${COLORS.slate200}` }}>
            <ChatComposer
              members={[]}
              onSend={handleSendDm}
              sending={dmSending}
              placeholder={`Message ${activeContact.name}...`}
              inputStyle={{ flex: 1, padding: '9px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', fontFamily: 'inherit' }}
              sendButtonStyle={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: COLORS.greenDark, color: COLORS.white, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            />
          </div>
        )}
      </div>

      {pickerOpen && (
        <div
          onClick={() => setPickerOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 40 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '300px', maxHeight: '70vh', background: COLORS.white, borderRadius: '12px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <p style={{ margin: 0, padding: '14px 16px', fontSize: '13px', fontWeight: 800, color: COLORS.slate900, borderBottom: `1px solid ${COLORS.slate200}` }}>New direct message</p>
            <div style={{ padding: '10px 14px' }}>
              <input
                autoFocus
                value={contactSearch}
                onChange={(e) => setContactSearch(e.target.value)}
                placeholder="Search staff by name..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ overflowY: 'auto', paddingBottom: '8px' }}>
              {filteredContacts.length === 0 && (
                <p style={{ margin: 0, padding: '10px 16px', fontSize: '12px', color: COLORS.slate400 }}>No staff found</p>
              )}
              {filteredContacts.map(c => (
                <button
                  key={c.id}
                  onClick={() => { setPickerOpen(false); openDm(c) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Avatar name={c.name} size={28} />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}
