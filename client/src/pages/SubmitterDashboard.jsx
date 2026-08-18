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
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { logLoginEvent } from '../lib/loginEvents'
import { uploadTicketAttachments, formatUploadProgress } from '../lib/ticketAttachments'
import { fetchMaintenanceCategories, sortedCategoryEntries, isUnlistedTag, unlistedTagFor, unlistedLabelFor, calculatePriorityScore } from '../lib/maintenanceCategories'
import { attachBuilderSafeProperties } from '../lib/properties'
import { statusColour, statusLabel, postSystemComment, postAuditEvent, KpiTiles, resolveStaffPhotoUrl, suggestAutoAssignBuilder, createNotification, fetchManagersForDivision, sendPushNotification, floorContextOptions, floorContextLabel } from './admin/shared'
import { NavIcon } from '../lib/icons'
import PropertySearchSelect from '../components/PropertySearchSelect'
import VoiceInputButton from '../components/VoiceInputButton'
import TicketMediaPicker from '../components/TicketMediaPicker'
import TicketAttachmentGallery from '../components/TicketAttachmentGallery'
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

// Same 3 things this dashboard has always done -- raise, track, sign off --
// now presented as a left-nav shell instead of a top button row, matching
// the Admin/Manager shell (pages/AdminDashboard.jsx) look for look: same
// navy sidebar, same collapse rail, same avatar-and-name footer. Kept as
// its own component rather than reusing that one directly -- it's deeply
// wired to Admin/Manager-only concerns (18 nav items, Pipeline filter
// hand-off props, Settings/Admin/View As popover) that don't apply here,
// and a submitter's 3 items are simple enough not to need any of that.
const NAV_ITEMS = [
  { key: 'pipeline', label: 'Pipeline', icon: 'pipeline' },
  { key: 'new', label: 'Report an Issue', icon: 'ticket' },
  { key: 'signoff', label: 'Sign Off', icon: 'check' },
]

