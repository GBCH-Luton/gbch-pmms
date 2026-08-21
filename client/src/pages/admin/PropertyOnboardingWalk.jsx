import { useState, useEffect } from 'react'
import { COLORS } from '../../lib/colors'
import { statusColour, statusLabel, KpiTiles } from './shared'
import { ROOMS, CHECK_ITEMS, fetchOnboardingProperties, fetchOnboardingMetrics, startOrResumeWalk, fetchWalkChecks, fetchPropertyOpenTickets, recordPass } from '../../lib/onboarding'
import { raiseOnboardingTicket } from './onboardingTicket'
import TicketMediaPicker from '../../components/TicketMediaPicker'
import VoiceInputButton from '../../components/VoiceInputButton'

const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const cardStyle = { background: COLORS.white, borderRadius: '14px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
const primaryBtn = { height: '46px', padding: '0 22px', background: COLORS.blue900, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }
const ghostBtn = { height: '40px', padding: '0 16px', background: COLORS.white, color: COLORS.slate500, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }

function roomComplete(checks, room) {
  return CHECK_ITEMS.every(item => checks.some(c => c.room === room && c.item_key === item.key))
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
  const [screen, setScreen] = useState('picker') // 'picker' | 'room' | 'status'
  const [roomIndex, setRoomIndex] = useState(0)
  const [openTickets, setOpenTickets] = useState([])
  const [error, setError] = useState('')
  const [propertySearch, setPropertySearch] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [tileFilter, setTileFilter] = useState(null) // null | 'toWalk' | 'walking' | 'waiting' | 'liaison'

  // Per-room in-progress form state -- reset every time roomIndex changes.
  const [verdicts, setVerdicts] = useState({}) // { [itemKey]: 'pass'|'fail' }
  const [issuesByItem, setIssuesByItem] = useState({}) // { [itemKey]: [{note, files}] }
  const [submittingRoom, setSubmittingRoom] = useState(false)

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
    const nextIdx = ROOMS.findIndex(r => !roomComplete(rows, r))
    if (nextIdx === -1) {
      setScreen('status')
      setOpenTickets(await fetchPropertyOpenTickets(w.property_id))
    } else {
      setRoomIndex(nextIdx)
      resetRoomForm()
      setScreen('room')
    }
  }

  function resetRoomForm() {
    setVerdicts({})
    setIssuesByItem({})
  }

  function backToPicker() {
    setProperty(null); setWalk(null); setChecks([]); setScreen('picker')
    setShowCustomForm(false); setCustomDesc(''); setCustomAmount(''); setCustomPaid(true); setCustomFiles([])
    loadProperties()
  }

  const room = ROOMS[roomIndex]
  const allVerdicted = CHECK_ITEMS.every(item => verdicts[item.key])
  const hasAnyFail = CHECK_ITEMS.some(item => verdicts[item.key] === 'fail')
  // A note is required on every Fail issue -- once this room is submitted
  // it can't be reopened (no "previous room" nav, no jump-back), so unlike
  // a normal draft form there's no later chance to fill one in. Better to
  // block the submit than leave a real ticket permanently stuck with the
  // placeholder "(no note added)" text.
  const allNotesFilled = CHECK_ITEMS.every(item =>
    verdicts[item.key] !== 'fail' || (issuesByItem[item.key] || []).every(issue => issue.note?.trim())
  )

  function setVerdict(itemKey, v) {
    setVerdicts(prev => ({ ...prev, [itemKey]: v }))
    if (v === 'fail' && !issuesByItem[itemKey]) {
      setIssuesByItem(prev => ({ ...prev, [itemKey]: [{ note: '', files: [] }] }))
    }
  }

  function updateIssue(itemKey, idx, patch) {
    setIssuesByItem(prev => ({
      ...prev,
      [itemKey]: prev[itemKey].map((iss, i) => i === idx ? { ...iss, ...patch } : iss),
    }))
  }

  function addIssue(itemKey) {
    setIssuesByItem(prev => ({ ...prev, [itemKey]: [...(prev[itemKey] || []), { note: '', files: [] }] }))
  }

  function removeIssue(itemKey, idx) {
    setIssuesByItem(prev => ({ ...prev, [itemKey]: prev[itemKey].filter((_, i) => i !== idx) }))
  }

  async function submitRoom() {
    if (!allVerdicted) return
    if (!allNotesFilled) { setError('Add a note to every failed item before continuing.'); return }
    setSubmittingRoom(true)
    setError('')
    try {
      for (const item of CHECK_ITEMS) {
        const verdict = verdicts[item.key]
        if (verdict === 'pass') {
          await recordPass(walk.id, room, item.key, profile)
        } else {
          for (const issue of issuesByItem[item.key] || []) {
            await raiseOnboardingTicket({
              profile, walkId: walk.id, propertyId: property.id, room, itemKey: item.key,
              source: 'walk', issueTag: item.label,
              description: issue.note.trim(),
              files: issue.files, highVulnerability: property.high_vulnerability,
            })
          }
        }
      }
      await refreshChecksAndRoute(walk)
    } catch (err) {
      setError(err.message)
    }
    setSubmittingRoom(false)
  }

  async function submitCustomJob() {
    if (!customDesc.trim()) { setError('Add a description of the agreed work first.'); return }
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
    <div style={{ maxWidth: '760px' }}>
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

      {screen === 'room' && (
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
            {ROOMS.map((r, i) => {
              const done = roomComplete(checks, r)
              const current = i === roomIndex
              return (
                <span key={r} style={{
                  padding: '5px 12px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700,
                  background: current ? COLORS.blue700 : done ? COLORS.green100 : COLORS.slate100,
                  color: current ? COLORS.white : done ? COLORS.green700 : COLORS.slate500,
                }}>
                  {done && !current ? '✓ ' : ''}{r}
                </span>
              )
            })}
          </div>

          <div style={{ ...cardStyle, marginBottom: '14px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{property.address}</p>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>{room}</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {CHECK_ITEMS.map(item => {
              const verdict = verdicts[item.key]
              return (
                <div key={item.key} style={cardStyle}>
                  <p style={{ margin: '0 0 10px 0', fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}>{item.label}</p>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: verdict === 'fail' ? '12px' : 0 }}>
                    <button onClick={() => setVerdict(item.key, 'pass')} style={{ flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: verdict === 'pass' ? `1px solid ${COLORS.green600}` : `1px solid ${COLORS.slate200}`, background: verdict === 'pass' ? COLORS.green600 : COLORS.white, color: verdict === 'pass' ? COLORS.white : COLORS.slate500 }}>Pass</button>
                    <button onClick={() => setVerdict(item.key, 'fail')} style={{ flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: verdict === 'fail' ? `1px solid ${COLORS.red600}` : `1px solid ${COLORS.slate200}`, background: verdict === 'fail' ? COLORS.red600 : COLORS.white, color: verdict === 'fail' ? COLORS.white : COLORS.slate500 }}>Fail</button>
                  </div>

                  {verdict === 'fail' && (issuesByItem[item.key] || []).map((issue, idx) => (
                    <div key={idx} style={{ marginTop: idx > 0 ? '10px' : 0, paddingTop: idx > 0 ? '10px' : 0, borderTop: idx > 0 ? `1px dashed ${COLORS.slate200}` : 'none' }}>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
                        <textarea
                          value={issue.note}
                          onChange={e => updateIssue(item.key, idx, { note: e.target.value })}
                          placeholder="Describe what's wrong... (required)"
                          style={{ flex: 1, minHeight: '60px', padding: '8px 10px', borderRadius: '8px', border: `1px solid ${COLORS.amber300}`, fontSize: '13px', boxSizing: 'border-box', fontFamily: 'inherit' }}
                        />
                        <VoiceInputButton onResult={text => updateIssue(item.key, idx, { note: issue.note ? `${issue.note} ${text}` : text })} />
                      </div>
                      <div style={{ marginTop: '8px' }}>
                        <TicketMediaPicker files={issue.files} onChange={files => updateIssue(item.key, idx, { files })} inputId={`onboard-issue-${item.key}-${idx}`} />
                      </div>
                      {(issuesByItem[item.key] || []).length > 1 && (
                        <button onClick={() => removeIssue(item.key, idx)} style={{ ...ghostBtn, height: '32px', marginTop: '6px', fontSize: '12px' }}>Remove this issue</button>
                      )}
                    </div>
                  ))}
                  {verdict === 'fail' && (
                    <button onClick={() => addIssue(item.key)} style={{ ...ghostBtn, height: '34px', marginTop: '10px', fontSize: '12px' }}>+ Add another issue (separate job)</button>
                  )}
                </div>
              )
            })}
          </div>

          <button
            onClick={submitRoom}
            disabled={!allVerdicted || !allNotesFilled || submittingRoom}
            style={{ ...primaryBtn, width: '100%', marginTop: '16px', opacity: (!allVerdicted || !allNotesFilled || submittingRoom) ? 0.6 : 1, cursor: (!allVerdicted || !allNotesFilled || submittingRoom) ? 'not-allowed' : 'pointer' }}
          >
            {submittingRoom ? 'Submitting…' : !allNotesFilled ? 'Add a note to every fail first' : hasAnyFail ? 'Submit job(s) and move to next room →' : 'Next room →'}
          </button>
        </div>
      )}

      {screen === 'status' && (
        <div>
          <div style={{ ...cardStyle, marginBottom: '14px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{property.address}</p>
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: COLORS.slate900 }}>Property Status</h2>
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
