import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchAssignableStaffForCategory, builderOptionLabel, createNotification, sendPushNotification, pushEmergencyAlert, priorityTierLabel, fetchPriorityThresholds, EVENTS_FEATURE_ENABLED } from './shared'
import { fetchComplianceCheckTypes } from '../../lib/compliance'
import { fetchMaintenanceCategories, sortedCategoryEntries } from '../../lib/maintenanceCategories'
import { fetchDivisions } from '../../lib/divisions'
import PropertySearchSelect from '../../components/PropertySearchSelect'

const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Garden', 'Other Area...']

const UNLISTED_MARKER_PREFIX = '__UNLISTED_FALLBACK__'

const isUnlistedTag = (tag) => typeof tag === 'string' && tag.startsWith(UNLISTED_MARKER_PREFIX)
const unlistedTagFor = (category) => `${UNLISTED_MARKER_PREFIX}${category}`
const unlistedLabelFor = (category) => category === 'Other / Unlisted Trade' ? 'Something Else Entirely (Describe Below)' : `Other Unlisted ${category} Issue`

// Reads from the same maintenance_categories data the Admin Settings page
// manages -- a sub-category's own score, falling back to its parent
// category's weight (covers both the "unlisted issue" case and any
// category/sub-category combination that's missing a score for some reason).
const calculatePriorityScore = (maintenanceCategories, category, issueTag) => {
  const cat = maintenanceCategories[category]
  if (!cat) return 15
  if (issueTag && !isUnlistedTag(issueTag)) {
    const sub = cat.subCategories.find(s => s.label === issueTag)
    if (sub) return Number(sub.score)
  }
  return Number(cat.weight) ?? 15
}

function floorContextOptions(property) {
  if (!property) return ['Ground Floor', 'First Floor']
  if (property.layout_type === 'Flat') return ['Main Flat Space', 'En-Suite Area']
  if (property.layout_type === '3-Floors') return ['Ground Floor', 'First Floor', 'Second Floor']
  return ['Ground Floor', 'First Floor']
}

function floorContextLabel(property) {
  return property?.layout_type === 'Flat' ? 'Which part of the flat?' : 'Which floor?'
}