export default function SubmitterDashboard({ profile }) {
  // Same ?page= pattern as the Admin shell -- survives a browser refresh
  // instead of always resetting to Pipeline.
  const [searchParams, setSearchParams] = useSearchParams()
  const currentPage = searchParams.get('page') || 'pipeline'
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('pmms_sidebar_collapsed') === 'true' } catch { return false }
  })
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

  function toggleSidebarCollapsed() {
    setSidebarCollapsed(prev => {
      const next = !prev
      try { localStorage.setItem('pmms_sidebar_collapsed', String(next)) } catch { /* ignore */ }
      return next
    })
  }

  function goToPage(key) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('page', key)
      return next
    }, { replace: true })
    setSidebarOpen(false)
  }

  async function handleSignOut() {
    setSigningOut(true)
    await logLoginEvent(profile, profile.email, 'Signed Out')
    await supabase.auth.signOut()
  }

  const navButtonStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: '10px', width: '100%', textAlign: 'left', padding: '6px 12px', marginBottom: '1px',
    borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: active ? 700 : 400,
    background: active ? COLORS.green600 : 'transparent', color: COLORS.white, fontFamily: 'inherit',
  })
  const navIconStyle = { width: '18px', flexShrink: 0, textAlign: 'center', fontSize: '14px', lineHeight: 1 }

  // Instantiated twice (desktop rail + mobile drawer), same as the Admin
  // shell -- allowCollapse only true for the desktop one.
  function SidebarContent({ allowCollapse = false }) {
    const isCollapsed = allowCollapse && sidebarCollapsed

    return (
      <>
        {allowCollapse && (
          <button
            onClick={toggleSidebarCollapsed}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            style={{
              position: 'absolute', top: '50%', right: '-12px', transform: 'translateY(-50%)', width: '24px', height: '24px', borderRadius: '50%',
              background: COLORS.forestDark, border: '1px solid rgba(255,255,255,0.18)', boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: COLORS.white, zIndex: 10,
            }}
          >
            <span style={{ display: 'flex', transform: isCollapsed ? 'rotate(180deg)' : 'none' }}>
              <NavIcon name="chevronLeft" size={13} />
            </span>
          </button>
        )}

        <button
          onClick={() => goToPage('pipeline')}
          style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: '16px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.1)', width: '100%', textAlign: 'left', justifyContent: isCollapsed ? 'center' : 'flex-start' }}
        >
          <img src={gbchLogo} alt="GBCH" style={{ height: '32px', flexShrink: 0 }} />
          {!isCollapsed && <span style={{ fontSize: '15px', fontWeight: 800, color: COLORS.white, whiteSpace: 'nowrap' }}>Support System</span>}
        </button>

        <nav className="pmms-sidebar-nav" style={{ flex: 1, padding: '8px 10px', overflowY: 'auto', overflowX: 'hidden' }}>
          {NAV_ITEMS.map(item => {
            const alertCount = item.key === 'signoff' ? signOffCount : 0
            return (
              <button
                key={item.key}
                onClick={() => goToPage(item.key)}
                style={{ ...navButtonStyle(currentPage === item.key), justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '8px 0' : '6px 12px' }}
              >
                <span style={{ ...navIconStyle, position: 'relative' }}>
                  <NavIcon name={item.icon} />
                  {isCollapsed && alertCount > 0 && (
                    <span style={{ position: 'absolute', top: '-3px', right: '-1px', width: '8px', height: '8px', borderRadius: '50%', background: COLORS.red600, border: `1.5px solid ${COLORS.forestDark}` }} />
                  )}
                </span>
                {!isCollapsed && (
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                    {alertCount > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, borderRadius: '999px', padding: '1px 8px', marginLeft: '8px', minWidth: '20px', textAlign: 'center', flexShrink: 0 }}>
                        {alertCount}
                      </span>
                    )}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px', marginBottom: '10px', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
            {resolveStaffPhotoUrl(profile.photo_url) ? (
              <img src={resolveStaffPhotoUrl(profile.photo_url)} alt="" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
            ) : (
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'rgba(255,255,255,0.15)', color: COLORS.white, fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {(profile.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase()}
              </div>
            )}
            {!isCollapsed && (
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.name}</p>
                <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Ticket Submitter</p>
              </div>
            )}
          </div>
          <button
            onClick={handleSignOut}
            disabled={signingOut}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '8px 0' : '8px 12px', background: 'rgba(255,255,255,0.1)', color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: signingOut ? 'default' : 'pointer' }}
          >
            <span style={navIconStyle}><NavIcon name="logout" /></span>
            {!isCollapsed && <span>{signingOut ? 'Signing out...' : 'Sign out'}</span>}
          </button>
        </div>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif' }}>

      {/* Desktop sidebar */}
      <div
        className="admin-sidebar-desktop"
        style={{
          width: sidebarCollapsed ? '64px' : '240px', minWidth: sidebarCollapsed ? '64px' : '240px',
          background: COLORS.forestDark, display: 'flex', flexDirection: 'column', position: 'sticky',
          top: 'var(--pmms-banner-offset, 0px)', height: 'calc(100vh - var(--pmms-banner-offset, 0px))',
          transition: 'width 0.2s ease, min-width 0.2s ease',
        }}
      >
        <SidebarContent allowCollapse />
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', paddingTop: 'var(--pmms-banner-offset, 0px)' }}>

        {/* Mobile top bar */}
        <div
          className="admin-mobile-topbar"
          style={{ alignItems: 'center', justifyContent: 'space-between', background: COLORS.forestDark, padding: '14px 16px', position: 'sticky', top: 'var(--pmms-banner-offset, 0px)', zIndex: 20 }}
        >
          <button onClick={() => goToPage('pipeline')} style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <img src={gbchLogo} alt="GBCH" style={{ height: '28px' }} />
            <span style={{ color: COLORS.white, fontWeight: 800, fontSize: '14px' }}>Support System</span>
          </button>
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Menu"
            style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
          >
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
            <span style={{ width: '22px', height: '2px', background: COLORS.white, borderRadius: '2px' }} />
          </button>
        </div>

        {/* Main content -- full width, matching the Admin shell (individual
            forms below still cap their own width where that's genuinely
            more readable, e.g. NewReportForm; list/detail views stretch). */}
        <div style={{ flex: 1, padding: '20px', width: '100%', boxSizing: 'border-box' }}>
          {currentPage === 'new' && <NewReportForm profile={profile} onSubmitted={() => goToPage('pipeline')} />}
          {currentPage === 'pipeline' && <PipelineList profile={profile} onGoToSignOff={() => goToPage('signoff')} />}
          {currentPage === 'signoff' && <SignOffList profile={profile} onChanged={fetchSignOffCount} />}
        </div>
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, zIndex: 100, display: 'flex' }}>
          <div style={{ width: '260px', maxWidth: '80vw', background: COLORS.forestDark, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <SidebarContent />
          </div>
          <div onClick={() => setSidebarOpen(false)} style={{ flex: 1, background: 'rgba(15,23,42,0.5)' }} />
        </div>
      )}
    </div>
  )
}

