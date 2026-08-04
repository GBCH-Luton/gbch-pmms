// Minimal shell for the 'submitter' access level (PMMS Role accessLevel
// 'submitter', e.g. "Ticket Submitter" on the Admin > Access page) -- an
// internal stand-in for the future standalone Support system. Until that
// exists, a real staff member is given this role so they can raise tickets
// and see only their own submissions' status/comments, without the full
// Manager-level access that "Log a Ticket" would otherwise require. See
// scripts/add_submitter_role.sql for the matching RLS.
//
// Deliberately just two things: raise a ticket, see your own tickets.
// No assignment, no priority override, no Events, no compliance mode --
// those stay Manager/Admin-only in AdminRaiseTicket.jsx.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { compressImage } from '../lib/imageCompression'
import { getSignedUrl } from '../lib/storage'
import { fetchMaintenanceCategories, sortedCategoryEntries, isUnlistedTag, unlistedTagFor, unlistedLabelFor, calculatePriorityScore } from '../lib/maintenanceCategories'
import { attachBuilderSafeProperties } from '../lib/properties'
import { statusColour, statusLabel } from './admin/shared'
import PropertySearchSelect from '../components/PropertySearchSelect'
import VoiceInputButton from '../components/VoiceInputButton'
import gbchLogo from '../assets/gbch-logo.svg'

const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Garden', 'Other Area...']

const choiceBtn = (active) => ({
  padding: '10px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600, fontFamily: 'inherit',
  border: active ? `2px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
  background: active ? COLORS.teal700 : COLORS.white, color: active ? COLORS.white : COLORS.slate900,
  cursor: 'pointer', textAlign: 'center',
})
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }
const inputStyle = { width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }
const cardStyle = { background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', padding: '20px', marginBottom: '16px' }

export default function SubmitterDashboard({ profile }) {
  const [tab, setTab] = useState('new') // 'new' | 'mine'
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await logLoginEvent(profile, profile.email, 'Signed Out')
    await supabase.auth.signOut()
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: COLORS.brandNavy, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src={gbchLogo} alt="GBCH" style={{ height: '28px' }} />
          <span style={{ color: COLORS.white, fontWeight: 800, fontSize: '14px' }}>PMMS · Ticket Submitter</span>
        </div>
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{ background: 'rgba(255,255,255,0.1)', color: COLORS.white, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '12px', fontWeight: 700, cursor: signingOut ? 'default' : 'pointer' }}
        >
          {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '20px' }}>
        <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>Signed in as {profile.name}</p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button onClick={() => setTab('new')} style={{ ...choiceBtn(tab === 'new'), flex: 1 }}>Report an Issue</button>
          <button onClick={() => setTab('mine')} style={{ ...choiceBtn(tab === 'mine'), flex: 1 }}>My Reports</button>
        </div>

        {tab === 'new' ? <NewReportForm profile={profile} onSubmitted={() => setTab('mine')} /> : <MyReportsList profile={profile} />}
      </div>
    </div>
  )
}

function NewReportForm({ profile, onSubmitted }) {
  const [properties, setProperties] = useState([])
  const [propertyId, setPropertyId] = useState('')
  const [room, setRoom] = useState(null)
  const [otherArea, setOtherArea] = useState('')
  const [maintenanceCategories, setMaintenanceCategories] = useState({})
  const [category, setCategory] = useState(null)
  const [issueTag, setIssueTag] = useState(null)
  const [issueOther, setIssueOther] = useState('')
  const [notes, setNotes] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase.schema('pmms').rpc('builder_properties').order('address').then(({ data, error: fetchError }) => {
      if (!fetchError) setProperties(data || [])
    })
    fetchMaintenanceCategories().then(setMaintenanceCategories)
  }, [])

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function roomString() {
    if (room === 'Other Area...') return otherArea
    return room
  }

  async function handleSubmit() {
    setError('')
    setSubmitting(true)

    const finalIssueTag = isUnlistedTag(issueTag) ? `[Unlisted: ${category}] ${issueOther}` : issueTag
    const description = notes.trim() ? `${finalIssueTag} — ${notes.trim()}` : finalIssueTag
    const priorityScore = calculatePriorityScore(maintenanceCategories, category, issueTag)

    let photoUrl = null
    if (photoFile) {
      const compressed = await compressImage(photoFile)
      const path = `${profile.id}/${Date.now()}-${compressed.name}`
      const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, compressed)
      if (uploadError) {
        setSubmitting(false)
        setError(`Photo upload failed: ${uploadError.message}`)
        return
      }
      photoUrl = await getSignedUrl('ticket-photos', path)
    }

    const { data, error: insertError } = await supabase
      .schema('pmms')
      .from('tickets')
      .insert({
        property_id: propertyId,
        room: roomString(),
        category,
        issue_tag: finalIssueTag,
        description,
        priority_score: priorityScore,
        status: 'Pending',
        raised_by: profile.id,
        raised_by_name: profile.name,
        photo_url: photoUrl,
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
      })
      .select('id, ticket_number')

    setSubmitting(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setSuccess(`Thanks — your report has been logged as Job #${data[0].ticket_number}. Our team will review and assign it.`)
    setPropertyId(''); setRoom(null); setOtherArea(''); setCategory(null); setIssueTag(null); setIssueOther('')
    setNotes(''); setPhotoFile(null); setPhotoPreview(null)
  }

  const step2Complete = !!room && (room !== 'Other Area...' || otherArea.trim())
  const canSubmit = propertyId && step2Complete && category && issueTag && (!isUnlistedTag(issueTag) || issueOther.trim()) && !submitting

  if (success) {
    return (
      <div style={cardStyle}>
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600, color: COLORS.green700 }}>✓ {success}</p>
        <button onClick={() => setSuccess('')} style={{ ...choiceBtn(false), width: '100%' }}>Report Another Issue</button>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <p style={fieldLabelStyle}>1. Property</p>
      <PropertySearchSelect properties={properties} value={propertyId} onChange={(id) => { setPropertyId(id); setRoom(null); setCategory(null); setIssueTag(null) }} />

      {propertyId && (
        <div style={{ marginTop: '20px' }}>
          <p style={fieldLabelStyle}>2. Room / Area</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {ROOM_OPTIONS.map(r => (
              <button key={r} onClick={() => { setRoom(r); setOtherArea('') }} style={choiceBtn(room === r)}>{r}</button>
            ))}
          </div>
          {room === 'Other Area...' && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input type="text" value={otherArea} onChange={(e) => setOtherArea(e.target.value)} placeholder="Describe the area" style={{ ...inputStyle, flex: 1 }} />
              <VoiceInputButton onResult={(text) => setOtherArea(prev => prev ? `${prev} ${text}` : text)} />
            </div>
          )}
        </div>
      )}

      {step2Complete && (
        <div style={{ marginTop: '20px' }}>
          <p style={fieldLabelStyle}>3. Category</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {sortedCategoryEntries(maintenanceCategories).map(([key]) => (
              <button key={key} onClick={() => { setCategory(key); setIssueTag(null); setIssueOther('') }} style={choiceBtn(category === key)}>{key}</button>
            ))}
          </div>
        </div>
      )}

      {category && (
        <div style={{ marginTop: '20px' }}>
          <p style={fieldLabelStyle}>4. What's the issue?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {(maintenanceCategories[category]?.subCategories || []).map(sub => (
              <button key={sub.label} onClick={() => { setIssueTag(sub.label); setIssueOther('') }} style={{ ...choiceBtn(issueTag === sub.label), textAlign: 'left' }}>{sub.label}</button>
            ))}
            <button
              onClick={() => setIssueTag(unlistedTagFor(category))}
              style={{ ...choiceBtn(issueTag === unlistedTagFor(category)), textAlign: 'left', borderStyle: issueTag === unlistedTagFor(category) ? 'solid' : 'dashed' }}
            >
              {unlistedLabelFor(category)}
            </button>
          </div>
          {isUnlistedTag(issueTag) && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
              <input type="text" value={issueOther} onChange={(e) => setIssueOther(e.target.value)} placeholder={`Describe the issue`} style={{ ...inputStyle, flex: 1 }} />
              <VoiceInputButton onResult={(text) => setIssueOther(prev => prev ? `${prev} ${text}` : text)} />
            </div>
          )}
        </div>
      )}

      {issueTag && (
        <div style={{ marginTop: '20px' }}>
          <p style={fieldLabelStyle}>5. Additional details (optional)</p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything else worth knowing?" style={{ ...inputStyle, height: 'auto', padding: '10px 12px', flex: 1, resize: 'vertical' }} />
            <VoiceInputButton onResult={(text) => setNotes(prev => prev ? `${prev} ${text}` : text)} />
          </div>

          <p style={{ ...fieldLabelStyle, marginTop: '16px' }}>Photo (optional)</p>
          {photoPreview && <img src={photoPreview} alt="" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', borderRadius: '10px', marginBottom: '8px' }} />}
          <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} style={{ fontSize: '13px' }} />
        </div>
      )}

      {error && <p style={{ color: COLORS.red600, fontSize: '13px', fontWeight: 600, marginTop: '16px' }}>{error}</p>}

      {issueTag && (
        <button onClick={handleSubmit} disabled={!canSubmit} style={{ ...choiceBtn(true), width: '100%', marginTop: '20px', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? 'Submitting...' : 'Submit Report'}
        </button>
      )}
    </div>
  )
}