function choiceButtonStyle(active, align = 'left') {
  return {
    width: '100%',
    height: '44px',
    padding: '0 14px',
    borderRadius: '10px',
    border: active ? '2px solid #0f766e' : '1px solid #e2e8f0',
    background: active ? '#0f766e' : '#ffffff',
    color: active ? '#ffffff' : '#0f172a',
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

const SECTION_BG = ['#ffffff', '#f8fafc']

const fieldSelectStyle = { width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 500, boxSizing: 'border-box', background: '#ffffff' }
const fieldLabelStyle = { margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }

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
    if (ticketRoom === 'Bedroom' && ticketRoomCode.trim()) return `${ticketRoom} (${ticketRoomContext}) - ${ticketRoomCode.trim()}`
    return `${ticketRoom} (${ticketRoomContext})`
  }

  async function handleSubmitTicket(skipDuplicateCheck) {
    setTicketError('')

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
      const path = `${profile.id}/${Date.now()}-${ticketPhotoFile.name}`
      const { error: uploadError } = await supabase.storage
        .from('ticket-photos')
        .upload(path, ticketPhotoFile)

      if (uploadError) {
        setTicketSubmitting(false)
        setTicketError(`Photo upload failed: ${uploadError.message}`)
        return
      }

      photoUrl = supabase.storage.from('ticket-photos').getPublicUrl(path).data.publicUrl
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
        const path = `${profile.id}/${Date.now()}-${failedItem.mediaFile.name}`
        const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, failedItem.mediaFile)
        if (uploadError) {
          setComplianceSubmitting(false)
          setTicketError(`Media upload failed: ${uploadError.message}`)
          return
        }
        photoUrl = supabase.storage.from('ticket-photos').getPublicUrl(path).data.publicUrl
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

  const ticketStep2Complete = ticketRoom === 'Other Area...'
    ? !!ticketOtherArea.trim()
    : ticketRoom === 'Garden'
    ? true
    : !!(ticketRoom && ticketRoomContext)

  const ticketStep4Complete = !!ticketIssueTag && (!isUnlistedTag(ticketIssueTag) || !!ticketIssueOther.trim())

  return (
    <div style={{ maxWidth: '720px' }}>

      <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Raise Ticket</h1>
      <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 400, color: '#64748b' }}>Calculates priority instantly based on the property and issue you select.</p>

      {/* Mode toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button
          onClick={() => setLoggingMode('maintenance')}
          style={{
            flex: 1, height: '44px', borderRadius: '10px', boxSizing: 'border-box',
            border: loggingMode === 'maintenance' ? '2px solid #0f766e' : '1px solid #e2e8f0',
            background: loggingMode === 'maintenance' ? '#0f766e' : '#ffffff',
            color: loggingMode === 'maintenance' ? '#ffffff' : '#0f172a',
            fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          Maintenance Issue
        </button>
        <button
          onClick={() => setLoggingMode('compliance')}
          style={{
            flex: 1, height: '44px', borderRadius: '10px', boxSizing: 'border-box',
            border: loggingMode === 'compliance' ? '2px solid #0f766e' : '1px solid #e2e8f0',
            background: loggingMode === 'compliance' ? '#0f766e' : '#ffffff',
            color: loggingMode === 'compliance' ? '#ffffff' : '#0f172a',
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
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>1. Target Property</p>
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
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>2. Room / Area</p>
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
                        setTicketRoomContext(selectedTicketProperty?.layout_type === 'Flat' ? opts[0] : null)
                      }}
                      style={choiceButtonStyle(active, 'center')}
                    >
                      {room}
                    </button>
                  )
                })}
              </div>

              {ticketRoom && ticketRoom !== 'Other Area...' && ticketRoom !== 'Garden' && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #e2e8f0' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
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
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #e2e8f0' }}>
                  <p style={fieldLabelStyle}>Room number (optional)</p>
                  <input
                    type="text"
                    value={ticketRoomCode}
                    onChange={(e) => setTicketRoomCode(e.target.value)}
                    placeholder="e.g. Room 12C"
                    style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              {ticketRoom === 'Other Area...' && (
                <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px dashed #e2e8f0' }}>
                  <p style={fieldLabelStyle}>Describe the area</p>
                  <input
                    type="text"
                    value={ticketOtherArea}
                    onChange={(e) => setTicketOtherArea(e.target.value)}
                    placeholder="e.g. Back garden boundary wall"
                    style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Step 3: Main Category */}
          {ticketStep2Complete && (
            <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: ticketCategory ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>3. Main Category</p>
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
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>4. Standardized Diagnostic Issue Tag</p>
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
                        border: active ? '2px solid #0f766e' : '1px dashed #cbd5e1',
                        color: active ? '#ffffff' : '#64748b',
                      }}
                    >
                      {unlistedLabelFor(ticketCategory)}
                    </button>
                  )
                })()}
              </div>

              {isUnlistedTag(ticketIssueTag) && (
                <input
                  type="text"
                  value={ticketIssueOther}
                  onChange={(e) => setTicketIssueOther(e.target.value)}
                  placeholder={`Describe the unlisted ${ticketCategory} issue (defaults to a baseline ${maintenanceCategories[ticketCategory]?.weight ?? 15}-point score)`}
                  style={{ width: '100%', marginTop: '10px', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box' }}
                />
              )}

              {ticketIssueTag && (() => {
                const baseScore = calculatePriorityScore(maintenanceCategories, ticketCategory, ticketIssueTag)
                const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                const total = baseScore + vulnBonus
                const isP1 = total >= p1Threshold
                return (
                  <div style={{ marginTop: '12px', padding: '14px', borderRadius: '10px', background: '#ffffff', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #e2e8f0' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a' }}>Real-time Priority Engine</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: '#fff', background: isP1 ? '#dc2626' : '#475569', padding: '4px 10px', borderRadius: '6px' }}>{total} Points</span>
                    </div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: isP1 ? '#dc2626' : '#475569', textTransform: 'uppercase' }}>
                      {isP1 ? '⚠ P1 Critical — will trigger emergency escalation' : 'Routine severity tier'}
                    </p>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>
                      <span>{isUnlistedTag(ticketIssueTag) ? 'Unlisted issue fallback baseline' : 'Diagnostic baseline score'}</span>
                      <strong style={{ color: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}>{baseScore} pts</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#64748b' }}>
                      <span>Property vulnerability adjustment</span>
                      <strong style={{ color: '#0f172a', fontFamily: 'monospace', fontWeight: 600 }}>+{vulnBonus} pts</strong>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Step 5: Assignment & Details (admin-only) */}
          {ticketStep4Complete && (
            <div style={{ background: SECTION_BG[0], padding: '20px', borderBottom: '1px solid rgba(15,23,42,0.06)' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>5. Assignment &amp; Details</p>

              <p style={fieldLabelStyle}>Assign to builder</p>
              <select
                value={assignedBuilderId}
                onChange={(e) => setAssignedBuilderId(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '10px' }}
              >
                <option value="">Auto-assign based on skills</option>
                {builders.map(b => (
                  <option key={b.id} value={b.id} style={b.availability !== 'Available' ? { color: '#94a3b8' } : undefined}>{builderOptionLabel(b)}</option>
                ))}
              </select>
              {assignedBuilderId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 14px 0', fontSize: '13px', fontWeight: 600, color: '#0f172a', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendPushOnAssign} onChange={(e) => setSendPushOnAssign(e.target.checked)} />
                  Also send a push notification
                </label>
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
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>6. Photo &amp; Submit</p>

              <input
                type="file"
                accept="image/*"
                id="admin-ticket-photo-input"
                onChange={handleTicketPhoto}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => document.getElementById('admin-ticket-photo-input').click()}
                style={{ width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
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
                  style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', boxSizing: 'border-box', background: '#f1f5f9', color: '#64748b' }}
                />
              </div>

              {ticketDuplicateWarning ? (
                <div style={{ marginTop: '16px', padding: '16px', borderRadius: '10px', background: '#fffbeb', border: '1px solid #fcd34d' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '13px', fontWeight: 700, color: '#92400e' }}>⚠ Possible duplicate</p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 400, color: '#78350f' }}>
                    There's already an open ticket at this property for {ticketDuplicateWarning.matchKind}: Job #{ticketDuplicateWarning.ticket.ticket_number} — {ticketDuplicateWarning.ticket.issue_tag} ({ticketDuplicateWarning.ticket.status}). Is this a duplicate, or a genuinely separate fault?
                  </p>
                  <button
                    onClick={() => setTicketDuplicateWarning(null)}
                    style={{ width: '100%', height: '44px', marginBottom: '8px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', color: '#0f172a', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                  >
                    Cancel — it's a duplicate
                  </button>
                  <button
                    onClick={() => handleSubmitTicket(true)}
                    style={{ width: '100%', height: '44px', background: '#d97706', border: 'none', borderRadius: '10px', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                  >
                    It's separate — log it anyway
                  </button>
                </div>
              ) : (
                <>
                  {ticketError && (
                    <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: '#ef4444' }}>{ticketError}</p>
                  )}
                  {ticketSuccess && (
                    <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{ticketSuccess}</p>
                  )}
                  <button
                    onClick={() => handleSubmitTicket(false)}
                    disabled={ticketSubmitting}
                    style={{
                      width: '100%',
                      height: '48px',
                      marginTop: '16px',
                      background: '#1e3a8a',
                      color: '#fff',
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
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>1. Target Property</p>
            <PropertySearchSelect
              properties={ticketProperties}
              value={ticketPropertyId}
              onChange={setTicketPropertyId}
            />
          </div>

          {/* Step 2: Select Check Type */}
          <div style={{ background: SECTION_BG[1], padding: '20px', borderBottom: complianceCheckType ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
            <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>2. Select Check Type</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {complianceCheckTypes.length === 0 && (
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', gridColumn: '1 / -1' }}>
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
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>3. Walk Through Each Item</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                {(complianceCheckTypes.find(t => t.name === complianceCheckType)?.items || []).map((item, idx) => {
                  const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                  const effectiveScore = item.score + vulnBonus
                  const tier = priorityTierLabel(effectiveScore, p1Threshold, p2Threshold)
                  const tierColour = effectiveScore >= p1Threshold ? '#dc2626' : effectiveScore >= p2Threshold ? '#d97706' : '#64748b'
                  const result = complianceResults[idx]
                  return (
                    <div key={item.label} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', background: '#ffffff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{item.label}</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: tierColour, flexShrink: 0 }}>{tier} if failed</span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => setComplianceItemResult(idx, 'Pass')}
                          style={{
                            flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box',
                            border: result === 'Pass' ? '1px solid #16a34a' : '1px solid #e2e8f0',
                            background: result === 'Pass' ? '#16a34a' : '#fff',
                            color: result === 'Pass' ? '#fff' : '#64748b',
                          }}
                        >
                          Pass
                        </button>
                        <button
                          onClick={() => setComplianceItemResult(idx, 'Fail')}
                          style={{
                            flex: 1, height: '40px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box',
                            border: result === 'Fail' ? '1px solid #dc2626' : '1px solid #e2e8f0',
                            background: result === 'Fail' ? '#dc2626' : '#fff',
                            color: result === 'Fail' ? '#fff' : '#64748b',
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
                            style={{ width: '100%', marginTop: '8px', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #fcd34d', fontSize: '13px', boxSizing: 'border-box' }}
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
                                style={{ marginTop: '6px', padding: '6px 12px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                              >
                                ✕ Remove media
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => document.getElementById(`compliance-media-${idx}`).click()}
                              style={{ width: '100%', marginTop: '8px', height: '40px', borderRadius: '8px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '12px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
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
                  return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 600, color: '#64748b', padding: '12px', background: '#f8fafc', borderRadius: '10px' }}>{answered} / {total} items marked.</p>
                }
                if (failed === 0) {
                  return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 700, color: '#16a34a', padding: '12px', background: '#f0fdf4', borderRadius: '10px' }}>✓ All {total} items passed. No maintenance tickets will be created.</p>
                }
                return <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 700, color: '#92400e', padding: '12px', background: '#fffbeb', borderRadius: '10px' }}>⚠ {failed} of {total} item(s) failed — {failed} ticket(s) will be created.</p>
              })()}
            </div>
          )}

          {/* Step 4: Assignment & Details (admin-only) */}
          {complianceCheckType && complianceResults.length > 0 && !complianceResults.some(r => r === null) && (
            <div style={{ background: SECTION_BG[1], padding: '20px' }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>4. Assignment, Details &amp; Submit</p>

              <p style={fieldLabelStyle}>Assign to builder</p>
              <select
                value={assignedBuilderId}
                onChange={(e) => setAssignedBuilderId(e.target.value)}
                style={{ ...fieldSelectStyle, marginBottom: '10px' }}
              >
                <option value="">Auto-assign based on skills</option>
                {builders.map(b => (
                  <option key={b.id} value={b.id} style={b.availability !== 'Available' ? { color: '#94a3b8' } : undefined}>{builderOptionLabel(b)}</option>
                ))}
              </select>
              {assignedBuilderId && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '0 0 14px 0', fontSize: '13px', fontWeight: 600, color: '#0f172a', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendPushOnAssign} onChange={(e) => setSendPushOnAssign(e.target.checked)} />
                  Also send a push notification
                </label>
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
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#ef4444' }}>{ticketError}</p>
              )}
              {complianceSuccess && (
                <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>{complianceSuccess}</p>
              )}

              <button
                onClick={handleSubmitCompliance}
                disabled={complianceSubmitting}
                style={{
                  width: '100%',
                  height: '48px',
                  background: '#0f172a',
                  color: '#fff',
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
