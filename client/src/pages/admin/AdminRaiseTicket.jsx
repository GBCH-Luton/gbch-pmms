import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { fetchAssignableStaffForCategory, builderOptionLabel, createNotification, sendPushNotification, pushEmergencyAlert, priorityTierLabel, fetchPriorityThresholds, EVENTS_FEATURE_ENABLED } from './shared'
import { fetchComplianceCheckTypes } from '../../lib/compliance'
import { fetchMaintenanceCategories, sortedCategoryEntries, UNLISTED_MARKER_PREFIX, isUnlistedTag, unlistedTagFor, unlistedLabelFor, calculatePriorityScore } from '../../lib/maintenanceCategories'
import { fetchDivisions } from '../../lib/divisions'
import { compressImage } from '../../lib/imageCompression'
import { getSignedUrl } from '../../lib/storage'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import VoiceInputButton from '../../components/VoiceInputButton'

const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Garden', 'Other Area...']

function floorContextOptions(property) {
  if (!property) return ['Ground Floor', 'First Floor']
  if (property.layout_type === 'Flat') return ['Main Flat Space', 'En-Suite Area']
  if (property.layout_type === '1-Floor') return ['Ground Floor']
  if (property.layout_type === '3-Floors') return ['Ground Floor', 'First Floor', 'Second Floor']
  return ['Ground Floor', 'First Floor'] // '2-Floors' (the DB default) plus any property with no Floor Layout set yet
}

function floorContextLabel(property) {
  return (property?.layout_type === 'Flat' ? 'Which part of the flat?' : 'Which floor?') + ' (optional)'
}

