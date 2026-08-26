import { useState, useEffect } from 'react'
import { COLORS } from '../../lib/colors'
import { statusColour, statusLabel, KpiTiles } from './shared'
import {
  CHECK_ITEMS, ROOM_TYPES, effectiveRoomsFor, nextRoomName, groupRoomsByType, addExtraRoom, removeExtraRoom,
  fetchRoomNotes, saveRoomDescription, fetchOnboardingProperties, fetchOnboardingMetrics,
  startOrResumeWalk, fetchWalkChecks, fetchPropertyOpenTickets, recordPass,
} from '../../lib/onboarding'
import { raiseOnboardingTicket } from './onboardingTicket'
import TicketMediaPicker from '../../components/TicketMediaPicker'
import VoiceInputButton from '../../components/VoiceInputButton'

const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const cardStyle = { background: COLORS.white, borderRadius: '14px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const primaryBtn = { height: '46px', padding: '0 22px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { height: '40px', padding: '0 16px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }
const addBtn = { width: '100%', background: COLORS.teal50, color: COLORS.teal700, border: `1.5px dashed ${COLORS.teal700}`, borderRadius: '10px', padding: '12px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', marginBottom: '16px' }

function roomComplete(checks, room) {
  return CHECK_ITEMS.every(item => checks.some(c => c.room === room && c.item_key === item.key))
}
function emptyRoomForm(desc = '') {
  return { desc, verdicts: {}, issuesByItem: {} }
}

function walkStatusPill(walk) {
  if (!walk) return { label: 'Not yet walked', bg: COLORS.slate100, color: COLORS.slate500 }
  if (walk.status === 'in_progress') return { label: 'Walk in progress', bg: COLORS.amber100, color: COLORS.amber700 }
  if (walk.status === 'sent_back') return { label: 'Sent back — needs changes', bg: COLORS.red100, color: COLORS.red600 }
  if (walk.status === 'pending_liaison_review') return { label: 'Awaiting Landlord Liaison', bg: COLORS.blue100, color: COLORS.blue700 }
  return { label: walk.status, bg: COLORS.slate100, color: COLORS.slate500 }
}

export default function PropertyOnboardingWalk({ profile, onNavigate }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [property, setProperty] = useState(null)
  const [walk, setWalk] = useState(null)
  const [checks, setChecks] = useState([])
  const [roomNotes, setRoomNotes] = useState({}) // { [room]: description }, persisted
  const [screen, setScreen] = useState('picker') // 'picker' | 'room' | 'status'
  const [stepIndex, setStepIndex] = useState(0)
  const [openTickets, setOpenTickets] = useState([])
  const [error, setError] = useState('')
  const [propertySearch, setPropertySearch] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [tileFilter, setTileFilter] = useState(null) // null | 'toWalk' | 'walking' | 'waiting' | 'liaison'

  // One entry per room that hasn't been submitted yet (any room), not just
  // the currently-viewed step -- so switching steps (or the stepper's free
  // "jump to any step" nav) never loses an in-progress draft. A room's
  // entry is removed once refreshChecksAndRoute sees it's actually
  // complete in the DB.
  const [roomForms, setRoomForms] = useState({}) // { [room]: { desc, verdicts, issuesByItem } }
  const [submittingStep, setSubmittingStep] = useState(false)

  const [showCustomForm, setShowCustomForm] = useState(false)
  const [customDesc, setCustomDesc] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [customPaid, setCustomPaid] = useState(true)
  const [customFiles, setCustomFiles] = useState([])
  const [customSubmitting, setCustomSubmitting] = useState(false)

  useEffect(() => { loadProperties() }, [])

  async function loadProperties() {
    setLoading(true)
    const [propertyList, metricsResult] = await Promise.all([fetchOnboardingProperties(), fetchOnboardingMetrics()])
    setProperties(propertyList)
    setMetrics(metricsResult)
    setLoading(false)
  }

  async function openProperty(p) {
    setError('')
    try {
      const w = await startOrResumeWalk(p.id, profile)
      setProperty(p)
      setWalk(w)
      await refreshChecksAndRoute(w)
    } catch (err) {
      setError(err.message)
    }
  }

  async function refreshChecksAndRoute(w) {
    const rows = await fetchWalkChecks(w.id)
    setChecks(rows)
    const notes = await fetchRoomNotes(w.id)
    setRoomNotes(notes)

    const allRooms = effectiveRoomsFor(w)
    setRoomForms(prev => {
      const next = {}
      allRooms.forEach(r => {
        if (roomComplete(rows, r)) return
        next[r] = prev[r] || emptyRoomForm(notes[r] || '')
      })
      return next
    })

    const stepList = groupRoomsByType(allRooms)
    const nextIdx = stepList.findIndex(s => s.rooms.some(r => !roomComplete(rows, r)))
    if (nextIdx === -1) {
      setScreen('status')
      setOpenTickets(await fetchPropertyOpenTickets(w.property_id))
    } else {
      setStepIndex(nextIdx)
      setScreen('room')
    }
  }

  // For a property with more bedrooms/kitchens/bathrooms (or living rooms/
  // hallways) than the fixed default -- appends one to this walk's
  // extra_rooms and seeds a blank draft for it immediately. Doesn't touch
  // roomForms for any other room, so nothing in-progress is lost.
  async function addRoomOfType(baseType) {
    setError('')
    try {
      const roomName = nextRoomName(effectiveRoomsFor(walk), baseType)
      const updatedWalk = await addExtraRoom(walk, roomName)
      setWalk(updatedWalk)
      setRoomForms(prev => ({ ...prev, [roomName]: emptyRoomForm('') }))
      if (screen === 'status') await refreshChecksAndRoute(updatedWalk)
    } catch (err) {
      setError(err.message)
    }
  }

  // Undoes an accidental add -- only ever offered on a room that's still
  // an open, not-yet-submitted extra_rooms entry (see the isRemovable
  // check at the call site), so there's never any persisted check/ticket
  // data to orphan.
  async function removeRoom(room) {
    setError('')
    try {
      const updatedWalk = await removeExtraRoom(walk, room)
      setWalk(updatedWalk)
      setRoomForms(prev => { const next = { ...prev }; delete next[room]; return next })
    } catch (err) {
      setError(err.message)
    }
  }

  function backToPicker() {
    setProperty(null); setWalk(null); setChecks([]); setRoomNotes({}); setScreen('picker')
    setRoomForms({}); setStepIndex(0)
    setShowCustomForm(false); setCustomDesc(''); setCustomAmount(''); setCustomPaid(true); setCustomFiles([])
    loadProperties()
  }

  const steps = walk ? groupRoomsByType(effectiveRoomsFor(walk)) : []
  const step = steps[stepIndex]

  function setVerdict(room, itemKey, v) {
    setRoomForms(prev => {
      const f = prev[room]
      const issuesByItem = { ...f.issuesByItem }
      if (v === 'fail' && !issuesByItem[itemKey]) issuesByItem[itemKey] = [{ note: '', files: [] }]
      return { ...prev, [room]: { ...f, verdicts: { ...f.verdicts, [itemKey]: v }, issuesByItem } }
    })
  }
  function updateIssue(room, itemKey, idx, patch) {
    setRoomForms(prev => {
      const f = prev[room]
      return { ...prev, [room]: { ...f, issuesByItem: { ...f.issuesByItem, [itemKey]: f.issuesByItem[itemKey].map((iss, i) => i === idx ? { ...iss, ...patch } : iss) } } }
    })
  }
  function addIssue(room, itemKey) {
    setRoomForms(prev => {
      const f = prev[room]
      return { ...prev, [room]: { ...f, issuesByItem: { ...f.issuesByItem, [itemKey]: [...(f.issuesByItem[itemKey] || []), { note: '', files: [] }] } } }
    })
  }
  function removeIssue(room, itemKey, idx) {
    setRoomForms(prev => {
      const f = prev[room]
      return { ...prev, [room]: { ...f, issuesByItem: { ...f.issuesByItem, [itemKey]: f.issuesByItem[itemKey].filter((_, i) => i !== idx) } } }
    })
  }
  function setRoomDesc(room, val) {
    setRoomForms(prev => ({ ...prev, [room]: { ...prev[room], desc: val } }))
  }
  function blurRoomDesc(room) {
    saveRoomDescription(walk.id, room, roomForms[room]?.desc?.trim() || '').catch(err => setError(err.message))
  }

  function roomValid(room) {
    const f = roomForms[room]
    if (!f) return true
    return CHECK_ITEMS.every(item => {
      const v = f.verdicts[item.key]
      if (!v) return false
      if (v !== 'fail') return true
      const issues = f.issuesByItem[item.key] || []
      return issues.length > 0 && issues.every(iss => iss.note?.trim() && iss.files?.length > 0)
    })
  }

  function stepDraftJobCount(rooms) {
    let n = 0
    rooms.forEach(r => {
      const f = roomForms[r]
      if (!f) return
      CHECK_ITEMS.forEach(item => { if (f.verdicts[item.key] === 'fail') n += (f.issuesByItem[item.key] || []).length })
    })
    return n
  }

  async function submitStep() {
    if (!step) return
    const openRooms = step.rooms.filter(r => roomForms[r])
    if (!openRooms.length || !openRooms.every(roomValid)) return
    setSubmittingStep(true)
    setError('')
    try {
      for (const r of openRooms) {
        const form = roomForms[r]
        for (const item of CHECK_ITEMS) {
          const verdict = form.verdicts[item.key]
          if (verdict === 'pass') {
            await recordPass(walk.id, r, item.key, profile)
          } else {
            for (const issue of form.issuesByItem[item.key] || []) {
              await raiseOnboardingTicket({
                profile, walkId: walk.id, propertyId: property.id, room: r, itemKey: item.key,
                source: 'walk', issueTag: item.label,
                description: issue.note.trim(),
                files: issue.files, highVulnerability: property.high_vulnerability,
              })
            }
          }
        }
        await saveRoomDescription(walk.id, r, form.desc.trim())
      }
      await refreshChecksAndRoute(walk)
    } catch (err) {
      setError(err.message)
    }
    setSubmittingStep(false)
  }

  async function submitCustomJob() {
    if (!customDesc.trim()) { setError('Add a description of the agreed work first.'); return }
    if (customFiles.length === 0) { setError('Add a photo of the agreed work first.'); return }
    setCustomSubmitting(true)
    setError('')
    try {
      const desc = `${customDesc.trim()}\n\nAmount charged to landlord: £${customAmount || '0'}${customPaid ? ' (deducted from rent — no further payment due)' : ''}`
      await raiseOnboardingTicket({
        profile, walkId: walk.id, propertyId: property.id, room: null, itemKey: null,
        source: 'custom', issueTag: 'Landlord-agreed extra work', description: desc,
        files: customFiles, highVulnerability: property.high_vulnerability,
      })
      setCustomDesc(''); setCustomAmount(''); setCustomPaid(true); setCustomFiles([]); setShowCustomForm(false)
      setChecks(await fetchWalkChecks(walk.id))
      setOpenTickets(await fetchPropertyOpenTickets(property.id))
    } catch (err) {
      setError(err.message)
    }
    setCustomSubmitting(false)
  }

  if (loading) return <p style={{ color: COLORS.slate500, fontSize: '13px' }}>Loading properties…</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '18px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Onboard a Property</h1>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Walk a new property room by room. Anything that fails becomes a real job.</p>
        </div>
        {screen !== 'picker' && (
          <button onClick={backToPicker} style={ghostBtn}>← Property list</button>
        )}
      </div>

      {error && <p style={{ margin: '0 0 14px 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{error}</p>}

      {screen === 'picker' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {metrics && (
            <KpiTiles
              kpis={[
                { label: 'To Walk', value: metrics.toWalkIds.size, colour: COLORS.slate500, key: 'toWalk' },
                { label: 'Walking', value: metrics.walkingIds.size, colour: COLORS.amber600, key: 'walking' },
                { label: 'Waiting On Tickets', value: metrics.waitingIds.size, colour: COLORS.red600, key: 'waiting' },
                { label: 'With Landlord Liaison', value: metrics.liaisonIds.size, colour: COLORS.blue600, key: 'liaison' },
                { label: 'Live (via this walk)', value: metrics.liveCount, colour: COLORS.green600, key: 'live' },
              ]}
              onTileClick={kpi => kpi.key !== 'live' && setTileFilter(prev => prev === kpi.key ? null : kpi.key)}
            />
          )}

          {tileFilter && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '-4px' }}>
              <span style={{ fontSize: '12px', color: COLORS.slate500 }}>Filtered — click the tile again to clear.</span>
              <button onClick={() => setTileFilter(null)} style={{ ...ghostBtn, height: '26px', padding: '0 10px', fontSize: '11.5px' }}>Clear</button>
            </div>
          )}

          <input
            type="text"
            value={propertySearch}
            onChange={e => setPropertySearch(e.target.value)}
            placeholder="Search by address..."
            style={{ width: '100%', height: '44px', padding: '0 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', marginBottom: '4px' }}
          />
          {(() => {
            const filtered = properties
              .filter(p => p.address.toLowerCase().includes(propertySearch.trim().toLowerCase()))
              .filter(p => {
                if (!tileFilter || !metrics) return true
                if (tileFilter === 'toWalk') return metrics.toWalkIds.has(p.id)
                if (tileFilter === 'walking') return metrics.walkingIds.has(p.id)
                if (tileFilter === 'waiting') return metrics.waitingIds.has(p.id)
                if (tileFilter === 'liaison') return metrics.liaisonIds.has(p.id)
                return true
              })
            if (properties.length === 0) {
              return <div style={cardStyle}><p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>No Procured properties waiting to be onboarded right now.</p></div>
            }
            if (filtered.length === 0) {
              return <div style={cardStyle}><p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>No properties match.</p></div>
            }
            return filtered.map(p => {
              const pill = walkStatusPill(p.walk)
              return (
                <div key={p.id} style={{ ...cardStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', cursor: 'pointer' }} onClick={() => openProperty(p)}>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{p.address}</p>
                    <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 700, background: pill.bg, color: pill.color }}>{pill.label}</span>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.blue700 }}>{p.walk ? 'Continue →' : 'Start walk →'}</span>
                </div>
              )
            })
          })()}
        </div>
      )}

      {screen === 'room' && step && (() => {
        const openRooms = step.rooms.filter(r => roomForms[r])
        const doneRooms = step.rooms.filter(r => !roomForms[r])
        const draftJobs = stepDraftJobCount(step.rooms)
        const stepValid = openRooms.length > 0 && openRooms.every(roomValid)

        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', marginBottom: '18px', gap: '2px', flexWrap: 'wrap' }}>
              {steps.map((s, i) => {
                const isCurrent = i === stepIndex
                const isDone = s.rooms.every(r => roomComplete(checks, r))
                return (
                  <div key={s.type} style={{ display: 'flex', alignItems: 'flex-start' }}>
                    <button
                      onClick={() => { setStepIndex(i); setError('') }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <span style={{ fontSize: '10.5px', fontWeight: 700, whiteSpace: 'nowrap', color: isCurrent ? COLORS.blue700 : isDone ? COLORS.slate500 : COLORS.slate400 }}>{s.type}</span>
                      <span style={{
                        width: '30px', height: '30px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 800, fontSize: '13px', flexShrink: 0,
                        background: isCurrent ? COLORS.blue700 : isDone ? COLORS.green100 : COLORS.white,
                        border: `2px solid ${isCurrent || isDone ? COLORS.blue700 : COLORS.slate200}`,
                        color: isCurrent ? COLORS.white : isDone ? COLORS.green700 : COLORS.slate400,
                      }}>
                        {isDone ? '✓' : i + 1}
                      </span>
                    </button>
                    {i < steps.length - 1 && <div style={{ width: '18px', height: '2px', background: isDone ? COLORS.blue700 : COLORS.slate200, marginTop: '14px' }} />}
                  </div>
                )
              })}
            </div>

            <div style={{ ...cardStyle, marginBottom: '14px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{property.address}</p>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' }}>
                <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>{step.type}</h2>
                <span style={{ fontSize: '11.5px', fontWeight: 700, color: COLORS.slate500, whiteSpace: 'nowrap' }}>
                  {step.rooms.length} room{step.rooms.length === 1 ? '' : 's'}{draftJobs ? ` · ${draftJobs} job${draftJobs === 1 ? '' : 's'}` : ''}
                </span>
              </div>
            </div>

            {doneRooms.map(r => {
              const roomChecks = checks.filter(c => c.room === r)
              const fails = roomChecks.filter(c => c.verdict === 'fail')
              return (
                <div key={r} style={{ ...cardStyle, marginBottom: '10px', opacity: 0.85 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}>{r}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.green700, background: COLORS.green100, padding: '3px 10px', borderRadius: '999px' }}>✓ Done</span>
                  </div>
                  {roomNotes[r] && <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.slate500 }}>{roomNotes[r]}</p>}
                  {fails.length > 0 && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {fails.map(c => (
                        <p key={c.id} style={{ margin: 0, fontSize: '11.5px', color: COLORS.slate500 }}>
                          {c.ticket ? `Job #${c.ticket.ticket_number}` : 'Job'} — {CHECK_ITEMS.find(i => i.key === c.item_key)?.label}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}

            {openRooms.map(r => {
              const form = roomForms[r]
              const isRemovable = walk.extra_rooms?.includes(r)
              return (
                <div key={r} style={{ ...cardStyle, marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{r}</p>
                    {isRemovable && (
                      <button onClick={() => removeRoom(r)} style={{ background: 'none', border: 'none', color: COLORS.slate400, fontSize: '12px', fontWeight: 600, cursor: 'pointer', padding: 0 }}>✕ Remove</button>
                    )}
                  </div>

                  <div style={{ marginBottom: '14px' }}>
                    <p style={fieldLabelStyle}>Description</p>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                      <textarea
                        value={form.desc}
                        onChange={e => setRoomDesc(r, e.target.value)}
                        onBlur={() => blurRoomDesc(r)}
                        placeholder="e.g. double aspect, fitted wardrobe..."
                        style={{ flex: 1, minHeight: '44px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                      />
                      <VoiceInputButton onResult={text => setRoomDesc(r, form.desc ? `${form.desc} ${text}` : text)} />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {CHECK_ITEMS.map(item => {
                      const verdict = form.verdicts[item.key]
                      const inputBase = `onboard-issue-${r.replace(/\s+/g, '-')}-${item.key}`
                      return (
                        <div key={item.key} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px', background: COLORS.slate50 }}>
                          <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{item.label}</p>
                          <div style={{ display: 'flex', gap: '8px', marginBottom: verdict === 'fail' ? '12px' : 0 }}>
                            <button onClick={() => setVerdict(r, item.key, 'pass')} style={{ flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: verdict === 'pass' ? `1px solid ${COLORS.green600}` : `1px solid ${COLORS.slate200}`, background: verdict === 'pass' ? COLORS.green600 : COLORS.white, color: verdict === 'pass' ? COLORS.white : COLORS.slate500 }}>Pass</button>
                            <button onClick={() => setVerdict(r, item.key, 'fail')} style={{ flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: verdict === 'fail' ? `1px solid ${COLORS.red600}` : `1px solid ${COLORS.slate200}`, background: verdict === 'fail' ? COLORS.red600 : COLORS.white, color: verdict === 'fail' ? COLORS.white : COLORS.slate500 }}>Fail</button>
                          </div>

                          {verdict === 'fail' && (form.issuesByItem[item.key] || []).map((issue, idx) => (
                            <div key={idx} style={{ marginTop: idx > 0 ? '10px' : 0, paddingTop: idx > 0 ? '10px' : 0, borderTop: idx > 0 ? `1px dashed ${COLORS.slate200}` : 'none' }}>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                                <textarea
                                  value={issue.note}
                                  onChange={e => updateIssue(r, item.key, idx, { note: e.target.value })}
                                  placeholder="Describe what's wrong... (required)"
                                  style={{ flex: 1, minHeight: '60px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.amber300}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                                />
                                <VoiceInputButton onResult={text => updateIssue(r, item.key, idx, { note: issue.note ? `${issue.note} ${text}` : text })} />
                              </div>
                              <div style={{ marginTop: '8px' }}>
                                <TicketMediaPicker files={issue.files} onChange={files => updateIssue(r, item.key, idx, { files })} inputId={`${inputBase}-${idx}`} />
                              </div>
                              {(form.issuesByItem[item.key] || []).length > 1 && (
                                <button onClick={() => removeIssue(r, item.key, idx)} style={{ ...ghostBtn, height: '32px', marginTop: '6px', fontSize: '12px' }}>Remove this issue</button>
                              )}
                            </div>
                          ))}
                          {verdict === 'fail' && (
                            <button onClick={() => addIssue(r, item.key)} style={{ ...ghostBtn, height: '34px', marginTop: '10px', fontSize: '12px' }}>+ Add another issue (separate job)</button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            <button onClick={() => addRoomOfType(step.type)} style={addBtn}>+ Add another {step.type.toLowerCase()}</button>

            {openRooms.length > 0 ? (
              <button
                onClick={submitStep}
                disabled={!stepValid || submittingStep}
                style={{ ...primaryBtn, width: '100%', opacity: (!stepValid || submittingStep) ? 0.6 : 1, cursor: (!stepValid || submittingStep) ? 'not-allowed' : 'pointer' }}
              >
                {submittingStep ? 'Submitting…' : !stepValid ? 'Finish every room above first' : draftJobs ? `Submit job${draftJobs === 1 ? '' : 's'} and continue →` : 'Continue →'}
              </button>
            ) : (
              <button
                onClick={() => stepIndex < steps.length - 1 ? setStepIndex(stepIndex + 1) : refreshChecksAndRoute(walk)}
                style={{ ...primaryBtn, width: '100%' }}
              >
                {stepIndex < steps.length - 1 ? 'Next step →' : 'Finish walk →'}
              </button>
            )}
          </div>
        )
      })()}

      {screen === 'status' && (
        <div>
          <div style={{ ...cardStyle, marginBottom: '14px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{property.address}</p>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>Property Status</h2>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginBottom: '14px' }}>
            <span style={{ fontSize: '11.5px', color: COLORS.slate400 }}>Missed a room? This property has more of these?</span>
            {ROOM_TYPES.map(type => (
              <button key={type} onClick={() => addRoomOfType(type)} style={{ ...ghostBtn, height: '28px', padding: '0 10px', fontSize: '11.5px' }}>+ {type}</button>
            ))}
          </div>

          {openTickets.length > 0 ? (
            <div style={{ ...cardStyle, background: COLORS.red50, border: `1px solid ${COLORS.red200}`, marginBottom: '14px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: COLORS.red600 }}>⛔ Blocked — {openTickets.length} open job{openTickets.length > 1 ? 's' : ''} on this property.</p>
              <p style={{ margin: '4px 0 0 0', fontSize: '12.5px', color: COLORS.red600 }}>Every open job blocks go-live, including ones raised before this walk. Each must be fully signed off.</p>
            </div>
          ) : (
            <div style={{ ...cardStyle, background: COLORS.green50, border: `1px solid ${COLORS.green200}`, marginBottom: '14px' }}>
              <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: COLORS.green700 }}>✓ Clear — 0 open jobs. This moves to Landlord Liaison automatically — nothing more for you to do here.</p>
            </div>
          )}

          {openTickets.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: '14px' }}>
              {openTickets.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}` }}>
                  <div>
                    <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>Job #{t.ticket_number} — {t.issue_tag}</p>
                    <p style={{ margin: 0, fontSize: '11.5px', color: COLORS.slate500 }}>{t.room || t.category}</p>
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status) }}>{statusLabel(t.status)}</span>
                </div>
              ))}
            </div>
          )}

          {walk.status === 'in_progress' || walk.status === 'sent_back' ? (
            <>
              {!showCustomForm ? (
                <button onClick={() => setShowCustomForm(true)} style={{ ...ghostBtn, width: '100%', marginBottom: '14px' }}>+ Add landlord-agreed extra work</button>
              ) : (
                <div style={{ ...cardStyle, marginBottom: '14px' }}>
                  <p style={fieldLabelStyle}>Works to be completed</p>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '10px' }}>
                    <textarea value={customDesc} onChange={e => setCustomDesc(e.target.value)} placeholder="Describe the agreed work..." style={{ flex: 1, minHeight: '90px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }} />
                    <VoiceInputButton onResult={text => setCustomDesc(prev => prev ? `${prev} ${text}` : text)} />
                  </div>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <p style={fieldLabelStyle}>Amount charged to landlord (£)</p>
                      <input type="number" min="0" value={customAmount} onChange={e => setCustomAmount(e.target.value)} placeholder="e.g. 200" style={{ width: '100%', height: '40px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 600, color: COLORS.slate900, paddingBottom: '10px', cursor: 'pointer' }}>
                      <input type="checkbox" checked={customPaid} onChange={e => setCustomPaid(e.target.checked)} /> Deducted from rent
                    </label>
                  </div>
                  <p style={fieldLabelStyle}>Photo or video (proof of the work agreed)</p>
                  <TicketMediaPicker files={customFiles} onChange={setCustomFiles} inputId="onboard-custom-media" />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <button onClick={() => setShowCustomForm(false)} style={ghostBtn}>Cancel</button>
                    <button onClick={submitCustomJob} disabled={customSubmitting} style={{ ...primaryBtn, flex: 1, height: '40px' }}>{customSubmitting ? 'Adding…' : '+ Add this as a job'}</button>
                  </div>
                </div>
              )}

              {openTickets.length > 0 && (
                <p style={{ fontSize: '12.5px', color: COLORS.slate500, fontStyle: 'italic' }}>
                  Nothing to do here — once every job above is signed off, this moves to Landlord Liaison on its own.
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: '13px', color: COLORS.slate500, fontStyle: 'italic' }}>Waiting on Landlord Liaison to review this walk.</p>
          )}
        </div>
      )}
    </div>
  )
}
