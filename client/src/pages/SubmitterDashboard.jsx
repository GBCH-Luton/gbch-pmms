// Minimal shell for the 'submitter' access level (PMMS Role accessLevel
// 'submitter', e.g. "Ticket Submitter" on the Admin > Access page) -- an
// internal stand-in for the future standalone Support system. Until that
// exists, a real staff member is given this role so they can raise tickets,
// track their own submissions through the pipeline, and sign off their own
// completed work, without the full Manager-level access that "Log a
// Ticket"/Pipeline/Sign-Off would otherwise require. See
// scripts/add_submitter_role.sql and scripts/add_raiser_only_signoff.sql
// for the matching RLS -- this page's 3 tabs are deliberately built as a
// simplified preview of what a real future Support-system dashboard for
// this kind of staff member would look like, not a throwaway test harness.
//
// Three things: raise a ticket (NewReportForm), track them through
// Pending/Active/Completed/Archived (PipelineList), sign off your own
// completed work (SignOffList). No assignment, no priority override, no
// Events, no compliance mode -- those stay Manager/Admin-only in
// AdminRaiseTicket.jsx.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { uploadTicketAttachments, formatUploadProgress } from '../lib/ticketAttachments'
import { fetchMaintenanceCategories, sortedCategoryEntries, isUnlistedTag, unlistedTagFor, unlistedLabelFor, calculatePriorityScore } from '../lib/maintenanceCategories'
import { attachBuilderSafeProperties } from '../lib/properties'
import { statusColour, statusLabel, postSystemComment, postAuditEvent, KpiTiles } from './admin/shared'
import PropertySearchSelect from '../components/PropertySearchSelect'
import VoiceInputButton from '../components/VoiceInputButton'
import AttachmentMedia from '../components/AttachmentMedia'
import TicketMediaPicker from '../components/TicketMediaPicker'
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
  const [tab, setTab] = useState('pipeline') // 'new' | 'pipeline' | 'signoff'
  const [signingOut, setSigningOut] = useState(false)
  const [signOffCount, setSignOffCount] = useState(0)

  useEffect(() => {
    fetchSignOffCount()
  }, [])

  async function fetchSignOffCount() {
    const { count } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('raised_by', profile.id)
      .eq('status', 'Completed')
    setSignOffCount(count || 0)
  }

  async function handleSignOut() {
    setSigningOut(true)
    await logLoginEvent(profile, profile.email, 'Signed Out')
    await supabase.auth.signOut()
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', paddingTop: 'var(--pmms-banner-offset, 0px)' }}>
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
          <button onClick={() => setTab('pipeline')} style={{ ...choiceBtn(tab === 'pipeline'), flex: 1 }}>Pipeline</button>
          <button onClick={() => setTab('new')} style={{ ...choiceBtn(tab === 'new'), flex: 1 }}>Report an Issue</button>
          <button onClick={() => setTab('signoff')} style={{ ...choiceBtn(tab === 'signoff'), flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
            Sign Off
            {signOffCount > 0 && (
              <span style={{ background: tab === 'signoff' ? 'rgba(255,255,255,0.3)' : COLORS.red600, color: COLORS.white, fontSize: '10px', fontWeight: 800, borderRadius: '999px', minWidth: '17px', padding: '1px 5px' }}>
                {signOffCount}
              </span>
            )}
          </button>
        </div>

        {tab === 'new' && <NewReportForm profile={profile} onSubmitted={() => setTab('pipeline')} />}
        {tab === 'pipeline' && <PipelineList profile={profile} />}
        {tab === 'signoff' && <SignOffList profile={profile} onChanged={fetchSignOffCount} />}
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
  const [mediaFiles, setMediaFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    supabase.schema('pmms').rpc('builder_properties').order('address').then(({ data, error: fetchError }) => {
      if (!fetchError) setProperties(data || [])
    })
    fetchMaintenanceCategories().then(setMaintenanceCategories)
  }, [])

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
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
      })
      .select('id, ticket_number')

    if (insertError) {
      setSubmitting(false)
      setError(insertError.message)
      return
    }

    if (mediaFiles.length > 0) {
      try {
        const [firstUrl] = await uploadTicketAttachments(mediaFiles, data[0].id, profile.id, { onProgress: setUploadProgress })
        await supabase.schema('pmms').from('tickets').update({ photo_url: firstUrl }).eq('id', data[0].id)
      } catch (uploadErr) {
        setSubmitting(false)
        setUploadProgress(null)
        setError(uploadErr.message)
        return
      }
    }

    setSubmitting(false)
    setUploadProgress(null)
    setSuccess(`Thanks — your report has been logged as Job #${data[0].ticket_number}. Our team will review and assign it.`)
    setPropertyId(''); setRoom(null); setOtherArea(''); setCategory(null); setIssueTag(null); setIssueOther('')
    setNotes(''); setMediaFiles([])
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

          <p style={{ ...fieldLabelStyle, marginTop: '16px' }}>Photos / videos (optional)</p>
          <TicketMediaPicker files={mediaFiles} onChange={setMediaFiles} inputId="submitter-ticket-media-input" />
        </div>
      )}

      {error && <p style={{ color: COLORS.red600, fontSize: '13px', fontWeight: 600, marginTop: '16px' }}>{error}</p>}

      {issueTag && (
        <button onClick={handleSubmit} disabled={!canSubmit} style={{ ...choiceBtn(true), width: '100%', marginTop: '20px', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
          {submitting ? (formatUploadProgress(uploadProgress) || 'Submitting...') : 'Submit Report'}
        </button>
      )}
    </div>
  )
}