function choiceButtonStyle(active, align = 'left') {
  return {
    width: '100%',
    height: '44px',
    padding: '0 14px',
    borderRadius: '10px',
    border: active ? `2px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
    background: active ? COLORS.teal700 : COLORS.white,
    color: active ? COLORS.white : COLORS.slate900,
    fontSize: '13px',
    fontWeight: 600,
    fontFamily: 'inherit',
    cursor: 'pointer',
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: align === 'center' ? 'center' : 'flex-start',
    textAlign: align,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  }
}

const SECTION_BG = [COLORS.white, COLORS.slate50]

const fieldSelectStyle = { width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontWeight: 500, boxSizing: 'border-box', background: COLORS.white }
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function AdminRaiseTicket({ profile }) {
  const [loggingMode, setLoggingMode] = useState('maintenance') // 'maintenance' | 'compliance'

  const [ticketProperties, setTicketProperties] = useState([])
  const [ticketPropertyId, setTicketPropertyId] = useState('')
  const [ticketRoom, setTicketRoom] = useState(null)
  const [ticketRoomContext, setTicketRoomContext] = useState(null)
  const [ticketRoomCode, setTicketRoomCode] = useState('')
  const [ticketOtherArea, setTicketOtherArea] = useState('')
  const [maintenanceCategories, setMaintenanceCategories] = useState({})
  const [ticketCategory, setTicketCategory] = useState(null)
  const [ticketIssueTag, setTicketIssueTag] = useState(null)
  const [ticketIssueOther, setTicketIssueOther] = useState('')
  const [ticketPhotoFile, setTicketPhotoFile] = useState(null)
  const [ticketPhotoPreview, setTicketPhotoPreview] = useState(null)
  const [ticketDuplicateWarning, setTicketDuplicateWarning] = useState(null)
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [ticketError, setTicketError] = useState('')
  const [ticketSuccess, setTicketSuccess] = useState('')

  const [complianceCheckType, setComplianceCheckType] = useState(null)
  const [complianceCheckTypes, setComplianceCheckTypes] = useState([])
  const [complianceResults, setComplianceResults] = useState([])
  const [complianceNotes, setComplianceNotes] = useState([])
  const [complianceMediaFiles, setComplianceMediaFiles] = useState([])
  const [complianceMediaPreviews, setComplianceMediaPreviews] = useState([])
  const [complianceSubmitting, setComplianceSubmitting] = useState(false)
  const [complianceSuccess, setComplianceSuccess] = useState('')

  // Admin-only additions
  const [builders, setBuilders] = useState([])
  const [assignedBuilderId, setAssignedBuilderId] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('')
  const [sendPushOnAssign, setSendPushOnAssign] = useState(false)
  const [priorityOverride, setPriorityOverride] = useState('')
  const [department, setDepartment] = useState('')
  const [departments, setDepartments] = useState([])
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [openEvents, setOpenEvents] = useState([])
  const [selectedEventId, setSelectedEventId] = useState('')

  useEffect(() => {
    fetchTicketProperties()
    fetchComplianceTypes()
    fetchMaintenanceCategories(profile.division).then(setMaintenanceCategories)
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchOpenEvents()
    fetchDivisions().then(setDepartments)
  }, [])

  // Any manager can tag a new ticket to an existing open Event at
  // creation time (see AdminEvents.jsx/AdminPipeline.jsx's "Add to
  // Event" for the retrofit path) -- "open" is computed the same way
  // everywhere: not every linked ticket already in a terminal status.
  async function fetchOpenEvents() {
    const { data: eventRows } = await supabase.schema('pmms').from('events').select('id, title')
    const { data: ticketRows } = await supabase.schema('pmms').from('tickets').select('id, event_id, status')

    const terminal = ['Completed', 'Archived', 'Cancelled']
    const open = (eventRows || []).filter(e => {
      const linked = (ticketRows || []).filter(t => t.event_id === e.id)
      return linked.length === 0 || !linked.every(t => terminal.includes(t.status))
    })
    setOpenEvents(open)
  }

  // Which staff can be assigned depends on the selected category's division
  // (e.g. a Housekeeping category offers Housekeepers, not Builders) -- see
  // fetchAssignableStaffForCategory in shared.js. Refetches whenever the
  // relevant category changes in either mode, and clears any previously
  // picked assignee since they may not be eligible for the new category.
  useEffect(() => {
    const category = loggingMode === 'compliance'
      ? complianceCheckTypes.find(t => t.name === complianceCheckType)?.category
      : ticketCategory

    setAssignedBuilderId('')
    setEstimatedMinutes('')

    if (!category) { setBuilders([]); return }
    fetchAssignableStaffForCategory(category).then(setBuilders)
  }, [loggingMode, ticketCategory, complianceCheckType, complianceCheckTypes])

  async function fetchTicketProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address, high_vulnerability, layout_type')
      .order('address')

    if (!error) setTicketProperties(data)
  }

  async function fetchComplianceTypes() {
    setComplianceCheckTypes(await fetchComplianceCheckTypes())
  }

  function resetTicketForm() {
    setLoggingMode('maintenance')
    setTicketPropertyId('')
    setTicketRoom(null)
    setTicketRoomContext(null)
    setTicketRoomCode('')
    setTicketOtherArea('')
    setTicketCategory(null)
    setTicketIssueTag(null)
    setTicketIssueOther('')
    setTicketPhotoFile(null)
    setTicketPhotoPreview(null)
    setTicketDuplicateWarning(null)
    setTicketSubmitting(false)
    setTicketError('')
    setTicketSuccess('')
    setComplianceCheckType(null)
    setComplianceResults([])
    setComplianceNotes([])
    setComplianceMediaFiles([])
    setComplianceMediaPreviews([])
    setComplianceSubmitting(false)
    setComplianceSuccess('')
    setAssignedBuilderId('')
    setPriorityOverride('')
    setDepartment('')
    setSelectedEventId('')
  }

  const selectedTicketProperty = ticketProperties.find(p => String(p.id) === String(ticketPropertyId))

  function handleTicketPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setTicketPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setTicketPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function ticketRoomString() {
    if (ticketRoom === 'Other Area...') return ticketOtherArea
    if (ticketRoom === 'Garden') return ticketRoom
    if (ticketRoom === 'Bedroom' && ticketRoomCode.trim()) {
      return ticketRoomContext ? `${ticketRoom} (${ticketRoomContext}) - ${ticketRoomCode.trim()}` : `${ticketRoom} - ${ticketRoomCode.trim()}`
    }
    return ticketRoomContext ? `${ticketRoom} (${ticketRoomContext})` : ticketRoom
  }

  async function handleSubmitTicket(skipDuplicateCheck) {
    setTicketError('')

    if (assignedBuilderId && estimatedMinutes === '') {
      setTicketError('Please enter an estimated time for this job.')
      return
    }

    const finalIssueTag = isUnlistedTag(ticketIssueTag) ? `[Unlisted: ${ticketCategory}] ${ticketIssueOther}` : ticketIssueTag
    const priorityScore = calculatePriorityScore(maintenanceCategories, ticketCategory, ticketIssueTag) + (selectedTicketProperty?.high_vulnerability ? 30 : 0)
    const roomString = ticketRoomString()

    if (!skipDuplicateCheck) {
      const { data: openTickets } = await supabase
        .schema('pmms')
        .from('tickets')
        .select('id, ticket_number, category, issue_tag, room, status')
        .eq('property_id', ticketPropertyId)
        .not('status', 'in', '("Completed","Cancelled")')

      const exactMatch = openTickets?.find(t => t.issue_tag === finalIssueTag)
      const categoryMatch = openTickets?.find(t => t.category === ticketCategory)
      const possibleDup = exactMatch || categoryMatch

      if (possibleDup) {
        setTicketDuplicateWarning({ ticket: possibleDup, matchKind: exactMatch ? 'the same issue' : 'the same category' })
        return
      }
    }

    setTicketDuplicateWarning(null)
    setTicketSubmitting(true)

    let photoUrl = null
    if (ticketPhotoFile) {
      const compressedTicketPhoto = await compressImage(ticketPhotoFile)
      const path = `${profile.id}/${Date.now()}-${compressedTicketPhoto.name}`
      const { error: uploadError } = await supabase.storage
        .from('ticket-photos')
        .upload(path, compressedTicketPhoto)

      if (uploadError) {
        setTicketSubmitting(false)
        setTicketError(`Photo upload failed: ${uploadError.message}`)
        return
      }

      photoUrl = await getSignedUrl('ticket-photos', path)
    }

    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .insert({
        property_id: ticketPropertyId || null,
        room: roomString,
        category: ticketCategory,
        issue_tag: finalIssueTag,
        description: finalIssueTag,
        priority_score: priorityScore,
        priority_override: priorityOverride || null,
        assigned_builder_id: assignedBuilderId || null,
        estimated_minutes: assignedBuilderId && estimatedMinutes !== '' ? Number(estimatedMinutes) : null,
        department: department || null,
        event_id: selectedEventId || null,
        status: assignedBuilderId ? 'Assigned' : 'Pending',
        first_assigned_at: assignedBuilderId ? new Date().toISOString() : null,
        raised_by: profile.id,
        raised_by_name: profile.name,
        photo_url: photoUrl,
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
      })
      .select('id, ticket_number')

    setTicketSubmitting(false)

    if (error) {
      setTicketError(error.message)
      return
    }

    if (assignedBuilderId) {
      await createNotification(assignedBuilderId, data[0].id, `You've been assigned Job #${data[0].ticket_number} at ${selectedTicketProperty?.address || 'a property'}.`)
      if (sendPushOnAssign) {
        await sendPushNotification([assignedBuilderId], 'New job assigned', `Job #${data[0].ticket_number} at ${selectedTicketProperty?.address || 'a property'}.`)
      }
    }

    const effectiveTier = priorityOverride || priorityTierLabel(priorityScore, p1Threshold, p2Threshold)
    if (effectiveTier === 'P1 Critical') {
      const division = maintenanceCategories[ticketCategory]?.division || 'Maintenance'
      await pushEmergencyAlert(
        { ticket_number: data[0].ticket_number, category: ticketCategory, property: selectedTicketProperty },
        division
      )
    }

    setTicketSuccess(`✓ Ticket #${data[0].ticket_number} created successfully.`)
    setTimeout(() => {
      resetTicketForm()
    }, 2500)
  }

  function handleComplianceCheckType(checkType) {
    setComplianceCheckType(checkType)
    const items = complianceCheckTypes.find(t => t.name === checkType)?.items || []
    setComplianceResults(items.map(() => null))
    setComplianceNotes(items.map(() => ''))
    setComplianceMediaFiles(items.map(() => null))
    setComplianceMediaPreviews(items.map(() => null))
  }

  function setComplianceItemResult(idx, result) {
    setComplianceResults(prev => prev.map((r, i) => i === idx ? result : r))
  }

  function handleComplianceMediaChange(idx, e) {
    const file = e.target.files?.[0]
    if (!file) return
    setComplianceMediaFiles(prev => prev.map((f, i) => i === idx ? file : f))
    setComplianceMediaPreviews(prev => prev.map((p, i) => i === idx ? URL.createObjectURL(file) : p))
  }

  function removeComplianceMedia(idx) {
    setComplianceMediaFiles(prev => prev.map((f, i) => i === idx ? null : f))
    setComplianceMediaPreviews(prev => prev.map((p, i) => i === idx ? null : p))
  }

  async function handleSubmitCompliance() {
    if (!complianceCheckType || complianceResults.length === 0 || complianceResults.some(r => r === null)) return

    if (assignedBuilderId && estimatedMinutes === '') {
      setTicketError('Please enter an estimated time for this job.')
      return
    }

    setComplianceSubmitting(true)
    setTicketError('')

    const selectedType = complianceCheckTypes.find(t => t.name === complianceCheckType)
    const items = selectedType?.items || []
    const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
    const failedItems = items
      .map((item, idx) => ({ ...item, result: complianceResults[idx], note: complianceNotes[idx], mediaFile: complianceMediaFiles[idx] }))
      .filter(i => i.result === 'Fail')

    const createdIds = []

    for (const failedItem of failedItems) {
      const category = selectedType?.category || 'Other / Unlisted Trade'
      const score = failedItem.score + vulnBonus
      const description = `[Compliance Failure: ${complianceCheckType}] ${failedItem.label}${failedItem.note ? ' — ' + failedItem.note : ''}`

      let photoUrl = null
      if (failedItem.mediaFile) {
        // compressImage() is a no-op pass-through for video -- this field
        // can be either a photo or a video, per the input's accept attr.
        const compressedMedia = await compressImage(failedItem.mediaFile)
        const path = `${profile.id}/${Date.now()}-${compressedMedia.name}`
        const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, compressedMedia)
        if (uploadError) {
          setComplianceSubmitting(false)
          setTicketError(`Media upload failed: ${uploadError.message}`)
          return
        }
        photoUrl = await getSignedUrl('ticket-photos', path)
      }

      const { data, error } = await supabase
        .schema('pmms')
        .from('tickets')
        .insert({
          property_id: ticketPropertyId || null,
          room: 'Whole Property (Compliance Walkround)',
          category,
          issue_tag: failedItem.label,
          description,
          priority_score: score,
          photo_url: photoUrl,
          priority_override: priorityOverride || null,
          assigned_builder_id: assignedBuilderId || null,
          estimated_minutes: assignedBuilderId && estimatedMinutes !== '' ? Number(estimatedMinutes) : null,
          department: department || null,
          status: assignedBuilderId ? 'Assigned' : 'Pending',
          first_assigned_at: assignedBuilderId ? new Date().toISOString() : null,
          raised_by: profile.id,
          raised_by_name: profile.name,
          created_at: new Date().toISOString(),
          status_changed_at: new Date().toISOString(),
        })
        .select('id, ticket_number')

      if (error) {
        setComplianceSubmitting(false)
        setTicketError(error.message)
        return
      }

      if (assignedBuilderId) {
        await createNotification(assignedBuilderId, data[0].id, `You've been assigned Job #${data[0].ticket_number} at ${selectedTicketProperty?.address || 'a property'}.`)
        if (sendPushOnAssign) {
          await sendPushNotification([assignedBuilderId], 'New job assigned', `Job #${data[0].ticket_number} at ${selectedTicketProperty?.address || 'a property'}.`)
        }
      }

      const effectiveTier = priorityOverride || priorityTierLabel(score, p1Threshold, p2Threshold)
      if (effectiveTier === 'P1 Critical') {
        const division = maintenanceCategories[category]?.division || 'Maintenance'
        await pushEmergencyAlert(
          { ticket_number: data[0].ticket_number, category, property: selectedTicketProperty },
          division
        )
      }

      createdIds.push(data[0].id)
    }

    setComplianceSubmitting(false)
    setComplianceSuccess(createdIds.length === 0
      ? 'All items passed — no maintenance tickets were created.'
      : `✓ ${createdIds.length} item(s) failed — ticket(s) #${createdIds.join(', #')} created.`)
    setTimeout(() => {
      resetTicketForm()
    }, 3000)
  }

  // Which floor is a nice-to-have, not a blocker -- most properties don't
  // have real Floor Layout data entered yet (see PropertyCoreTab.jsx), so
  // forcing a Ground/First Floor guess out of whoever's raising the ticket
  // just to get past this step isn't worth it. Room itself is still
  // required; floor context is optional extra detail if they know it.
  const ticketStep2Complete = ticketRoom === 'Other Area...'
    ? !!ticketOtherArea.trim()
    : !!ticketRoom

  const ticketStep4Complete = !!ticketIssueTag && (!isUnlistedTag(ticketIssueTag) || !!ticketIssueOther.trim())

  return (
    <div style={{ maxWidth: '720px' }}>

      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Raise Ticket</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: COLORS.slate500 }}>Calculates priority instantly based on the property and issue you select.</p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={() => setLoggingMode('maintenance')}
          style={{
            flex: 1, height: '44px', borderRadius: '10px', boxSizing: 'border-box',
            border: loggingMode === 'maintenance' ? `2px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
            background: loggingMode === 'maintenance' ? COLORS.teal700 : COLORS.white,
            color: loggingMode === 'maintenance' ? COLORS.white : COLORS.slate900,
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Maintenance Issue
        </button>
        <button
          onClick={() => setLoggingMode('compliance')}
          style={{
            flex: 1, height: '44px', borderRadius: '10px', boxSizing: 'border-box',
            border: loggingMode === 'compliance' ? `2px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
            background: loggingMode === 'compliance' ? COLORS.teal700 : COLORS.white,
            color: loggingMode === 'compliance' ? COLORS.white : COLORS.slate900,
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Safety & Compliance Check
        </button>
      </div>

      {loggingMode === 'maintenance' && (
        <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

          {/* Step 1: Target Property */}
          <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: ticketPropertyId ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>1. Target Property</p>
            <PropertySearchSelect
              properties={ticketProperties}
              value={ticketPropertyId}
              onChange={(id) => {
                setTicketPropertyId(id)
                setTicketRoom(null); setTicketRoomContext(null); setTicketRoomCode(''); setTicketOtherArea('')
                setTicketCategory(null); setTicketIssueTag(null); setTicketIssueOther(''); setTicketDuplicateWarning(null)
              }}
            />
          </div>

          {/* Step 2: Room / Area */}
          {ticketPropertyId && (
            <div style={{ background: SECTION_BG[1], padding: '20px', borderBottom: ticketStep2Complete ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>2. Room / Area</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {ROOM_OPTIONS.map(room => {
                  const active = ticketRoom === room
                  return (
                    <button
                      key={room}
                      onClick={() => {
                        setTicketRoom(room)
                        setTicketRoomCode('')
                        setTicketOtherArea('')
                        const opts = floorContextOptions(selectedTicketProperty)
                        // A single-option property (e.g. a true one-floor
                        // house) has nothing to actually choose -- auto-fill
                        // it same as Flat already defaulted to its first
                        // option, just without leaving the picker up for a
                        // choice that isn't really one.
                        setTicketRoomContext(opts.length === 1 || selectedTicketProperty?.layout_type === 'Flat' ? opts[0] : null)
                      }}
                      style={choiceButtonStyle(active, 'center')}
                    >
                      {room}
                    </button>
                  )
                })}
              </div>

              {ticketRoom && ticketRoom !== 'Other Area...' && ticketRoom !== 'Garden' && floorContextOptions(selectedTicketProperty).length > 1 && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px dashed ${COLORS.slate200}` }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {floorContextLabel(selectedTicketProperty)}
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {floorContextOptions(selectedTicketProperty).map(ctx => {
                      const active = ticketRoomContext === ctx
                      return (
                        <button
                          key={ctx}
                          onClick={() => setTicketRoomContext(ctx)}
                          style={choiceButtonStyle(active, 'center')}
                        >
                          {ctx}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {ticketRoom === 'Bedroom' && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px dashed ${COLORS.slate200}` }}>
                  <p style={fieldLabelStyle}>Room number (optional)</p>
                  <input
                    type="text"
                    value={ticketRoomCode}
                    onChange={(e) => setTicketRoomCode(e.target.value)}
                    placeholder="e.g. Room 12C"
                    style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {ticketRoom === 'Other Area...' && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: `1px dashed ${COLORS.slate200}` }}>
                  <p style={fieldLabelStyle}>Describe the area</p>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={ticketOtherArea}
                      onChange={(e) => setTicketOtherArea(e.target.value)}
                      placeholder="e.g. Back garden boundary wall"
                      style={{ flex: 1, height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                    />
                    <VoiceInputButton onResult={(text) => setTicketOtherArea(prev => prev ? `${prev} ${text}` : text)} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: Main Category */}
          {ticketStep2Complete && (
            <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: ticketCategory ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>3. Main Category</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {sortedCategoryEntries(maintenanceCategories).map(([key]) => {
                  const active = ticketCategory === key
                  return (
                    <button
                      key={key}
                      onClick={() => { setTicketCategory(key); setTicketIssueTag(null); setTicketIssueOther('') }}
                      style={choiceButtonStyle(active, 'center')}
                    >
                      {key}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Step 4: Issue Tag */}
          {ticketCategory && (
            <div style={{ background: SECTION_BG[1], padding: '20px', borderBottom: ticketStep4Complete ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>4. Standardized Diagnostic Issue Tag</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {(maintenanceCategories[ticketCategory]?.subCategories || []).map(sub => {
                  const tag = sub.label
                  const active = ticketIssueTag === tag
                  return (
                    <button
                      key={tag}
                      onClick={() => { setTicketIssueTag(tag); setTicketIssueOther(''); setTicketDuplicateWarning(null) }}
                      style={choiceButtonStyle(active, 'left')}
                    >
                      {tag}
                    </button>
                  )
                })}
                {(() => {
                  const marker = unlistedTagFor(ticketCategory)
                  const active = ticketIssueTag === marker
                  return (
                    <button
                      onClick={() => { setTicketIssueTag(marker); setTicketDuplicateWarning(null) }}
                      style={{
                        ...choiceButtonStyle(active, 'left'),
                        border: active ? `2px solid ${COLORS.teal700}` : `1px dashed ${COLORS.slate300}`,
                        color: active ? COLORS.white : COLORS.slate500,
                      }}
                    >
                      {unlistedLabelFor(ticketCategory)}
                    </button>
                  )
                })()}
              </div>

              {isUnlistedTag(ticketIssueTag) && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' }}>
                  <input
                    type="text"
                    value={ticketIssueOther}
                    onChange={(e) => setTicketIssueOther(e.target.value)}
                    placeholder={`Describe the unlisted ${ticketCategory} issue (defaults to a baseline ${maintenanceCategories[ticketCategory]?.weight ?? 15}-point score)`}
                    style={{ flex: 1, height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box' }}
                  />
                  <VoiceInputButton onResult={(text) => setTicketIssueOther(prev => prev ? `${prev} ${text}` : text)} />
                </div>
              )}

              {ticketIssueTag && (() => {
                const baseScore = calculatePriorityScore(maintenanceCategories, ticketCategory, ticketIssueTag)
                const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                const total = baseScore + vulnBonus
                const isP1 = total >= p1Threshold
                return (
                  <div style={{ marginTop: '12px', padding: '14px', borderRadius: '10px', background: COLORS.white, border: `1px solid ${COLORS.slate200}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '8px', borderBottom: `1px solid ${COLORS.slate200}` }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.slate900 }}>Real-time Priority Engine</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.white, background: isP1 ? COLORS.red600 : COLORS.slate600, padding: '4px 10px', borderRadius: '6px' }}>{total} Points</span>
                    </div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: isP1 ? COLORS.red600 : COLORS.slate600, textTransform: 'uppercase' }}>
                      {isP1 ? '⚠ P1 Critical — will trigger emergency escalation' : 'Routine severity tier'}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: COLORS.slate500, marginBottom: '4px' }}>
                      <span>{isUnlistedTag(ticketIssueTag) ? 'Unlisted issue fallback baseline' : 'Diagnostic baseline score'}</span>
                      <strong style={{ color: COLORS.slate900, fontFamily: 'monospace', fontWeight: 600 }}>{baseScore} pts</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: COLORS.slate500 }}>
                      <span>Property vulnerability adjustment</span>
                      <strong style={{ color: COLORS.slate900, fontFamily: 'monospace', fontWeight: 600 }}>+{vulnBonus} pts</strong>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Step 5: Assignment & Details (admin-only) */}
          {ticketStep4Complete && (
            <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>5. Assignment &amp; Details</p>

              <p style={fieldLabelStyle}>Assign to builder</p>
              <select
                value={assignedBuilderId}
                onChange={(e) => setAssignedBuilderId(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '10px' }}
              >
                <option value="">Auto-assign based on skills</option>
                {builders.map(b => (
                  <option key={b.id} value={b.id} style={b.availability !== 'Available' ? { color: COLORS.slate400 } : undefined}>{builderOptionLabel(b)}</option>
                ))}
              </select>
              {assignedBuilderId && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 14px 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, cursor: 'pointer' }}>
                    <input type="checkbox" checked={sendPushOnAssign} onChange={(e) => setSendPushOnAssign(e.target.checked)} />
                    Also send a push notification
                  </label>

                  {/* Manager-only -- never shown to or fetched by the
                      builder. Used to compare against actual time worked
                      (Clocking page) later, e.g. a 15-minute job that
                      quietly took an hour. */}
                  <p style={fieldLabelStyle}>Estimated time (minutes, required)</p>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value)}
                    placeholder="e.g. 30"
                    style={{ ...fieldSelectStyle, marginBottom: '14px' }}
                  />
                </>
              )}

              <p style={fieldLabelStyle}>Priority override</p>
              <select
                value={priorityOverride}
                onChange={(e) => setPriorityOverride(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '14px' }}
              >
                <option value="">Use calculated priority</option>
                <option value="P1 Critical">P1 Critical</option>
                <option value="P2 Urgent">P2 Urgent</option>
                <option value="P3 Routine">P3 Routine</option>
              </select>

              <p style={fieldLabelStyle}>Department</p>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '14px' }}
              >
                <option value="">Select a department...</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              {EVENTS_FEATURE_ENABLED && (
                <>
                  <p style={fieldLabelStyle}>Event (optional)</p>
                  <select
                    value={selectedEventId}
                    onChange={(e) => setSelectedEventId(e.target.value)}
                    style={fieldSelectStyle}
                  >
                    <option value="">None</option>
                    {openEvents.map(ev => (
                      <option key={ev.id} value={ev.id}>{ev.title}</option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}

          {/* Step 6: Photo + Submit */}
          {ticketStep4Complete && (
            <div style={{ background: SECTION_BG[1], padding: '20px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>6. Photo &amp; Submit</p>

              <input
                type="file"
                accept="image/*"
                id="admin-ticket-photo-input"
                onChange={handleTicketPhoto}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => document.getElementById('admin-ticket-photo-input').click()}
                style={{ width: '100%', height: '44px', borderRadius: '10px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
              >
                Add a photo
              </button>

              {ticketPhotoPreview && (
                <img src={ticketPhotoPreview} alt="Ticket attachment preview" style={{ width: '100%', maxWidth: '320px', marginTop: '10px', borderRadius: '10px', display: 'block' }} />
              )}

              <div style={{ marginTop: '16px' }}>
                <p style={fieldLabelStyle}>Raised by</p>
                <input
                  type="text"
                  value={profile.name}
                  disabled
                  style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', boxSizing: 'border-box', background: COLORS.slate100, color: COLORS.slate500 }}
                />
              </div>

              {ticketDuplicateWarning ? (
                <div style={{ marginTop: '16px', padding: '16px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700, color: COLORS.amber800 }}>⚠ Possible duplicate</p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 400, color: COLORS.amber900 }}>
                    There's already an open ticket at this property for {ticketDuplicateWarning.matchKind}: Job #{ticketDuplicateWarning.ticket.ticket_number} — {ticketDuplicateWarning.ticket.issue_tag} ({ticketDuplicateWarning.ticket.status}). Is this a duplicate, or a genuinely separate fault?
                  </p>
                  <button
                    onClick={() => setTicketDuplicateWarning(null)}
                    style={{ width: '100%', height: '44px', marginBottom: '8px', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', color: COLORS.slate900, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                  >
                    Cancel — it's a duplicate
                  </button>
                  <button
                    onClick={() => handleSubmitTicket(true)}
                    style={{ width: '100%', height: '44px', background: COLORS.amber600, border: 'none', borderRadius: '10px', color: COLORS.white, fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                  >
                    It's separate — log it anyway
                  </button>
                </div>
              ) : (
                <>
                  {ticketError && (
                    <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: COLORS.red500 }}>{ticketError}</p>
                  )}
                  {ticketSuccess && (
                    <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: COLORS.green600, fontWeight: 600 }}>{ticketSuccess}</p>
                  )}
                  <button
                    onClick={() => handleSubmitTicket(false)}
                    disabled={ticketSubmitting}
                    style={{
                      width: '100%',
                      height: '48px',
                      marginTop: '16px',
                      background: COLORS.blue900,
                      color: COLORS.white,
                      border: 'none',
                      borderRadius: '12px',
                      fontSize: '14px',
                      fontWeight: 600,
                      cursor: ticketSubmitting ? 'not-allowed' : 'pointer',
                      opacity: ticketSubmitting ? 0.6 : 1,
                      boxSizing: 'border-box',
                    }}
                  >
                    {ticketSubmitting ? 'Submitting...' : 'Submit Ticket'}
                  </button>
                </>
              )}
            </div>
          )}

        </div>
      )}

      {loggingMode === 'compliance' && (
        <div style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>

          {/* Step 1: Target Property */}
          <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>1. Target Property</p>
            <PropertySearchSelect
              properties={ticketProperties}
              value={ticketPropertyId}
              onChange={setTicketPropertyId}
            />
          </div>

          {/* Step 2: Select Check Type */}
          <div style={{ background: SECTION_BG[1], padding: '20px', borderBottom: complianceCheckType ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>2. Select Check Type</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {complianceCheckTypes.length === 0 && (
                <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', gridColumn: '1 / -1' }}>
                  No compliance check types configured yet -- add some on the Settings page.
                </p>
              )}
              {complianceCheckTypes.map(t => {
                const active = complianceCheckType === t.name
                return (
                  <button
                    key={t.id}
                    onClick={() => handleComplianceCheckType(t.name)}
                    style={choiceButtonStyle(active, 'center')}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Step 3: Walk through each item */}
          {complianceCheckType && (
            <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>3. Walk Through Each Item</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {(complianceCheckTypes.find(t => t.name === complianceCheckType)?.items || []).map((item, idx) => {
                  const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                  const effectiveScore = item.score + vulnBonus
                  const tier = priorityTierLabel(effectiveScore, p1Threshold, p2Threshold)
                  const tierColour = effectiveScore >= p1Threshold ? COLORS.red600 : effectiveScore >= p2Threshold ? COLORS.amber600 : COLORS.slate500
                  const result = complianceResults[idx]
                  return (
                    <div key={item.label} style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px', background: COLORS.white }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{item.label}</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: tierColour, flexShrink: 0 }}>{tier} if failed</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setComplianceItemResult(idx, 'Pass')}
                          style={{
                            flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box',
                            border: result === 'Pass' ? `1px solid ${COLORS.green600}` : `1px solid ${COLORS.slate200}`,
                            background: result === 'Pass' ? COLORS.green600 : COLORS.white,
                            color: result === 'Pass' ? COLORS.white : COLORS.slate500,
                          }}
                        >
                          Pass
                        </button>
                        <button
                          onClick={() => setComplianceItemResult(idx, 'Fail')}
                          style={{
                            flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box',
                            border: result === 'Fail' ? `1px solid ${COLORS.red600}` : `1px solid ${COLORS.slate200}`,
                            background: result === 'Fail' ? COLORS.red600 : COLORS.white,
                            color: result === 'Fail' ? COLORS.white : COLORS.slate500,
                          }}
                        >
                          Fail
                        </button>
                      </div>
                      {result === 'Fail' && (
                        <>
                          <input
                            type="text"
                            value={complianceNotes[idx] || ''}
                            onChange={(e) => setComplianceNotes(prev => prev.map((n, i) => i === idx ? e.target.value : n))}
                            placeholder="Describe what's wrong (used on the auto-created ticket)..."
                            style={{ width: '100%', marginTop: '8px', height: '40px', padding: '0 10px', borderRadius: '8px', border: `1px solid ${COLORS.amber300}`, fontSize: '13px', boxSizing: 'border-box' }}
                          />

                          <input
                            type="file"
                            accept="image/*,video/*"
                            id={`compliance-media-${idx}`}
                            onChange={(e) => handleComplianceMediaChange(idx, e)}
                            style={{ display: 'none' }}
                          />
                          {complianceMediaPreviews[idx] ? (
                            <div style={{ marginTop: '8px' }}>
                              {complianceMediaFiles[idx]?.type?.startsWith('video') ? (
                                <video src={complianceMediaPreviews[idx]} controls style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
                              ) : (
                                <img src={complianceMediaPreviews[idx]} alt="Issue evidence" style={{ width: '100%', borderRadius: '8px', display: 'block' }} />
                              )}
                              <button
                                onClick={() => removeComplianceMedia(idx)}
                                style={{ marginTop: '6px', padding: '6px 12px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                ✕ Remove media
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => document.getElementById(`compliance-media-${idx}`).click()}
                              style={{ width: '100%', marginTop: '8px', height: '40px', borderRadius: '8px', border: `2px dashed ${COLORS.slate300}`, background: COLORS.white, color: COLORS.slate500, fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                            >
                              📷 Add a photo or video (optional)
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              {(() => {
                const answered = complianceResults.filter(r => r !== null).length
                const total = complianceResults.length
                const failed = complianceResults.filter(r => r === 'Fail').length
                if (answered < total) {
                  return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate500, padding: '12px', background: COLORS.slate50, borderRadius: '10px' }}>{answered} / {total} items marked.</p>
                }
                if (failed === 0) {
                  return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 700, color: COLORS.green600, padding: '12px', background: COLORS.green50, borderRadius: '10px' }}>✓ All {total} items passed. No maintenance tickets will be created.</p>
                }
                return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 700, color: COLORS.amber800, padding: '12px', background: COLORS.amber50, borderRadius: '10px' }}>⚠ {failed} of {total} item(s) failed — {failed} ticket(s) will be created.</p>
              })()}
            </div>
          )}

          {/* Step 4: Assignment & Details (admin-only) */}
          {complianceCheckType && complianceResults.length > 0 && !complianceResults.some(r => r === null) && (
            <div style={{ background: SECTION_BG[1], padding: '20px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>4. Assignment, Details &amp; Submit</p>

              <p style={fieldLabelStyle}>Assign to builder</p>
              <select
                value={assignedBuilderId}
                onChange={(e) => setAssignedBuilderId(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '10px' }}
              >
                <option value="">Auto-assign based on skills</option>
                {builders.map(b => (
                  <option key={b.id} value={b.id} style={b.availability !== 'Available' ? { color: COLORS.slate400 } : undefined}>{builderOptionLabel(b)}</option>
                ))}
              </select>
              {assignedBuilderId && (
                <>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 14px 0', fontSize: '13px', fontWeight: 600, color: COLORS.slate900, cursor: 'pointer' }}>
                    <input type="checkbox" checked={sendPushOnAssign} onChange={(e) => setSendPushOnAssign(e.target.checked)} />
                    Also send a push notification
                  </label>

                  {/* Manager-only, applied to every ticket this compliance
                      batch creates -- never shown to or fetched by the builder. */}
                  <p style={fieldLabelStyle}>Estimated time per ticket (minutes, required)</p>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={estimatedMinutes}
                    onChange={(e) => setEstimatedMinutes(e.target.value)}
                    placeholder="e.g. 30"
                    style={{ ...fieldSelectStyle, marginBottom: '14px' }}
                  />
                </>
              )}

              <p style={fieldLabelStyle}>Priority override</p>
              <select
                value={priorityOverride}
                onChange={(e) => setPriorityOverride(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '14px' }}
              >
                <option value="">Use calculated priority</option>
                <option value="P1 Critical">P1 Critical</option>
                <option value="P2 Urgent">P2 Urgent</option>
                <option value="P3 Routine">P3 Routine</option>
              </select>

              <p style={fieldLabelStyle}>Department</p>
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '16px' }}
              >
                <option value="">Select a department...</option>
                {departments.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>

              {ticketError && (
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.red500 }}>{ticketError}</p>
              )}
              {complianceSuccess && (
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.green600, fontWeight: 600 }}>{complianceSuccess}</p>
              )}

              <button
                onClick={handleSubmitCompliance}
                disabled={complianceSubmitting}
                style={{
                  width: '100%',
                  height: '48px',
                  background: COLORS.slate900,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: complianceSubmitting ? 'not-allowed' : 'pointer',
                  opacity: complianceSubmitting ? 0.6 : 1,
                  boxSizing: 'border-box',
                }}
              >
                {complianceSubmitting ? 'Submitting...' : 'Submit Compliance Check'}
              </button>
            </div>
          )}

        </div>
      )}

    </div>
  )
}
