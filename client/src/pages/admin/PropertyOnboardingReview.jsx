import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { statusColour, statusLabel } from './shared'
import { ROOMS, CHECK_ITEMS, fetchWalkChecks, fetchPropertyOpenTickets } from '../../lib/onboarding'
import { raiseOnboardingTicket } from './onboardingTicket'
import TicketMediaPicker from '../../components/TicketMediaPicker'
import VoiceInputButton from '../../components/VoiceInputButton'

const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const cardStyle = { background: COLORS.white, borderRadius: '14px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const primaryBtn = { height: '46px', padding: '0 22px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { height: '36px', padding: '0 14px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '9px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }

// A small inline note+photo+mic form, reused for both "flag a Pass" and
// "raise something missed" -- same shape as the Assistant Manager's own
// per-issue form on PropertyOnboardingWalk.jsx.
function RaiseForm({ onCancel, onSubmit, submitting }) {
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  return (
    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px dashed ${COLORS.slate200}` }}>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '8px' }}>
        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Describe what you found..." style={{ flex: 1, minHeight: '60px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.amber300}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
        <VoiceInputButton onResult={text => setNote(prev => prev ? `${prev} ${text}` : text)} />
      </div>
      <TicketMediaPicker files={files} onChange={setFiles} inputId={`onboard-review-media-${Math.random().toString(36).slice(2)}`} />
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button onClick={onCancel} style={ghostBtn}>Cancel</button>
        <button
          onClick={() => { if (!note.trim() || files.length === 0) return; onSubmit({ note: note.trim(), files }) }}
          disabled={submitting || !note.trim() || files.length === 0}
          style={{ ...ghostBtn, background: COLORS.amber600, color: COLORS.white, border: 'none', opacity: (submitting || !note.trim() || files.length === 0) ? 0.6 : 1 }}
        >
          {submitting ? 'Raising…' : files.length === 0 ? 'Add a photo first' : 'Raise ticket'}
        </button>
      </div>
    </div>
  )
}

export default function PropertyOnboardingReview({ profile, onNavigate }) {
  const [queue, setQueue] = useState([])
  const [loading, setLoading] = useState(true)
  const [walk, setWalk] = useState(null)
  const [property, setProperty] = useState(null)
  const [checks, setChecks] = useState([])
  const [openTickets, setOpenTickets] = useState([])
  const [error, setError] = useState('')

  const [openForm, setOpenForm] = useState(null) // { room, itemKey|null }
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [deciding, setDeciding] = useState(false)
  const [confirmApprove, setConfirmApprove] = useState(false)
  const [confirmSendBack, setConfirmSendBack] = useState(false)

  useEffect(() => { loadQueue() }, [])

  async function loadQueue() {
    setLoading(true)
    const { data: walks } = await supabase
      .schema('pmms')
      .from('property_onboarding_walks')
      .select('*')
      .eq('status', 'pending_liaison_review')
      .order('submitted_at')

    const propertyIds = [...new Set((walks || []).map(w => w.property_id))]
    const { data: properties } = propertyIds.length
      ? await supabase.schema('pmms').from('properties').select('id, address, high_vulnerability').in('id', propertyIds)
      : { data: [] }

    setQueue((walks || []).map(w => ({ ...w, property: (properties || []).find(p => p.id === w.property_id) || null })))
    setLoading(false)
  }

  async function openWalk(w) {
    setError('')
    setWalk(w)
    setProperty(w.property)
    setChecks(await fetchWalkChecks(w.id))
    setOpenTickets(await fetchPropertyOpenTickets(w.property.id))
  }

  function backToQueue() {
    setWalk(null); setProperty(null); setChecks([]); setOpenTickets([]); setOpenForm(null)
    loadQueue()
  }

  async function refresh() {
    setChecks(await fetchWalkChecks(walk.id))
    setOpenTickets(await fetchPropertyOpenTickets(property.id))
  }

  async function submitFlag(room, itemKey, isMissed, { note, files }) {
    setFormSubmitting(true)
    setError('')
    try {
      await raiseOnboardingTicket({
        profile, walkId: walk.id, propertyId: property.id, room, itemKey,
        source: isMissed ? 'll_missed' : 'll_flag',
        issueTag: isMissed ? 'Missed item found during review' : 'Flagged by Landlord Liaison',
        description: note, files, highVulnerability: property.high_vulnerability,
      })
      setOpenForm(null)
      await refresh()
    } catch (err) {
      setError(err.message)
    }
    setFormSubmitting(false)
  }

  async function approve() {
    setDeciding(true)
    setError('')
    const { error: propErr } = await supabase.schema('pmms').from('properties').update({ status: 'Live' }).eq('id', property.id)
    if (propErr) { setDeciding(false); setError(propErr.message); return }
    await supabase.schema('pmms').from('property_status_history').insert({
      property_id: property.id, from_status: 'Procured', to_status: 'Live',
      changed_by: profile.id, changed_by_name: profile.name,
    })
    const { error: walkErr } = await supabase.schema('pmms').from('property_onboarding_walks').update({
      status: 'approved', reviewed_by: profile.id, reviewed_by_name: profile.name, reviewed_at: new Date().toISOString(),
    }).eq('id', walk.id)
    setDeciding(false)
    setConfirmApprove(false)
    if (walkErr) { setError(walkErr.message); return }
    backToQueue()
  }

  async function sendBack() {
    setDeciding(true)
    setError('')
    const { error: err } = await supabase.schema('pmms').from('property_onboarding_walks').update({
      status: 'sent_back', reviewed_by: profile.id, reviewed_by_name: profile.name, reviewed_at: new Date().toISOString(),
    }).eq('id', walk.id)
    setDeciding(false)
    setConfirmSendBack(false)
    if (err) { setError(err.message); return }
    backToQueue()
  }

  if (loading) return <p style={{ color: COLORS.slate500, fontSize: '13px' }}>Loading…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Property Onboarding Review</h1>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Walks submitted by an Assistant Manager, waiting on your review.</p>
        </div>
        {walk && <button onClick={backToQueue} style={ghostBtn}>← Queue</button>}
      </div>

      {error && <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{error}</p>}

      {!walk && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {queue.length === 0 && (
            <div style={cardStyle}><p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Nothing waiting on your review right now.</p></div>
          )}
          {queue.map(w => (
            <div key={w.id} style={{ ...cardStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => openWalk(w)}>
              <div>
                <p style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{w.property?.address}</p>
                <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>Walked by {w.started_by_name}</p>
              </div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.blue700 }}>Review →</span>
            </div>
          ))}
        </div>
      )}

      {walk && (
        <div>
          <div style={{ ...cardStyle, marginBottom: '14px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{property.address}</p>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>Walked by {walk.started_by_name}</h2>
          </div>

          {ROOMS.map(room => (
            <div key={room} style={{ ...cardStyle, marginBottom: '10px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{room}</p>
              {CHECK_ITEMS.map(item => {
                const rows = checks.filter(c => c.room === room && c.item_key === item.key)
                return (
                  <div key={item.key} style={{ padding: '8px 0', borderTop: `1px solid ${COLORS.slate100}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 600, color: COLORS.slate900 }}>{item.label}</span>
                      {rows.every(r => r.verdict === 'pass') && (
                        <button onClick={() => setOpenForm({ room, itemKey: item.key, missed: false })} style={{ ...ghostBtn, height: '28px', fontSize: '11.5px' }}>🚩 Flag this</button>
                      )}
                    </div>
                    {rows.map(r => (
                      <div key={r.id} style={{ marginTop: '6px', fontSize: '11.5px', color: COLORS.slate500 }}>
                        {r.verdict === 'pass'
                          ? <span style={{ color: COLORS.green600, fontWeight: 700 }}>✓ Pass</span>
                          : <span>
                              <span style={{ color: COLORS.red600, fontWeight: 700 }}>✕ Fail</span>
                              {r.ticket && <> — Job #{r.ticket.ticket_number} <span style={{ fontWeight: 700, color: statusColour(r.ticket.status) }}>{statusLabel(r.ticket.status)}</span></>}
                            </span>}
                      </div>
                    ))}
                    {openForm?.room === room && openForm?.itemKey === item.key && (
                      <RaiseForm onCancel={() => setOpenForm(null)} submitting={formSubmitting} onSubmit={payload => submitFlag(room, item.key, false, payload)} />
                    )}
                  </div>
                )
              })}
              {openForm?.room === room && openForm?.itemKey === null ? (
                <RaiseForm onCancel={() => setOpenForm(null)} submitting={formSubmitting} onSubmit={payload => submitFlag(room, null, true, payload)} />
              ) : (
                <button onClick={() => setOpenForm({ room, itemKey: null, missed: true })} style={{ ...ghostBtn, marginTop: '10px' }}>+ Raise a ticket for something missed</button>
              )}
            </div>
          ))}

          <div style={{ ...cardStyle, marginTop: '14px', marginBottom: '14px' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Custom / other jobs on this walk</p>
            {checks.filter(c => c.source !== 'walk' && c.item_key === null).length === 0 && (
              <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>None.</p>
            )}
            {checks.filter(c => c.source !== 'walk' && c.item_key === null).map(c => (
              <div key={c.id} style={{ padding: '6px 0', fontSize: '12.5px', color: COLORS.slate900 }}>
                {c.ticket ? <>Job #{c.ticket.ticket_number} — {c.ticket.issue_tag} <span style={{ fontWeight: 700, color: statusColour(c.ticket.status) }}>{statusLabel(c.ticket.status)}</span></> : c.source}
              </div>
            ))}
          </div>

          {openTickets.length > 0 ? (
            <div style={{ ...cardStyle, background: COLORS.red50, border: `1px solid ${COLORS.red200}`, marginBottom: '14px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: COLORS.red600 }}>⛔ {openTickets.length} open job{openTickets.length > 1 ? 's' : ''} still open on this property.</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: COLORS.red600 }}>Every job must be fully signed off before this property can go live. You can send it back now, or wait and check again.</p>
            </div>
          ) : (
            <div style={{ ...cardStyle, background: COLORS.green50, border: `1px solid ${COLORS.green200}`, marginBottom: '14px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: COLORS.green700 }}>✓ Clear — 0 open jobs. Ready to approve.</p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => setConfirmSendBack(true)} style={{ ...ghostBtn, flex: 1, height: '46px' }}>↩ Send back to {walk.started_by_name}</button>
            <button onClick={() => setConfirmApprove(true)} disabled={openTickets.length > 0} style={{ ...primaryBtn, flex: 1, opacity: openTickets.length > 0 ? 0.5 : 1, cursor: openTickets.length > 0 ? 'not-allowed' : 'pointer' }}>Approve & go live</button>
          </div>

          {confirmApprove && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '22px', width: '100%', maxWidth: '380px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>Approve & go live?</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>{property.address} will move from Procured to Live. This can't be undone from here.</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setConfirmApprove(false)} style={{ ...ghostBtn, flex: 1, height: '42px' }}>Cancel</button>
                  <button onClick={approve} disabled={deciding} style={{ ...primaryBtn, flex: 1, height: '42px' }}>{deciding ? 'Approving…' : 'Approve'}</button>
                </div>
              </div>
            </div>
          )}

          {confirmSendBack && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '22px', width: '100%', maxWidth: '380px' }}>
                <p style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>Send back to {walk.started_by_name}?</p>
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>They'll see it needs attention next time they open this property.</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setConfirmSendBack(false)} style={{ ...ghostBtn, flex: 1, height: '42px' }}>Cancel</button>
                  <button onClick={sendBack} disabled={deciding} style={{ ...primaryBtn, flex: 1, height: '42px', background: COLORS.amber600 }}>{deciding ? 'Sending…' : 'Send back'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