// Groups the real ticket lifecycle into 4 tiles a single submitter's
// volume actually warrants -- Assigned/In Progress/On Hold all read as
// "someone's on it" from a reporter's point of view, not 3 separate
// numbers to parse. Cancelled is deliberately excluded from "Total" and
// hidden from the default list, same convention AdminPipeline.jsx uses
// for its own list -- a mistaken/duplicate cancel shouldn't clutter the
// view, but it's still one tap away.
const PIPELINE_FILTERS = {
  All: (t) => t.status !== 'Cancelled',
  Pending: (t) => t.status === 'Pending',
  Active: (t) => ['Assigned', 'In Progress', 'On Hold'].includes(t.status),
  Completed: (t) => t.status === 'Completed',
  Archived: (t) => t.status === 'Archived',
  Cancelled: (t) => t.status === 'Cancelled',
}

function PipelineList({ profile }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('All')
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
      .select('id, ticket_number, status, category, issue_tag, room, created_at, property_id')
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

  const kpis = [
    { label: 'Total', value: tickets.filter(PIPELINE_FILTERS.All).length, colour: COLORS.slate500, key: 'All' },
    { label: 'Pending', value: tickets.filter(PIPELINE_FILTERS.Pending).length, colour: COLORS.red600, key: 'Pending' },
    { label: 'Active', value: tickets.filter(PIPELINE_FILTERS.Active).length, colour: COLORS.teal600, key: 'Active' },
    { label: 'Completed', value: tickets.filter(PIPELINE_FILTERS.Completed).length, colour: COLORS.purple600, key: 'Completed' },
    { label: 'Archived', value: tickets.filter(PIPELINE_FILTERS.Archived).length, colour: COLORS.green600, key: 'Archived' },
  ]

  const filteredTickets = tickets.filter(PIPELINE_FILTERS[statusFilter])

  if (tickets.length === 0) {
    return (
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No reports submitted yet.</p>
      </div>
    )
  }

  return (
    <div>
      <KpiTiles kpis={kpis} onTileClick={(kpi) => setStatusFilter(kpi.key)} />

      {statusFilter !== 'All' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: COLORS.teal50, border: `1px solid ${COLORS.teal300}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.teal700 }}>Showing: {statusFilter} ({filteredTickets.length})</span>
          <button onClick={() => setStatusFilter('All')} style={{ background: 'none', border: 'none', color: COLORS.teal700, fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
            Clear filter
          </button>
        </div>
      )}

      {filteredTickets.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No tickets match this filter.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredTickets.map(t => (
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
      )}
    </div>
  )
}

// Directors' rule: only the person who raised a ticket signs it off -- for
// a Ticket Submitter that means right here, since this narrow dashboard has
// no separate admin-style Sign-Off page. Same archive + system comment +
// audit trail as AdminSignOff.jsx's verifyAndArchive, allowed by the
// matching RLS in scripts/add_raiser_only_signoff.sql. Shows the same
// before/after evidence (reported photo vs completion photo) the real
// Sign-Off page shows, since that's the actual point of this step -- a
// considered check, not a rubber stamp.
function SignOffList({ profile, onChanged }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)
  const [archivingId, setArchivingId] = useState(null)
  const [archiveError, setArchiveError] = useState('')

  useEffect(() => {
    fetchPending()
  }, [])

  async function fetchPending() {
    setLoading(true)
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, issue_tag, room, photo_url, completion_note, completion_photo_url, created_at, property_id')
      .eq('raised_by', profile.id)
      .eq('status', 'Completed')
      .order('created_at', { ascending: false })

    if (!error) setTickets(await attachBuilderSafeProperties(data || []))
    setLoading(false)
  }

  async function handleVerifyArchive(ticket) {
    setArchiveError('')
    setArchivingId(ticket.id)

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Archived', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null })
      .eq('id', ticket.id)

    if (error) {
      setArchiveError(error.message)
      setArchivingId(null)
      return
    }

    await postSystemComment(ticket.id, profile, `Verified and archived by ${profile.name}.`)
    await postAuditEvent(ticket.id, profile, 'Status Changed', `Completed → Archived (verified by ${profile.name})`)
    setArchivingId(null)
    setConfirmId(null)
    await fetchPending()
    onChanged?.()
  }

  if (loading) {
    return (
      <div style={{ minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading...</p>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>All clear — nothing awaiting your sign-off.</p>
      </div>
    )
  }

  return (
    <div>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.slate500 }}>
        These have been marked complete. Check the work before signing off -- once archived, a ticket is closed for good.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tickets.map(t => (
          <div key={t.id} style={cardStyle}>
            <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>#{t.ticket_number} · {t.category}</p>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate500 }}>{t.property?.address || 'Unknown property'} · {t.room}</p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
              <div>
                <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>You reported</p>
                {t.photo_url ? (
                  <AttachmentMedia url={t.photo_url} alt="Reported issue" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '8px' }} />
                ) : (
                  <div style={{ width: '100%', height: '110px', borderRadius: '8px', background: COLORS.slate50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '11px', color: COLORS.slate400, fontStyle: 'italic' }}>No photo</span>
                  </div>
                )}
              </div>
              <div>
                <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed work</p>
                {t.completion_photo_url ? (
                  <AttachmentMedia url={t.completion_photo_url} alt="Completed work" style={{ width: '100%', height: '110px', objectFit: 'cover', borderRadius: '8px' }} />
                ) : (
                  <div style={{ width: '100%', height: '110px', borderRadius: '8px', background: COLORS.slate50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span style={{ fontSize: '11px', color: COLORS.slate400, fontStyle: 'italic' }}>No photo</span>
                  </div>
                )}
              </div>
            </div>

            {t.completion_note && (
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate600, background: COLORS.slate50, borderRadius: '8px', padding: '8px 10px' }}>{t.completion_note}</p>
            )}

            {archiveError && confirmId === t.id && (
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: COLORS.red600, fontWeight: 600 }}>{archiveError}</p>
            )}

            {confirmId === t.id ? (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => handleVerifyArchive(t)}
                  disabled={archivingId === t.id}
                  style={{ ...choiceBtn(true), flex: 1, opacity: archivingId === t.id ? 0.6 : 1, cursor: archivingId === t.id ? 'not-allowed' : 'pointer' }}
                >
                  {archivingId === t.id ? 'Confirming...' : 'Confirm sign-off'}
                </button>
                <button onClick={() => setConfirmId(null)} style={{ ...choiceBtn(false), flex: 1 }}>Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmId(t.id)} style={{ ...choiceBtn(true), width: '100%' }}>✓ Verify &amp; Sign Off</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
