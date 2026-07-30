// Division-scoped team chat. RLS on pmms.chat_messages is the real
// restriction (see scripts/add_pmms_chat_messages_table.sql) -- an
// unscoped Admin/Manager gets a channel picker across every division;
// a division-scoped Manager just sees their own division directly, no
// picker needed (same simplification already used on the Builder
// mobile view, since there's nothing useful to pick between).

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchDivisions } from '../../lib/divisions'
import { fetchChannelMessages, subscribeToChannel, postMessage, markChannelRead, markChannelReadRemote, fetchChannelReads, colorForSender } from '../../lib/chat'
import { Avatar, formatUKDateTime } from './shared'
import ChatComposer from '../../components/ChatComposer'
import PhotoLightbox from '../../components/PhotoLightbox'

export default function AdminTeamChat({ profile }) {
  const [divisions, setDivisions] = useState([])
  const [activeDivision, setActiveDivision] = useState(profile.division || null)
  const [members, setMembers] = useState([])
  const [messages, setMessages] = useState([])
  const [channelReads, setChannelReads] = useState({})
  const [sending, setSending] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const listRef = useRef(null)

  const isUnscoped = !profile.division

  useEffect(() => {
    if (isUnscoped) {
      fetchDivisions().then(divs => {
        setDivisions(divs)
        setActiveDivision(prev => prev || divs[0])
      })
    }
  }, [])

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

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

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

  return (
    <div style={{ padding: '24px', display: 'flex', gap: '16px', height: 'calc(100vh - 48px)' }}>
      {isUnscoped && (
        <div style={{ width: '200px', flexShrink: 0, background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', height: 'fit-content' }}>
          <p style={{ margin: 0, padding: '12px 16px', fontSize: '11px', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #e2e8f0' }}>
            Channels
          </p>
          {divisions.map(d => (
            <button
              key={d}
              onClick={() => setActiveDivision(d)}
              style={{
                display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                background: activeDivision === d ? '#f0fdf4' : 'none', border: 'none',
                borderLeft: activeDivision === d ? '3px solid #19562e' : '3px solid transparent',
                fontSize: '13px', fontWeight: activeDivision === d ? 800 : 600,
                color: activeDivision === d ? '#19562e' : '#0f172a', cursor: 'pointer',
              }}
            >
              💬 {d}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: 0 }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #e2e8f0' }}>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>💬 {activeDivision || '...'} Team Chat</h1>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {messages.length === 0 && (
            <p style={{ margin: 'auto', color: '#94a3b8', fontSize: '13px' }}>No messages yet -- say hello 👋</p>
          )}
          {messages.map((m, i) => (
            <div key={m.id} style={{ display: 'flex', gap: '10px' }}>
              <Avatar name={m.sender_name} size={32} />
              <div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                  <span style={{ fontSize: '13px', fontWeight: 800, color: colorForSender(m.sender_id) }}>{m.sender_name}</span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>{formatUKDateTime(m.created_at)}</span>
                </div>
                {m.body && <p style={{ margin: '2px 0 0', fontSize: '13.5px', color: '#374151' }}>{m.body}</p>}
                {m.photo_url && (
                  <img
                    src={m.photo_url}
                    alt=""
                    onClick={() => setLightboxUrl(m.photo_url)}
                    style={{ marginTop: '6px', maxWidth: '220px', maxHeight: '220px', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'block', cursor: 'pointer' }}
                  />
                )}
                {i === messages.length - 1 && (() => {
                  const seenBy = members
                    .filter(mem => mem.id !== m.sender_id && mem.id !== profile.id && channelReads[mem.id] && new Date(channelReads[mem.id]) >= new Date(m.created_at))
                    .map(mem => mem.name)
                  return seenBy.length > 0 && (
                    <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#94a3b8' }}>Seen by {seenBy.join(', ')}</p>
                  )
                })()}
              </div>
            </div>
          ))}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #e2e8f0' }}>
          <ChatComposer
            members={members}
            onSend={handleSend}
            sending={sending}
            inputStyle={{ flex: 1, padding: '9px 14px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13.5px', fontFamily: 'inherit' }}
            sendButtonStyle={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: '#19562e', color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
          />
        </div>
      </div>

      <PhotoLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
    </div>
  )
}