function MyReportsList({ profile }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [comments, setComments] = useState([])

  useEffect(() => {
    fetchMine()
  }, [])

  async function fetchMine() {
    setLoading(true)
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, issue_tag, room, photo_url, created_at, property_id')
      .eq('raised_by', profile.id)
      .order('created_at', { ascending: false })

    if (!error) setTickets(await attachBuilderSafeProperties(data || []))
    setLoading(false)
  }

  async function toggleExpand(ticket) {
    if (expandedId === ticket.id) { setExpandedId(null); return }
    setExpandedId(ticket.id)
    const { data } = await supabase
      .schema('pmms')
      .from('comments')
      .select('id, body, author_name, created_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: true })
    setComments(data || [])
  }

  if (loading) {
    return (
      <div style={{ minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading your reports...</p>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No reports submitted yet.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {tickets.map(t => (
        <div key={t.id} style={cardStyle}>
          <div onClick={() => toggleExpand(t)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>#{t.ticket_number} · {t.category}</p>
              <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: COLORS.slate500 }}>{t.property?.address || 'Unknown property'} · {t.room}</p>
              <p style={{ margin: 0, fontSize: '11px', color: COLORS.slate400 }}>{new Date(t.created_at).toLocaleDateString()}</p>
            </div>
            <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 800, color: COLORS.white, background: statusColour(t.status), padding: '4px 10px', borderRadius: '999px' }}>
              {statusLabel(t.status)}
            </span>
          </div>

          {expandedId === t.id && (
            <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: `1px solid ${COLORS.slate100}` }}>
              {comments.length === 0 ? (
                <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate400, fontStyle: 'italic' }}>No updates yet.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {comments.map(c => (
                    <div key={c.id} style={{ fontSize: '12px' }}>
                      <span style={{ fontWeight: 700, color: COLORS.slate900 }}>{c.author_name}: </span>
                      <span style={{ color: COLORS.slate600 }}>{c.body}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
