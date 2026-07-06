import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getCurrentPositionSafe } from '../lib/geo'
import { fetchComplianceCheckTypes } from '../lib/compliance'
import { fetchMaintenanceCategories } from '../lib/maintenanceCategories'
import gbchLogo from '../assets/gbch-logo.svg'

export default function BuilderDashboard({ profile }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState('jobs')
  const [fromLocation, setFromLocation] = useState(null)
  const [customLocation, setCustomLocation] = useState('')
  const [miles, setMiles] = useState(0)
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [showPauseReasons, setShowPauseReasons] = useState(false)
  const [pauseReason, setPauseReason] = useState(null)
  const [pauseNote, setPauseNote] = useState('')
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [completeNote, setCompleteNote] = useState('')
  const [completePhotoFile, setCompletePhotoFile] = useState(null)
  const [completePhotoPreview, setCompletePhotoPreview] = useState(null)
  const [completeSubmitting, setCompleteSubmitting] = useState(false)
  const [completeError, setCompleteError] = useState('')
  const [showNoAccessConfirm, setShowNoAccessConfirm] = useState(false)
  const [noAccessNote, setNoAccessNote] = useState('')
  const [noAccessPhotoFile, setNoAccessPhotoFile] = useState(null)
  const [noAccessPhotoPreview, setNoAccessPhotoPreview] = useState(null)
  const [noAccessSubmitting, setNoAccessSubmitting] = useState(false)
  const [noAccessError, setNoAccessError] = useState('')
  const [loggingMode, setLoggingMode] = useState('maintenance') // 'maintenance' | 'compliance'
  const [ticketProperties, setTicketProperties] = useState([])
  const [ticketPropertyId, setTicketPropertyId] = useState('')
  const [ticketRoom, setTicketRoom] = useState(null)
  const [ticketRoomContext, setTicketRoomContext] = useState(null)
  const [ticketRoomCode, setTicketRoomCode] = useState('')
  const [ticketOtherArea, setTicketOtherArea] = useState('')
  const [ticketCategory, setTicketCategory] = useState(null)
  const [ticketIssueTag, setTicketIssueTag] = useState(null)
  const [ticketIssueOther, setTicketIssueOther] = useState('')
  const [ticketPhotoFile, setTicketPhotoFile] = useState(null)
  const [ticketPhotoPreview, setTicketPhotoPreview] = useState(null)
  const [ticketDuplicateWarning, setTicketDuplicateWarning] = useState(null)
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [ticketError, setTicketError] = useState('')
  const [ticketSuccess, setTicketSuccess] = useState(false)
  const [maintenanceCategories, setMaintenanceCategories] = useState({})
  const [complianceCheckType, setComplianceCheckType] = useState(null)
  const [complianceCheckTypes, setComplianceCheckTypes] = useState([])
  const [complianceResults, setComplianceResults] = useState([])
  const [complianceNotes, setComplianceNotes] = useState([])
  const [complianceSubmitting, setComplianceSubmitting] = useState(false)
  const [complianceSuccess, setComplianceSuccess] = useState('')
  const [reportedTickets, setReportedTickets] = useState([])
  const [notifications, setNotifications] = useState([])
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)

  useEffect(() => {
    fetchTickets()
    fetchNotifications()
    // Polled rather than pushed -- notifications are created by an admin
    // action elsewhere, so this is the only way this session finds out
    // about a new one without the builder manually refreshing.
    const interval = setInterval(fetchNotifications, 45000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (page === 'new-ticket') {
      fetchTicketProperties()
      fetchComplianceCheckTypes().then(setComplianceCheckTypes)
      fetchMaintenanceCategories().then(setMaintenanceCategories)
      resetTicketForm()
    }
    if (page === 'my-reports') {
      fetchReportedTickets()
    }
  }, [page])

  useEffect(() => {
    setFromLocation(null)
    setCustomLocation('')
    setMiles(0)
    setShowPauseReasons(false)
    setPauseReason(null)
    setPauseNote('')
    setShowCompleteConfirm(false)
    setCompleteNote('')
    setCompletePhotoFile(null)
    setCompletePhotoPreview(null)
    setCompleteError('')
    setShowNoAccessConfirm(false)
    setNoAccessNote('')
    setNoAccessPhotoFile(null)
    setNoAccessPhotoPreview(null)
    setNoAccessError('')
  }, [selectedTicket?.id])

  useEffect(() => {
    if (selectedTicket) fetchComments()
  }, [selectedTicket?.id])

  useEffect(() => {
    if (!selectedTicket || selectedTicket.status !== 'In Progress') {
      setElapsed(0)
      return
    }

    let interval

    async function startTimer() {
      const { data, error } = await supabase
        .schema('pmms')
        .from('work_sessions')
        .select('started_at')
        .eq('ticket_id', selectedTicket.id)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)

      if (error || !data || data.length === 0) return

      const startedAt = new Date(data[0].started_at)
      const initialElapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000)
      setElapsed(initialElapsed)

      interval = setInterval(() => {
        setElapsed(prev => prev + 1)
      }, 1000)
    }

    startTimer()

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [selectedTicket?.id, selectedTicket?.status])

  async function fetchComments() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('comments')
      .select('id, body, author_name, role, created_at')
      .eq('ticket_id', selectedTicket.id)
      .order('created_at', { ascending: true })

    if (!error) setComments(data)
  }

  async function handlePostComment() {
    if (!commentText) return

    setCommentError('')

    const { error } = await supabase
      .schema('pmms')
      .from('comments')
      .insert({
        ticket_id: selectedTicket.id,
        author_name: profile.name,
        role: profile.role,
        body: commentText,
        author_id: profile.id,
      })

    if (error) {
      console.error('Failed to post comment:', error)
      setCommentError(error.message)
      return
    }

    const preview = commentText.length > 80 ? commentText.slice(0, 80) + '…' : commentText
    await postAuditEvent(selectedTicket.id, 'Status Changed', `Comment added: "${preview}"`)

    setCommentText('')
    await fetchComments()
  }

  async function fetchTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, status, category, description, room, priority_score, mileage_logged, transit_start, created_at, completed_at, hold_reason, hold_note, photo_url,
        property:properties(address, safeguards, electrical_shutoff, gas_shutoff, high_vulnerability)
      `)
      .eq('assigned_builder_id', profile.id)
      .not('status', 'in', '("Archived","Cancelled")')
      .order('priority_score', { ascending: false })

    if (!error) setTickets(data)
    setLoading(false)
  }

  async function fetchNotifications() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('notifications')
      .select('id, ticket_id, message, read, created_at')
      .eq('staff_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (!error) setNotifications(data)
  }

  async function markNotificationRead(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    await supabase
      .schema('pmms')
      .from('notifications')
      .update({ read: true })
      .eq('id', id)
  }

  async function postAuditEvent(ticketId, action, summary) {
    await supabase
      .schema('pmms')
      .from('audit_events')
      .insert({
        ticket_id: ticketId,
        actor_id: profile.id,
        actor_name: profile.name,
        action,
        summary,
      })
  }

  async function handleClockIn(transitStart, milesLogged) {
    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'In Progress', mileage_logged: milesLogged, transit_start: transitStart })
      .eq('id', selectedTicket.id)

    if (ticketError) {
      console.error('Failed to update ticket on clock-in:', ticketError)
      return
    }

    const { error: sessionError } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .insert({
        ticket_id: selectedTicket.id, builder_id: profile.id, started_at: now,
        clock_in_lat: position?.latitude ?? null, clock_in_lng: position?.longitude ?? null,
      })

    if (sessionError) {
      console.error('Failed to start work session:', sessionError)
    }

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → In Progress (clocked in)`)

    await fetchTickets()
    setSelectedTicket(prev => ({ ...prev, status: 'In Progress' }))
  }

  async function handleComplete(note, photoFile) {
    setCompleteError('')

    if (!note || !note.trim()) {
      setCompleteError('Please add a note describing the completed work.')
      return
    }

    setCompleteSubmitting(true)

    let photoUrl = null
    if (photoFile) {
      const path = `${profile.id}/${Date.now()}-${photoFile.name}`
      const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, photoFile)
      if (uploadError) {
        setCompleteSubmitting(false)
        setCompleteError(`Photo upload failed: ${uploadError.message}`)
        return
      }
      photoUrl = supabase.storage.from('ticket-photos').getPublicUrl(path).data.publicUrl
    }

    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Completed', completed_at: now, completion_note: note.trim(), completion_photo_url: photoUrl })
      .eq('id', selectedTicket.id)

    await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: now, clock_out_lat: position?.latitude ?? null, clock_out_lng: position?.longitude ?? null })
      .eq('ticket_id', selectedTicket.id)
      .is('ended_at', null)

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → Completed — ${note.trim()}`)

    setCompleteSubmitting(false)
    await fetchTickets()
    setSelectedTicket(null)
  }

  async function handlePause(reason, note) {
    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'On Hold', hold_reason: reason, hold_note: note })
      .eq('id', selectedTicket.id)

    await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: now, clock_out_lat: position?.latitude ?? null, clock_out_lng: position?.longitude ?? null })
      .eq('ticket_id', selectedTicket.id)
      .is('ended_at', null)

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → On Hold (${reason}${note ? ' — ' + note : ''})`)

    await fetchTickets()
    setSelectedTicket(null)
  }

  async function handleResumeWork() {
    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'In Progress', hold_reason: null, hold_note: null })
      .eq('id', selectedTicket.id)

    if (ticketError) {
      console.error('Failed to resume ticket:', ticketError)
      return
    }

    const { error: sessionError } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .insert({
        ticket_id: selectedTicket.id, builder_id: profile.id, started_at: now,
        clock_in_lat: position?.latitude ?? null, clock_in_lng: position?.longitude ?? null,
      })

    if (sessionError) {
      console.error('Failed to start work session:', sessionError)
    }

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → In Progress (resumed)`)

    await fetchTickets()
    setSelectedTicket(prev => ({ ...prev, status: 'In Progress', hold_reason: null, hold_note: null }))
  }

  async function handleNoAccess(note, photoFile) {
    setNoAccessError('')

    if (!note || !note.trim()) {
      setNoAccessError('Please add a note explaining why access could not be gained.')
      return
    }

    setNoAccessSubmitting(true)

    let photoUrl = null
    if (photoFile) {
      const path = `${profile.id}/${Date.now()}-${photoFile.name}`
      const { error: uploadError } = await supabase.storage.from('ticket-photos').upload(path, photoFile)
      if (uploadError) {
        setNoAccessSubmitting(false)
        setNoAccessError(`Photo upload failed: ${uploadError.message}`)
        return
      }
      photoUrl = supabase.storage.from('ticket-photos').getPublicUrl(path).data.publicUrl
    }

    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Assigned', no_access_flag: true, no_access_note: note.trim(), no_access_photo_url: photoUrl })
      .eq('id', selectedTicket.id)

    await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: now, clock_out_lat: position?.latitude ?? null, clock_out_lng: position?.longitude ?? null })
      .eq('ticket_id', selectedTicket.id)
      .is('ended_at', null)

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → Assigned (couldn't get access to property — ${note.trim()})`)

    setNoAccessSubmitting(false)
    await fetchTickets()
    setSelectedTicket(null)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  function goHome() {
    setSelectedTicket(null)
    setPage('jobs')
    setMenuOpen(false)
  }

  const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Other Area...']

  const UNLISTED_MARKER_PREFIX = '__UNLISTED_FALLBACK__'
  const GLOBAL_TRIAGE_THRESHOLD = 70 // score >= this = P1 Critical
  const P2_URGENT_THRESHOLD = 40     // score >= this (but < P1) = P2 Urgent -- used for compliance item tiers

  const isUnlistedTag = (tag) => typeof tag === 'string' && tag.startsWith(UNLISTED_MARKER_PREFIX)
  const unlistedTagFor = (category) => `${UNLISTED_MARKER_PREFIX}${category}`
  const unlistedLabelFor = (category) => category === 'Other / Unlisted Trade' ? 'Something Else Entirely (Describe Below)' : `Other Unlisted ${category} Issue`

  // Reads from the same maintenance_categories data the Admin Settings page
  // manages -- a sub-category's own score, falling back to its parent
  // category's weight.
  const calculatePriorityScore = (category, issueTag) => {
    const cat = maintenanceCategories[category]
    if (!cat) return 15
    if (issueTag && !isUnlistedTag(issueTag)) {
      const sub = cat.subCategories.find(s => s.label === issueTag)
      if (sub) return Number(sub.score)
    }
    return Number(cat.weight) ?? 15
  }

  const priorityTierLabel = (score) => {
    if (score >= GLOBAL_TRIAGE_THRESHOLD) return 'P1 Critical'
    if (score >= P2_URGENT_THRESHOLD) return 'P2 Urgent'
    return 'Routine'
  }

  const selectedTicketProperty = ticketProperties.find(p => String(p.id) === String(ticketPropertyId))

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
    setTicketSuccess(false)
    setComplianceCheckType(null)
    setComplianceResults([])
    setComplianceNotes([])
    setComplianceSubmitting(false)
    setComplianceSuccess('')
  }

  async function fetchTicketProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address, high_vulnerability, layout_type')
      .order('address')

    if (!error) setTicketProperties(data)
  }

  async function fetchReportedTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, status, category, description, room, photo_url, created_at,
        property:properties(address)
      `)
      .eq('raised_by', profile.id)
      .order('created_at', { ascending: false })

    if (!error) setReportedTickets(data)
  }

  function handleTicketPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setTicketPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setTicketPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function handleCompletePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setCompletePhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setCompletePhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function handleNoAccessPhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return

    setNoAccessPhotoFile(file)
    const reader = new FileReader()
    reader.onload = () => setNoAccessPhotoPreview(reader.result)
    reader.readAsDataURL(file)
  }

  function ticketRoomString() {
    if (ticketRoom === 'Other Area...') return ticketOtherArea
    if (ticketRoom === 'Bedroom' && ticketRoomCode.trim()) return `${ticketRoom} (${ticketRoomContext}) - ${ticketRoomCode.trim()}`
    return `${ticketRoom} (${ticketRoomContext})`
  }

  async function handleSubmitTicket(skipDuplicateCheck) {
    setTicketError('')

    const finalIssueTag = isUnlistedTag(ticketIssueTag) ? `[Unlisted: ${ticketCategory}] ${ticketIssueOther}` : ticketIssueTag
    const priorityScore = calculatePriorityScore(ticketCategory, ticketIssueTag) + (selectedTicketProperty?.high_vulnerability ? 30 : 0)
    const roomString = ticketRoomString()

    if (!skipDuplicateCheck) {
      const { data: openTickets } = await supabase
        .schema('pmms')
        .from('tickets')
        .select('id, category, issue_tag, room, status')
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

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .insert({
        property_id: ticketPropertyId || null,
        room: roomString,
        category: ticketCategory,
        issue_tag: finalIssueTag,
        description: finalIssueTag,
        priority_score: priorityScore,
        status: 'Pending',
        raised_by: profile.id,
        raised_by_name: profile.name,
        photo_url: photoUrl,
        created_at: new Date().toISOString(),
      })

    setTicketSubmitting(false)

    if (error) {
      setTicketError(error.message)
      return
    }

    setTicketSuccess(true)
    setTimeout(() => {
      resetTicketForm()
      setPage('jobs')
    }, 2000)
  }

  function handleComplianceCheckType(checkType) {
    setComplianceCheckType(checkType)
    const items = complianceCheckTypes.find(t => t.name === checkType)?.items || []
    setComplianceResults(items.map(() => null))
    setComplianceNotes(items.map(() => ''))
  }

  function setComplianceItemResult(idx, result) {
    setComplianceResults(prev => prev.map((r, i) => i === idx ? result : r))
  }

  async function handleSubmitCompliance() {
    if (!complianceCheckType || complianceResults.length === 0 || complianceResults.some(r => r === null)) return

    setComplianceSubmitting(true)
    setTicketError('')

    const selectedType = complianceCheckTypes.find(t => t.name === complianceCheckType)
    const items = selectedType?.items || []
    const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
    const failedItems = items
      .map((item, idx) => ({ ...item, result: complianceResults[idx], note: complianceNotes[idx] }))
      .filter(i => i.result === 'Fail')

    for (const failedItem of failedItems) {
      const category = selectedType?.category || 'Other / Unlisted Trade'
      const score = failedItem.score + vulnBonus
      const description = `[Compliance Failure: ${complianceCheckType}] ${failedItem.label}${failedItem.note ? ' — ' + failedItem.note : ''}`

      const { error } = await supabase
        .schema('pmms')
        .from('tickets')
        .insert({
          property_id: ticketPropertyId || null,
          room: 'Whole Property (Compliance Walkround)',
          category,
          issue_tag: failedItem.label,
          description,
          priority_score: score,
          status: 'Pending',
          raised_by: profile.id,
          raised_by_name: profile.name,
          created_at: new Date().toISOString(),
        })

      if (error) {
        setComplianceSubmitting(false)
        setTicketError(error.message)
        return
      }
    }

    setComplianceSubmitting(false)
    setComplianceSuccess(failedItems.length === 0
      ? 'All items passed — no maintenance tickets were created.'
      : `${failedItems.length} item(s) failed — ${failedItems.length} maintenance ticket(s) created.`)
    setTimeout(() => {
      resetTicketForm()
      setPage('jobs')
    }, 2000)
  }

  const statusColour = (status) => {
    if (status === 'In Progress') return '#0d9488'
    if (status === 'On Hold')     return '#d97706'
    if (status === 'Completed')   return '#16a34a'
    return '#3b82f6'
  }

  const inProgressTickets = tickets.filter(t => t.status === 'In Progress')
  const urgentTickets = tickets.filter(t => t.status === 'Assigned' && t.priority_score >= 70)
  const toDoTickets = tickets.filter(t => t.status === 'Assigned' && t.priority_score < 70)
  const onHoldTickets = tickets.filter(t => t.status === 'On Hold')
  const doneTickets = tickets.filter(t => t.status === 'Completed')

  const filteredTickets =
    statusFilter === 'WORKING' ? inProgressTickets :
    statusFilter === 'URGENT' ? urgentTickets :
    statusFilter === 'TODO'   ? toDoTickets :
    statusFilter === 'HOLD'   ? onHoldTickets :
    statusFilter === 'DONE'   ? doneTickets :
    tickets

  const mileageTickets = tickets
    .filter(t => t.mileage_logged > 0)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const totalMiles = mileageTickets.reduce((sum, t) => sum + t.mileage_logged, 0)

  const thisMonth = new Date()
  const monthMiles = mileageTickets
    .filter(t => {
      const d = new Date(t.created_at)
      return d.getMonth() === thisMonth.getMonth() && d.getFullYear() === thisMonth.getFullYear()
    })
    .reduce((sum, t) => sum + t.mileage_logged, 0)

  const formatElapsed = (seconds) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return `${h}h ${m}m ${s}s`
    if (m > 0) return `${m}m ${s}s`
    return `${s}s`
  }

  const formatUKDate = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  }

  const formatUKDateTime = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${formatUKDate(isoString)} ${hh}:${min}`
  }

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  const getMonday = (d) => {
    const date = new Date(d)
    const day = date.getDay()
    const diff = (day === 0 ? -6 : 1) - day
    date.setDate(date.getDate() + diff)
    date.setHours(0, 0, 0, 0)
    return date
  }

  const today = new Date()
  const weekStart = getMonday(today)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)

  const completedTodayCount = doneTickets.filter(t => t.completed_at && isSameDay(new Date(t.completed_at), today)).length
  const completedWeekCount = doneTickets.filter(t => {
    if (!t.completed_at) return false
    const d = new Date(t.completed_at)
    return d >= weekStart && d < weekEnd
  }).length
  const completedMonthCount = doneTickets.filter(t => {
    if (!t.completed_at) return false
    const d = new Date(t.completed_at)
    return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  }).length

  const totalAssignedCount = tickets.filter(t => t.status === 'Assigned').length

  const recentlyCompleted = [...doneTickets]
    .sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
    .slice(0, 10)

  const ticketStep2Complete = ticketRoom === 'Other Area...'
    ? !!ticketOtherArea.trim()
    : !!(ticketRoom && ticketRoomContext)

  const ticketStep4Complete = !!ticketIssueTag && (!isUnlistedTag(ticketIssueTag) || !!ticketIssueOther.trim())

  if (loading) return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <p style={{ color: '#94a3b8', fontWeight: 600, fontFamily: 'system-ui' }}>Loading your jobs...</p>
    </div>
  )

  return (
    <div style={{ minHeight: '100%', background: '#f1f5f9', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={goHome}
            aria-label="Go to home"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
            <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>PMMS</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => setNotifPanelOpen(prev => !prev)}
              aria-label="Notifications"
              style={{ position: 'relative', background: 'none', border: 'none', padding: '8px', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}
            >
              🔔
              {notifications.some(n => !n.read) && (
                <span style={{
                  position: 'absolute', top: '4px', right: '4px', minWidth: '16px', height: '16px', padding: '0 3px',
                  borderRadius: '999px', background: '#dc2626', color: '#fff', fontSize: '10px', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {notifications.filter(n => !n.read).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setMenuOpen(prev => !prev)}
              aria-label="Menu"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
            >
              <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
            </button>
          </div>
        </div>

        {notifPanelOpen && (
          <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', maxHeight: '320px', overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <p style={{ margin: 0, padding: '20px', fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', textAlign: 'center' }}>No notifications yet.</p>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markNotificationRead(n.id)
                    const t = tickets.find(t => t.id === n.ticket_id)
                    if (t) setSelectedTicket(t)
                    setNotifPanelOpen(false)
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 20px', border: 'none', borderBottom: '1px solid #f1f5f9',
                    background: n.read ? '#fff' : '#eff6ff', cursor: 'pointer',
                  }}
                >
                  <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: n.read ? 500 : 700, color: '#0f172a' }}>{n.message}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>{new Date(n.created_at).toLocaleString('en-GB')}</p>
                </button>
              ))
            )}
          </div>
        )}

        {menuOpen && (
          <div style={{ background: '#19562e', padding: '20px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
            <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <button
                onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
              >
                📝 Raise new ticket
              </button>
              <button
                onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
              >
                📋 My Reports
              </button>
              <button
                onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
              >
                🕐 My Mileage
              </button>
              <button
                onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
              >
                📊 My Metrics
              </button>
              <button
                onClick={handleSignOut}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
              >
                🚪 Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metric tiles */}
      <div style={{ padding: '16px 16px 0 16px', maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => setStatusFilter('WORKING')}
          style={{ width: '100%', padding: '14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{inProgressTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Working On Now</div>
        </button>
        <button
          onClick={() => setStatusFilter('URGENT')}
          style={{ width: '100%', padding: '14px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{urgentTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Urgent</div>
        </button>
        <button
          onClick={() => setStatusFilter('TODO')}
          style={{ width: '100%', padding: '14px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{toDoTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To do</div>
        </button>
        <button
          onClick={() => setStatusFilter('HOLD')}
          style={{ width: '100%', padding: '14px', background: '#f59e0b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{onHoldTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>On hold</div>
        </button>
        <button
          onClick={() => setStatusFilter('DONE')}
          style={{ width: '100%', padding: '14px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{doneTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Done</div>
        </button>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', fontSize: '14px', fontWeight: 700, color: '#0f172a', boxSizing: 'border-box', cursor: 'pointer' }}
        >
          <option value="ALL">All jobs</option>
          <option value="WORKING">🔧 Working now</option>
          <option value="URGENT">🚨 Urgent</option>
          <option value="TODO">📋 To do</option>
          <option value="HOLD">⏸ On hold</option>
          <option value="DONE">✓ Done</option>
        </select>
      </div>

      {/* Job list */}
      <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
        {filteredTickets.length === 0 && (
          <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontWeight: 600 }}>No jobs assigned to you.</p>
          </div>
        )}
        {filteredTickets.map(t => (
          <div key={t.id} style={{ background: '#ffffff', borderRadius: '16px', marginBottom: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ height: '4px', background: statusColour(t.status) }} />
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.id} · {t.category}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{t.status}</span>
              </div>
              <p style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</p>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b' }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
              <button onClick={() => setSelectedTicket(t)} style={{ width: '100%', padding: '12px', background: statusColour(t.status), color: '#fff', border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
  View job
</button>

            </div>
          </div>
        ))}
      </div>
      {/* Job detail modal */}
{selectedTicket && (
  <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

    {/* Header */}
    <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={() => setSelectedTicket(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
          ← Back
        </button>
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Menu"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
        >
          <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
        </button>
      </div>

      {menuOpen && (
        <div style={{ background: '#19562e', padding: '20px' }}>
          <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
          <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <button
              onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              📝 Raise new ticket
            </button>
            <button
              onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              📋 My Reports
            </button>
            <button
              onClick={() => { setPage('mileage'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              🕐 My Mileage
            </button>
            <button
              onClick={() => { setPage('metrics'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              📊 My Metrics
            </button>
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
            >
              🚪 Sign out
            </button>
          </div>
        </div>
      )}
    </div>

    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

      {/* Property */}
      <div style={{ background: '#fff', borderRadius: '16px', overflow: 'hidden', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ height: '4px', background: statusColour(selectedTicket.status) }} />
        <div style={{ padding: '20px' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{selectedTicket.category}</p>
          <p style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>{selectedTicket.property?.address}</p>
          {selectedTicket.property?.high_vulnerability && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', marginBottom: '8px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#dc2626' }}>⚠ Vulnerable Occupant — handle with care</p>
            </div>
          )}
          {selectedTicket.priority_score >= GLOBAL_TRIAGE_THRESHOLD && (
            <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '10px', padding: '10px 14px', marginBottom: '8px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: '#92400e' }}>🔴 Urgent Priority</p>
            </div>
          )}
          <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{selectedTicket.description}{selectedTicket.room ? ` — ${selectedTicket.room}` : ''}</p>
        </div>
      </div>

      {/* Access & Safety */}
      {(selectedTicket.property?.safeguards || selectedTicket.property?.electrical_shutoff || selectedTicket.property?.gas_shutoff) && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔑 Access & Safety</p>
          {selectedTicket.property?.safeguards && <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#374151' }}>{selectedTicket.property.safeguards}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedTicket.property?.electrical_shutoff && (
              <div style={{ background: '#fffbeb', borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: '#d97706' }}>⚡ Electric shutoff</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{selectedTicket.property.electrical_shutoff}</p>
              </div>
            )}
            {selectedTicket.property?.gas_shutoff && (
              <div style={{ background: '#fffbeb', borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: '#d97706' }}>🔥 Gas shutoff</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{selectedTicket.property.gas_shutoff}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Photo */}
      {selectedTicket.photo_url && (
        <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Photo</p>
          <img src={selectedTicket.photo_url} alt="Ticket attachment" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
        </div>
      )}

      {/* Clock running banner */}
      {selectedTicket.status === 'In Progress' && (
        <div style={{ background: '#0d9488', borderRadius: '16px', padding: '18px 20px', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#ffffff', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#ffffff', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clock running</span>
          </div>
          <span style={{ fontSize: '24px', fontWeight: 800, color: '#ffffff', fontFamily: 'monospace' }}>{formatElapsed(elapsed)}</span>
        </div>
      )}

      {/* Actions */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Actions</p>
        {selectedTicket.status === 'Assigned' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Coming from</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                  { key: 'Home', icon: '🏠' },
                  { key: 'Office / depot', icon: '🏢' },
                  { key: 'Somewhere else', icon: '✏️' },
                ].map(option => {
                  const active = fromLocation === option.key
                  return (
                    <button
                      key={option.key}
                      onClick={() => setFromLocation(option.key)}
                      style={{
                        width: '100%',
                        padding: '12px',
                        borderRadius: '10px',
                        border: active ? '2px solid #0d9488' : '1px solid #e2e8f0',
                        background: active ? '#0d948814' : '#f8fafc',
                        color: '#0f172a',
                        fontSize: '14px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      {option.icon} {option.key}
                    </button>
                  )
                })}
              </div>
              {fromLocation === 'Somewhere else' && (
                <input
                  type="text"
                  value={customLocation}
                  onChange={(e) => setCustomLocation(e.target.value)}
                  placeholder="Type location..."
                  style={{ width: '100%', marginTop: '8px', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '14px', boxSizing: 'border-box' }}
                />
              )}
            </div>

            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Miles driven to get here</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
                <button
                  onClick={() => setMiles(m => Math.max(0, m - 0.5))}
                  style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#64748b', color: '#fff', border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  −
                </button>
                <input
                  type="number"
                  step="0.5"
                  value={miles}
                  onChange={(e) => setMiles(parseFloat(e.target.value) || 0)}
                  style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '10px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '16px', fontWeight: 700, boxSizing: 'border-box' }}
                />
                <button
                  onClick={() => setMiles(m => m + 0.5)}
                  style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#64748b', color: '#fff', border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  +
                </button>
              </div>
            </div>

            <button
              onClick={() => handleClockIn(fromLocation === 'Somewhere else' ? customLocation : fromLocation, miles)}
              style={{ width: '100%', padding: '16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}
            >
              ✓ I've arrived — start work
            </button>
          </div>
        )}
        {selectedTicket.status === 'In Progress' && !showPauseReasons && !showCompleteConfirm && !showNoAccessConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <button onClick={() => setShowCompleteConfirm(true)} style={{ width: '100%', padding: '16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}>
              ✓ Mark complete
            </button>
            <button onClick={() => setShowPauseReasons(true)} style={{ width: '100%', padding: '14px', background: '#fffbeb', color: '#92400e', border: '2px solid #fcd34d', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
              ⏸ Pause / put on hold
            </button>
            <button onClick={() => setShowNoAccessConfirm(true)} style={{ width: '100%', padding: '14px', background: '#f8fafc', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
              🚪 Couldn't get access
            </button>
          </div>
        )}
        {selectedTicket.status === 'In Progress' && showCompleteConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>Confirm job complete</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Add a note on the work done, and a photo if you have one</p>
            </div>

            <textarea
              value={completeNote}
              onChange={(e) => setCompleteNote(e.target.value)}
              placeholder="Describe the work completed..."
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />

            <input type="file" accept="image/*" capture="environment" id="complete-photo-input" onChange={handleCompletePhoto} style={{ display: 'none' }} />
            <button
              onClick={() => document.getElementById('complete-photo-input').click()}
              style={{ width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
            >
              {completePhotoFile ? 'Change photo' : 'Add a photo (optional)'}
            </button>
            {completePhotoPreview && (
              <img src={completePhotoPreview} alt="Completed job preview" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
            )}

            {completeError && (
              <p style={{ margin: 0, fontSize: '13px', color: '#ef4444' }}>{completeError}</p>
            )}

            <button
              onClick={() => handleComplete(completeNote, completePhotoFile)}
              disabled={completeSubmitting}
              style={{ width: '100%', padding: '16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: completeSubmitting ? 'not-allowed' : 'pointer', opacity: completeSubmitting ? 0.6 : 1 }}
            >
              {completeSubmitting ? 'Submitting...' : '✓ Confirm complete'}
            </button>
            <button
              onClick={() => setShowCompleteConfirm(false)}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#64748b', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}
        {selectedTicket.status === 'In Progress' && showNoAccessConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>Confirm couldn't get access</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Add a note explaining what happened, and a photo if you have one</p>
            </div>

            <textarea
              value={noAccessNote}
              onChange={(e) => setNoAccessNote(e.target.value)}
              placeholder="e.g. No answer at the door after 3 attempts..."
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />

            <input type="file" accept="image/*" capture="environment" id="no-access-photo-input" onChange={handleNoAccessPhoto} style={{ display: 'none' }} />
            <button
              onClick={() => document.getElementById('no-access-photo-input').click()}
              style={{ width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
            >
              {noAccessPhotoFile ? 'Change photo' : 'Add a photo (optional)'}
            </button>
            {noAccessPhotoPreview && (
              <img src={noAccessPhotoPreview} alt="No access preview" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
            )}

            {noAccessError && (
              <p style={{ margin: 0, fontSize: '13px', color: '#ef4444' }}>{noAccessError}</p>
            )}

            <button
              onClick={() => handleNoAccess(noAccessNote, noAccessPhotoFile)}
              disabled={noAccessSubmitting}
              style={{ width: '100%', padding: '16px', background: '#64748b', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: noAccessSubmitting ? 'not-allowed' : 'pointer', opacity: noAccessSubmitting ? 0.6 : 1 }}
            >
              {noAccessSubmitting ? 'Submitting...' : "🚪 Confirm couldn't get access"}
            </button>
            <button
              onClick={() => setShowNoAccessConfirm(false)}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#64748b', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}
        {selectedTicket.status === 'In Progress' && showPauseReasons && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>Why are you pausing?</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>This is shown to the office</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                'Waiting for parts or materials',
                'Need access to property',
                'Waiting for another contractor',
                'Resident not available',
                'Need office approval',
                'Other',
              ].map(reason => {
                const active = pauseReason === reason
                return (
                  <button
                    key={reason}
                    onClick={() => setPauseReason(reason)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      borderRadius: '10px',
                      border: active ? '2px solid #d97706' : '1px solid #e2e8f0',
                      background: active ? '#d9770614' : '#f8fafc',
                      color: '#0f172a',
                      fontSize: '14px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {reason}
                  </button>
                )
              })}
            </div>

            <textarea
              value={pauseNote}
              onChange={(e) => setPauseNote(e.target.value)}
              placeholder="Add a note (optional)"
              rows={3}
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical' }}
            />

            <button
              onClick={() => handlePause(pauseReason, pauseNote)}
              style={{ width: '100%', padding: '16px', background: '#d97706', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}
            >
              Confirm pause
            </button>
            <button
              onClick={() => setShowPauseReasons(false)}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: '#64748b', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}
        {selectedTicket.status === 'On Hold' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(selectedTicket.hold_reason || selectedTicket.hold_note) && (
              <div style={{ padding: '14px', borderRadius: '10px', background: '#fffbeb', border: '1px solid #fcd34d' }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why this job is paused</p>
                <p style={{ margin: 0, fontSize: '14px', color: '#78350f' }}>
                  {selectedTicket.hold_reason}{selectedTicket.hold_note ? ` — ${selectedTicket.hold_note}` : ''}
                </p>
              </div>
            )}
            <button
              onClick={handleResumeWork}
              style={{ width: '100%', padding: '16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer' }}
            >
              ✓ Back on site — restart work
            </button>
          </div>
        )}
      </div>

      {/* Comments */}
      <div style={{ background: '#fff', borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {comments.length === 0 && (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>{c.author_name}</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.role}</span>
                <span style={{ fontSize: '11px', color: '#94a3b8', marginLeft: 'auto' }}>{formatUKDateTime(c.created_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: '#374151' }}>{c.body}</p>
            </div>
          ))}
        </div>

        <textarea
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
          style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', marginBottom: '10px' }}
        />
        {commentError && (
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: '#ef4444' }}>{commentError}</p>
        )}
        <button
          onClick={handlePostComment}
          style={{ width: '100%', padding: '14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
        >
          Post comment
        </button>
      </div>

    </div>
  </div>
)}

      {/* My Mileage page */}
      {page === 'mileage' && (
        <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: '#19562e', padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📝 Raise new ticket
                  </button>
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🚪 Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>

            {/* Title */}
            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>My Mileage</h1>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{profile.name}</p>
            </div>

            {/* Summary tiles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total miles</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#3b82f6' }}>{totalMiles}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This month</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#64748b' }}>{monthMiles}</p>
              </div>
            </div>

            {/* Trip list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {mileageTickets.length === 0 && (
                <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <p style={{ color: '#94a3b8', fontWeight: 600 }}>No trips logged yet.</p>
                </div>
              )}
              {mileageTickets.map(t => (
                <div key={t.id} style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</p>
                    <p style={{ margin: '0 0 2px 0', fontSize: '13px', color: '#64748b' }}>{t.transit_start}</p>
                    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.id}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#3b82f6', flexShrink: 0 }}>{t.mileage_logged}</p>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* My Metrics page */}
      {page === 'metrics' && (
        <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: '#19562e', padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📝 Raise new ticket
                  </button>
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🚪 Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>

            {/* Title */}
            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>My Metrics</h1>
              <p style={{ margin: 0, fontSize: '14px', color: '#64748b' }}>{profile.name}</p>
            </div>

            {/* Jobs completed */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Jobs completed</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#16a34a' }}>{completedTodayCount}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This week</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#16a34a' }}>{completedWeekCount}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>This month</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#16a34a' }}>{completedMonthCount}</p>
              </div>
            </div>

            {/* Overall snapshot */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall snapshot</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total completed</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#16a34a' }}>{doneTickets.length}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total assigned</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#64748b' }}>{totalAssignedCount}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>In progress now</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#0d9488' }}>{inProgressTickets.length}</p>
              </div>
              <div style={{ width: '100%', background: '#fff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>On hold</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: '#d97706' }}>{onHoldTickets.length}</p>
              </div>
            </div>

            {/* Recently completed */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recently completed</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentlyCompleted.length === 0 && (
                <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <p style={{ color: '#94a3b8', fontWeight: 600 }}>No completed jobs yet.</p>
                </div>
              )}
              {recentlyCompleted.map(t => (
                <div key={t.id} style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</p>
                  <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: '#64748b' }}>{t.description}</p>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completed {formatUKDate(t.completed_at)}</p>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* Raise New Ticket page */}
      {page === 'new-ticket' && (
        <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: '#19562e', padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📝 Raise new ticket
                  </button>
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🚪 Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

            <button
              onClick={() => setPage('jobs')}
              style={{ background: 'none', border: 'none', padding: 0, marginBottom: '16px', color: '#64748b', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              ← Cancel
            </button>

            <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>Log a Ticket</h1>
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
                  <select
                    value={ticketPropertyId}
                    onChange={(e) => {
                      setTicketPropertyId(e.target.value)
                      setTicketRoom(null); setTicketRoomContext(null); setTicketRoomCode(''); setTicketOtherArea('')
                      setTicketCategory(null); setTicketIssueTag(null); setTicketIssueOther(''); setTicketDuplicateWarning(null)
                    }}
                    style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 500, boxSizing: 'border-box', background: '#ffffff' }}
                  >
                    <option value="">Select a property...</option>
                    {ticketProperties.map(p => (
                      <option key={p.id} value={p.id}>{p.address}{p.high_vulnerability ? ' ⚠️ [HIGH VULNERABILITY]' : ''}</option>
                    ))}
                  </select>
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

                    {ticketRoom && ticketRoom !== 'Other Area...' && (
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
                        <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Room number (optional)
                        </p>
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
                        <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Describe the area
                        </p>
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
                      {Object.keys(maintenanceCategories).map(key => {
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
                      const baseScore = calculatePriorityScore(ticketCategory, ticketIssueTag)
                      const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                      const total = baseScore + vulnBonus
                      const isP1 = total >= GLOBAL_TRIAGE_THRESHOLD
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

                {/* Step 5: Photo + Submit */}
                {ticketStep4Complete && (
                  <div style={{ background: SECTION_BG[0], padding: '20px' }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>5. Photo &amp; Submit</p>

                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      id="ticket-photo-input"
                      onChange={handleTicketPhoto}
                      style={{ display: 'none' }}
                    />
                    <button
                      onClick={() => document.getElementById('ticket-photo-input').click()}
                      style={{ width: '100%', height: '44px', borderRadius: '10px', border: '2px dashed #cbd5e1', background: '#ffffff', color: '#64748b', fontSize: '13px', fontWeight: 600, cursor: 'pointer', boxSizing: 'border-box' }}
                    >
                      Add a photo
                    </button>

                    {ticketPhotoPreview && (
                      <img src={ticketPhotoPreview} alt="Ticket attachment preview" style={{ width: '100%', marginTop: '10px', borderRadius: '10px', display: 'block' }} />
                    )}

                    <div style={{ marginTop: '16px' }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reported by</p>
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
                          There's already an open ticket at this property for {ticketDuplicateWarning.matchKind}: Job #{ticketDuplicateWarning.ticket.id} — {ticketDuplicateWarning.ticket.issue_tag} ({ticketDuplicateWarning.ticket.status}). Is this a duplicate, or a genuinely separate fault?
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
                          <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>✓ Ticket submitted successfully</p>
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
                  <select
                    value={ticketPropertyId}
                    onChange={(e) => setTicketPropertyId(e.target.value)}
                    style={{ width: '100%', height: '44px', padding: '0 12px', borderRadius: '10px', border: '1px solid #e2e8f0', fontSize: '13px', fontWeight: 500, boxSizing: 'border-box', background: '#ffffff' }}
                  >
                    <option value="">Select a property...</option>
                    {ticketProperties.map(p => (
                      <option key={p.id} value={p.id}>{p.address}{p.high_vulnerability ? ' ⚠️ [HIGH VULNERABILITY]' : ''}</option>
                    ))}
                  </select>
                </div>

                {/* Step 2: Select Check Type */}
                <div style={{ background: SECTION_BG[1], padding: '20px', borderBottom: complianceCheckType ? '1px solid rgba(15,23,42,0.06)' : 'none' }}>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>2. Select Check Type</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    {complianceCheckTypes.length === 0 && (
                      <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic', gridColumn: '1 / -1' }}>
                        No compliance check types configured yet -- ask your admin to add some.
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
                  <div style={{ background: SECTION_BG[0], padding: '20px' }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>3. Walk Through Each Item</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
                      {(complianceCheckTypes.find(t => t.name === complianceCheckType)?.items || []).map((item, idx) => {
                        const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
                        const effectiveScore = item.score + vulnBonus
                        const tier = priorityTierLabel(effectiveScore)
                        const tierColour = effectiveScore >= GLOBAL_TRIAGE_THRESHOLD ? '#dc2626' : effectiveScore >= P2_URGENT_THRESHOLD ? '#d97706' : '#64748b'
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
                              <input
                                type="text"
                                value={complianceNotes[idx] || ''}
                                onChange={(e) => setComplianceNotes(prev => prev.map((n, i) => i === idx ? e.target.value : n))}
                                placeholder="Describe what's wrong (used on the auto-created ticket)..."
                                style={{ width: '100%', marginTop: '8px', height: '40px', padding: '0 10px', borderRadius: '8px', border: '1px solid #fcd34d', fontSize: '13px', boxSizing: 'border-box' }}
                              />
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

                    {ticketError && (
                      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#ef4444' }}>{ticketError}</p>
                    )}
                    {complianceSuccess && (
                      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: '#16a34a', fontWeight: 600 }}>✓ {complianceSuccess}</p>
                    )}

                    <button
                      onClick={handleSubmitCompliance}
                      disabled={complianceSubmitting || complianceResults.length === 0 || complianceResults.some(r => r === null)}
                      style={{
                        width: '100%',
                        height: '48px',
                        background: '#0f172a',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: (complianceSubmitting || complianceResults.some(r => r === null)) ? 'not-allowed' : 'pointer',
                        opacity: (complianceSubmitting || complianceResults.some(r => r === null)) ? 0.6 : 1,
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
        </div>
      )}

      {/* My Reports page */}
      {page === 'my-reports' && (
        <div style={{ position: 'fixed', inset: 0, background: '#f1f5f9', zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: '#0f172a' }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: '#0f172a', borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: '#19562e', padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: '#ffffff' }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: '#ffffff', opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button
                    onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📝 Raise new ticket
                  </button>
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: '#ffffff', cursor: 'pointer', textAlign: 'left' }}
                  >
                    🚪 Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>My Reports</h1>
              <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>Tickets you've personally raised, regardless of who they're assigned to.</p>
            </div>

            {reportedTickets.length === 0 && (
              <div style={{ background: '#fff', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                <p style={{ color: '#94a3b8', fontWeight: 600 }}>You haven't raised any tickets yet.</p>
              </div>
            )}

            {reportedTickets.map(t => (
              <div key={t.id} style={{ background: '#ffffff', borderRadius: '16px', marginBottom: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ height: '4px', background: statusColour(t.status) }} />
                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.id} · {t.category}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{t.status}</span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{t.property?.address}</p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: '#64748b' }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                  {t.photo_url && (
                    <img src={t.photo_url} alt="Ticket attachment" style={{ width: '100%', borderRadius: '10px', display: 'block' }} />
                  )}
                </div>
              </div>
            ))}

          </div>
        </div>
      )}

    </div>
  )
}