function NewReportForm({ profile, onSubmitted }) {
  const [properties, setProperties] = useState([])
  const [propertyId, setPropertyId] = useState('')
  const [room, setRoom] = useState(null)
  const [roomContext, setRoomContext] = useState(null)
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
    if (room === 'Garden') return room
    return roomContext ? `${room} (${roomContext})` : room
  }

  async function handleSubmit() {
    setError('')
    if (mediaFiles.length === 0) {
      setError('Please add at least one photo of the issue.')
      return
    }
    setSubmitting(true)

    const finalIssueTag = isUnlistedTag(issueTag) ? `[Unlisted: ${category}] ${issueOther}` : issueTag
    const description = notes.trim() ? `${finalIssueTag} — ${notes.trim()}` : finalIssueTag
    const priorityScore = calculatePriorityScore(maintenanceCategories, category, issueTag)

    // No assignment picker here (submitters never got one) -- routing
    // happens silently instead, same least-loaded-eligible-builder logic
    // as the admin raise-ticket form, just without the option to see or
    // override it before submitting.
    const suggested = await suggestAutoAssignBuilder(category)

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
        assigned_builder_id: suggested?.id || null,
        assign_type: suggested ? 'Auto' : 'Manual',
        status: suggested ? 'Assigned' : 'Pending',
        first_assigned_at: suggested ? new Date().toISOString() : null,
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

    if (suggested) {
      await createNotification(suggested.id, data[0].id, `You've been assigned Job #${data[0].ticket_number}.`)
    } else {
      await postSystemComment(data[0].id, profile, 'No eligible builder was found for this category at the time this ticket was raised. Needs manual assignment.')
    }

    if (mediaFiles.length > 0) {
      try {
        const [firstUrl] = await uploadTicketAttachments(mediaFiles, data[0].id, profile.id, { onProgress: setUploadProgress })
        // A plain .update() here was silently blocked by RLS -- a
        // submitter's only UPDATE policy on tickets is the Completed ->
        // Archived sign-off one, so this never actually took effect (the
        // photo itself uploaded fine, it just never got linked back onto
        // the ticket). See scripts/add_submitter_set_report_photo.sql.
        await supabase.schema('pmms').rpc('set_ticket_report_photo', { p_ticket_id: data[0].id, p_photo_url: firstUrl })
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
    setPropertyId(''); setRoom(null); setRoomContext(null); setOtherArea(''); setCategory(null); setIssueTag(null); setIssueOther('')
    setNotes(''); setMediaFiles([])
  }

  const selectedProperty = properties.find(p => String(p.id) === String(propertyId))
  const step2Complete = !!room && (room !== 'Other Area...' || otherArea.trim())
  const canSubmit = propertyId && step2Complete && category && issueTag && (!isUnlistedTag(issueTag) || issueOther.trim()) && mediaFiles.length > 0 && !submitting

  if (success) {
    return (
      <div style={{ maxWidth: '640px', ...cardStyle }}>
        <p style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 600, color: COLORS.green700 }}>✓ {success}</p>
        <button onClick={() => setSuccess('')} style={{ ...choiceBtn(false), width: '100%' }}>Report Another Issue</button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '640px', ...cardStyle }}>
      <p style={fieldLabelStyle}>1. Property</p>
      <PropertySearchSelect properties={properties} value={propertyId} onChange={(id) => { setPropertyId(id); setRoom(null); setRoomContext(null); setCategory(null); setIssueTag(null) }} />

      {propertyId && (
        <div style={{ marginTop: '20px' }}>
          <p style={fieldLabelStyle}>2. Room / Area</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {ROOM_OPTIONS.map(r => (
              <button
                key={r}
                onClick={() => {
                  setRoom(r)
                  setOtherArea('')
                  const opts = floorContextOptions(selectedProperty)
                  // A single-option property (e.g. a true one-floor house)
                  // has nothing to actually choose -- auto-fill it same as
                  // Flat already defaulted to its first option, just
                  // without leaving the picker up for a choice that isn't
                  // really one.
                  setRoomContext(opts.length === 1 || selectedProperty?.layout_type === 'Flat' ? opts[0] : null)
                }}
                style={choiceBtn(room === r)}
              >
                {r}
              </button>
            ))}
          </div>

          {room && room !== 'Other Area...' && room !== 'Garden' && floorContextOptions(selectedProperty).length > 1 && (
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px dashed ${COLORS.slate200}` }}>
              <p style={fieldLabelStyle}>{floorContextLabel(selectedProperty)}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {floorContextOptions(selectedProperty).map(ctx => (
                  <button key={ctx} onClick={() => setRoomContext(ctx)} style={choiceBtn(roomContext === ctx)}>{ctx}</button>
                ))}
              </div>
            </div>
          )}

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

          <p style={{ ...fieldLabelStyle, marginTop: '16px' }}>Photo of the issue (required)</p>
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

// Assigned/In Progress/On Hold used to be lumped into one "Active" tile,
// on the theory they all read as "someone's on it" from a reporter's point
// of view -- found live that this wasn't true: Assigned only means a
// builder's been designated, not that work has started, and On Hold means
// it's paused. Only In Progress is actually backed by a live work session
// (see BuilderDashboard's clock-in/Stop-button flow). Kept as 3 separate,
// honest filters rather than one reassuring-but-inaccurate bucket.
// Cancelled is deliberately excluded from "Total" and hidden from the
// default list, same convention AdminPipeline.jsx uses for its own list --
// a mistaken/duplicate cancel shouldn't clutter the view, but it's still
// one tap away.
const PIPELINE_FILTERS = {
  All: (t) => t.status !== 'Cancelled',
  Pending: (t) => t.status === 'Pending',
  Assigned: (t) => t.status === 'Assigned',
  InProgress: (t) => t.status === 'In Progress',
  OnHold: (t) => t.status === 'On Hold',
  Completed: (t) => t.status === 'Completed',
  Archived: (t) => t.status === 'Archived',
  Cancelled: (t) => t.status === 'Cancelled',
}

function PipelineList({ profile, onGoToSignOff }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('') // '' = All Properties, matches PropertySearchSelect's own cleared state
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [viewingTicket, setViewingTicket] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    fetchMine()
  }, [])

  async function fetchMine() {
    setLoading(true)
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, issue_tag, room, created_at, completed_at, property_id')
      .eq('raised_by', profile.id)
      .order('created_at', { ascending: false })

    if (!error) setTickets(await attachBuilderSafeProperties(data || []))
    setLoading(false)
  }

  // Opens a dedicated details screen instead of the old inline expand --
  // that used to pull the raw comments thread, which showed manager/builder
  // names (e.g. "Reassigned from X to Y") that have nothing to do with a
  // submitter's own view of their report. This shows only what's actually
  // his: what he reported, and (once done) the completed work -- no names,
  // no internal handling detail.
  async function openDetail(ticket) {
    setDetailLoading(true)
    setViewingTicket(ticket)
    const { data } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, room, description, photo_url, completion_note, completion_photo_url, created_at, completed_at, property_id')
      .eq('id', ticket.id)
      .maybeSingle()

    if (data) setViewingTicket((await attachBuilderSafeProperties([data]))[0])
    setDetailLoading(false)
  }

  if (loading) {
    return (
      <div style={{ minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading your reports...</p>
      </div>
    )
  }

  if (viewingTicket) {
    return (
      <div>
        <button
          onClick={() => setViewingTicket(null)}
          style={{ background: 'none', border: 'none', color: COLORS.teal700, fontSize: '13px', fontWeight: 700, cursor: 'pointer', padding: 0, marginBottom: '16px' }}
        >
          ← Back to Pipeline
        </button>
        {detailLoading ? (
          <div style={{ minHeight: '160px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading...</p>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>#{viewingTicket.ticket_number} · {viewingTicket.category}</p>
              <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 800, color: COLORS.white, background: statusColour(viewingTicket.status), padding: '4px 10px', borderRadius: '999px' }}>
                {statusLabel(viewingTicket.status)}
              </span>
            </div>
            <p style={{ margin: '0 0 20px 0', fontSize: '12px', color: COLORS.slate500 }}>{viewingTicket.property?.address || 'Unknown property'} · {viewingTicket.room}</p>

            <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              You reported · {new Date(viewingTicket.created_at).toLocaleDateString()}
            </p>
            <div style={{ marginBottom: '8px' }}>
              <TicketAttachmentGallery ticketId={viewingTicket.id} fallbackUrl={viewingTicket.photo_url} mediaHeight="160px" />
            </div>
            {viewingTicket.description && (
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate600, background: COLORS.slate50, borderRadius: '8px', padding: '10px 12px' }}>{viewingTicket.description}</p>
            )}

            {(viewingTicket.completion_note || viewingTicket.completion_photo_url) && (
              <>
                <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Completed work{viewingTicket.completed_at ? ` · ${new Date(viewingTicket.completed_at).toLocaleDateString()}` : ''}
                </p>
                <div style={{ marginBottom: '8px' }}>
                  <TicketAttachmentGallery ticketId={viewingTicket.id} fallbackUrl={viewingTicket.completion_photo_url} mediaHeight="160px" stage="completed" />
                </div>
                {viewingTicket.completion_note && (
                  <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600, background: COLORS.slate50, borderRadius: '8px', padding: '10px 12px' }}>{viewingTicket.completion_note}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // Labels are deliberately reworded from the raw status names for a
  // submitter's point of view -- "Pending"/"Active"/"Archived" are internal
  // staff vocabulary that either mismatched the per-ticket badge wording
  // (statusLabel already shows "Unassigned", not "Pending") or overclaimed
  // things a submitter can't actually tell from a status alone (see
  // PIPELINE_FILTERS.Active's own comment). Auto-routing means sitting
  // unassigned should now be the rare exception, not a normal first stage,
  // so that tile is worded as a flag rather than an expected step.
  const needsConfirmationCount = tickets.filter(PIPELINE_FILTERS.Completed).length

  const kpis = [
    { label: 'Total', value: tickets.filter(PIPELINE_FILTERS.All).length, colour: COLORS.slate500, key: 'All' },
    { label: 'Not Picked Up Yet', value: tickets.filter(PIPELINE_FILTERS.Pending).length, colour: COLORS.red600, key: 'Pending' },
    { label: 'Assigned, Not Started', value: tickets.filter(PIPELINE_FILTERS.Assigned).length, colour: COLORS.blue500, key: 'Assigned' },
    { label: 'In Progress', value: tickets.filter(PIPELINE_FILTERS.InProgress).length, colour: COLORS.teal600, key: 'InProgress' },
    { label: 'On Hold', value: tickets.filter(PIPELINE_FILTERS.OnHold).length, colour: COLORS.amber600, key: 'OnHold' },
    // Red, not purple, once there's actually something waiting on her --
    // this is the one tile that means "you're the reason this job hasn't
    // closed out", same urgency framing as "Not Picked Up Yet" above.
    // Stays purple at zero so the row isn't all-red when there's nothing
    // to act on.
    { label: 'Needs Your Confirmation', value: needsConfirmationCount, colour: needsConfirmationCount > 0 ? COLORS.red600 : COLORS.purple600, key: 'Completed' },
    { label: 'Closed', value: tickets.filter(PIPELINE_FILTERS.Archived).length, colour: COLORS.green600, key: 'Archived' },
  ]

  // Options come from her own tickets, not a full property list -- this
  // filter only ever needs to narrow reports she's actually raised, so
  // there's no reason to fetch/show properties she has nothing logged
  // against (same reasoning attachBuilderSafeProperties already applies:
  // scope to what's actually in play, not the whole portfolio).
  const propertyOptions = [...new Map(
    tickets.filter(t => t.property).map(t => [t.property.id, t.property])
  ).values()].sort((a, b) => a.address.localeCompare(b.address))

  // Same idea as the admin Pipeline's own date range: "Completed"/"Closed"
  // means "when did this actually finish", not "when did I raise it" --
  // everything else still filters on when she reported it.
  const dateField = (statusFilter === 'Completed' || statusFilter === 'Archived') ? 'completed_at' : 'created_at'

  const filteredTickets = tickets.filter(PIPELINE_FILTERS[statusFilter]).filter(t => {
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (fromDate && (!t[dateField] || new Date(t[dateField]).getTime() < new Date(fromDate).getTime())) return false
    if (toDate && (!t[dateField] || new Date(t[dateField]).getTime() > new Date(toDate).getTime() + 86400000 - 1)) return false
    return true
  })

  const filtersActive = statusFilter !== 'All' || propertyFilter || fromDate || toDate

  function clearAllFilters() {
    setStatusFilter('All')
    setPropertyFilter('')
    setFromDate('')
    setToDate('')
  }

  if (tickets.length === 0) {
    return (
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>No reports submitted yet.</p>
      </div>
    )
  }

  return (
    <div>
      <KpiTiles
        kpis={kpis}
        onTileClick={(kpi) => (kpi.key === 'Completed' ? onGoToSignOff?.() : setStatusFilter(kpi.key))}
      />

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <div style={{ minWidth: '220px', flex: '1 1 220px' }}>
          <PropertySearchSelect properties={propertyOptions} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>
            {(statusFilter === 'Completed' || statusFilter === 'Archived') ? 'Completed' : 'Raised'}
          </span>
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ ...inputStyle, width: 'auto', height: '40px' }} />
          <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate400 }}>to</span>
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ ...inputStyle, width: 'auto', height: '40px' }} />
        </div>
      </div>

      {filtersActive && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', background: COLORS.teal50, border: `1px solid ${COLORS.teal300}`, borderRadius: '10px', padding: '10px 16px', marginBottom: '16px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.teal700 }}>Showing: {statusFilter} ({filteredTickets.length})</span>
          <button onClick={clearAllFilters} style={{ background: 'none', border: 'none', color: COLORS.teal700, fontSize: '13px', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>
            Clear filters
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
              <div onClick={() => openDetail(t)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>#{t.ticket_number} · {t.category}</p>
                  <p style={{ margin: '0 0 4px 0', fontSize: '12px', color: COLORS.slate500 }}>{t.property?.address || 'Unknown property'} · {t.room}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: COLORS.slate400 }}>{new Date(t.created_at).toLocaleDateString()}</p>
                </div>
                <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 800, color: COLORS.white, background: statusColour(t.status), padding: '4px 10px', borderRadius: '999px' }}>
                  {statusLabel(t.status)}
                </span>
              </div>
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
//
// The 3-question quality check (agreed with directors, built 2026-08-17 --
// see add_submitter_signoff_quality_check.sql) sits in front of the actual
// archive: all 3 "Yes" archives exactly as before; any "No" blocks
// archiving and notifies the ticket's division manager(s) instead, with a
// required note on what's wrong. The ticket stays in the Sign-Off list
// (still status 'Completed') so the submitter can come back and try again
// once it's addressed.
const SIGNOFF_QUESTIONS = [
  { key: 'resolved', label: 'Was the issue resolved?' },
  { key: 'goodStandard', label: 'Was the work done to a good standard?' },
  { key: 'clean', label: 'Was the property left clean and tidy?' },
]

function SignOffList({ profile, onChanged }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [confirmId, setConfirmId] = useState(null)
  const [archivingId, setArchivingId] = useState(null)
  const [archiveError, setArchiveError] = useState('')
  const [signoffAnswers, setSignoffAnswers] = useState({ resolved: null, goodStandard: null, clean: null })
  const [signoffNote, setSignoffNote] = useState('')
  const [maintenanceCategories, setMaintenanceCategories] = useState({})

  useEffect(() => {
    fetchPending()
    fetchMaintenanceCategories().then(setMaintenanceCategories)
  }, [])

  // Fresh answers every time a different ticket's confirm panel opens --
  // never carries a stale answer over from whichever ticket was open before.
  useEffect(() => {
    setSignoffAnswers({ resolved: null, goodStandard: null, clean: null })
    setSignoffNote('')
    setArchiveError('')
  }, [confirmId])

  async function fetchPending() {
    setLoading(true)
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, category, issue_tag, room, photo_url, completion_note, completion_photo_url, created_at, property_id, signoff_flagged, signoff_note, signoff_submitted_at')
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
      .update({
        status: 'Archived', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null,
        signoff_resolved: true, signoff_good_standard: true, signoff_clean: true, signoff_flagged: false,
        signoff_note: null, signoff_submitted_at: new Date().toISOString(),
      })
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

  // The "No" path -- ticket stays Completed (never archived), the 3
  // answers + note are recorded, and the ticket's division manager(s) get
  // notified (in-app + push), same notifyUnableToDo pattern
  // BuilderDashboard.jsx already uses for the equivalent builder-side flag.
  async function handleFlagSignoff(ticket) {
    setArchiveError('')
    setArchivingId(ticket.id)
    const note = signoffNote.trim()
    const now = new Date().toISOString()

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        signoff_resolved: signoffAnswers.resolved, signoff_good_standard: signoffAnswers.goodStandard, signoff_clean: signoffAnswers.clean,
        signoff_note: note, signoff_flagged: true, signoff_submitted_at: now,
      })
      .eq('id', ticket.id)

    if (error) {
      setArchiveError(error.message)
      setArchivingId(null)
      return
    }

    await postSystemComment(ticket.id, profile, `Sign-off flagged by ${profile.name}: ${note}`)
    await postAuditEvent(ticket.id, profile, 'Sign-off Flagged', note)

    const division = maintenanceCategories[ticket.category]?.division || 'Maintenance'
    const managers = await fetchManagersForDivision(division)
    const message = `Job #${ticket.ticket_number} sign-off flagged by ${profile.name}: ${note}`
    for (const manager of managers) {
      await createNotification(manager.id, ticket.id, message)
    }
    if (managers.length > 0) {
      await sendPushNotification(managers.map(m => m.id), 'Sign-off flagged', `#${ticket.ticket_number} — ${note}`)
    }

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
                <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.photo_url} mediaHeight="110px" emptyLabel="No photo" />
              </div>
              <div>
                <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Completed work</p>
                <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.completion_photo_url} mediaHeight="110px" emptyLabel="No photo" stage="completed" />
              </div>
            </div>

            {t.completion_note && (
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: COLORS.slate600, background: COLORS.slate50, borderRadius: '8px', padding: '8px 10px' }}>{t.completion_note}</p>
            )}

            {t.signoff_flagged && (
              <div style={{ margin: '0 0 12px 0', padding: '8px 10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}`, borderRadius: '8px' }}>
                <p style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: COLORS.amber800 }}>⚠ You flagged this — awaiting the manager</p>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: COLORS.amber900 }}>{t.signoff_note}</p>
              </div>
            )}

            {archiveError && confirmId === t.id && (
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', color: COLORS.red600, fontWeight: 600 }}>{archiveError}</p>
            )}

            {confirmId === t.id ? (() => {
              const allAnswered = SIGNOFF_QUESTIONS.every(q => signoffAnswers[q.key] !== null)
              const allYes = SIGNOFF_QUESTIONS.every(q => signoffAnswers[q.key] === true)
              const anyNo = SIGNOFF_QUESTIONS.some(q => signoffAnswers[q.key] === false)
              const canSubmit = allAnswered && (allYes || (anyNo && signoffNote.trim() !== ''))
              const busy = archivingId === t.id
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {SIGNOFF_QUESTIONS.map(q => (
                    <div key={q.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{q.label}</span>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        <button
                          onClick={() => setSignoffAnswers(prev => ({ ...prev, [q.key]: true }))}
                          style={{ ...choiceBtn(signoffAnswers[q.key] === true), padding: '6px 14px' }}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setSignoffAnswers(prev => ({ ...prev, [q.key]: false }))}
                          style={{ ...choiceBtn(signoffAnswers[q.key] === false), padding: '6px 14px' }}
                        >
                          No
                        </button>
                      </div>
                    </div>
                  ))}
                  {anyNo && (
                    <textarea
                      value={signoffNote}
                      onChange={(e) => setSignoffNote(e.target.value)}
                      placeholder="What's wrong, so the manager knows what to follow up on..."
                      rows={2}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
                    />
                  )}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => (allYes ? handleVerifyArchive(t) : handleFlagSignoff(t))}
                      disabled={!canSubmit || busy}
                      style={{
                        ...choiceBtn(true), flex: 1, opacity: (!canSubmit || busy) ? 0.5 : 1, cursor: (!canSubmit || busy) ? 'not-allowed' : 'pointer',
                        ...(anyNo ? { borderColor: COLORS.red600, background: COLORS.red600, color: COLORS.white } : {}),
                      }}
                    >
                      {busy ? 'Saving...' : anyNo ? 'Flag for manager review' : 'Confirm sign-off'}
                    </button>
                    <button onClick={() => setConfirmId(null)} style={{ ...choiceBtn(false), flex: 1 }}>Cancel</button>
                  </div>
                </div>
              )
            })() : (
              <button onClick={() => setConfirmId(t.id)} style={{ ...choiceBtn(true), width: '100%' }}>✓ Verify &amp; Sign Off</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
