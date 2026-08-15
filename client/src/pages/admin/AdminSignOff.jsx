import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { COLORS } from '../../lib/colors'
import { attachProperties } from '../../lib/properties'
import PropertySearchSelect from '../../components/PropertySearchSelect'
import TicketAttachmentGallery from '../../components/TicketAttachmentGallery'
import {
  formatDuration, formatDurationDays, formatUKDateTime, postSystemComment, postAuditEvent, filterSelectStyle,
  thStyle, tdStyle, statusColour, KpiTiles,
  modalOverlayStyle, modalCardStyle, modalTitleStyle, modalSubtitleStyle, modalLabelStyle,
  modalTextareaStyle, modalErrorStyle, modalCancelBtnStyle, modalConfirmBtnStyle,
} from './shared'

// Admins never raise tickets, so "your pending sign-offs" is always empty
// for them -- expected, not a bug (see MySignOffs below). What they need
// instead is an oversight view across every submitter's tickets, to see how
// long staff are taking to sign off their own completed work once a KPI
// threshold gets defined later.
//
// Managers can raise tickets themselves, so they keep the raiser-only
// actionable list -- but they also get the oversight table above it, since
// they're just as much "the person who wants to know if their team is
// slow to sign off" as an admin is. RLS (manager_division_scoped_access)
// already narrows SignOffOversight's query to the manager's own division
// with no extra filtering needed here -- an unscoped manager (division
// null) sees everything, same as Pipeline/Reports/etc already behave.
export default function AdminSignOff({ profile, onTicketsChanged, onNavigate }) {
  const mySignOffsRef = useRef(null)

  if (profile.role === 'admin') {
    return <SignOffOversight onNavigate={onNavigate} />
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <SignOffOversight
        onNavigate={onNavigate}
        profile={profile}
        onJumpToMine={() => mySignOffsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      />
      <div ref={mySignOffsRef}>
        <MySignOffs profile={profile} onTicketsChanged={onTicketsChanged} />
      </div>
    </div>
  )
}

function MySignOffs({ profile, onTicketsChanged }) {
  const [tickets, setTickets] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [workedMsByTicket, setWorkedMsByTicket] = useState({})

  const [propertyFilter, setPropertyFilter] = useState('')
  const [ticketNumberFilter, setTicketNumberFilter] = useState('')

  const [reopenModalTicket, setReopenModalTicket] = useState(null)
  const [reopenReason, setReopenReason] = useState('')
  const [reopenError, setReopenError] = useState('')
  const [archiveErrors, setArchiveErrors] = useState({})

  const [archiveConfirmTicket, setArchiveConfirmTicket] = useState(null)
  const [archiveConfirming, setArchiveConfirming] = useState(false)

  useEffect(() => {
    fetchPending()
    fetchProperties()
  }, [])

  async function fetchProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address')
      .order('address')

    if (!error) setProperties(data)
  }

  async function fetchPending() {
    // Directors' rule: only the person who raised a ticket can sign it off
    // -- enforced for real by RLS (see scripts/add_raiser_only_signoff.sql,
    // the archive write itself is rejected otherwise), scoped here too so
    // this page only ever shows tickets you could actually act on, not
    // every admin/manager's completed work as unactionable clutter.
    const { data: ticketsData, error: ticketsError } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, ticket_number, category, description, room, issue_tag, completion_note, completion_photo_url, photo_url, needs_followup, followup_note, assigned_builder_id, property_id, raised_by, raised_by_name, checklist_responses
      `)
      .eq('status', 'Completed')
      .eq('raised_by', profile.id)
      .order('completed_at', { ascending: false })

    const { data: staffData, error: staffError } = await supabase
      .from('staff')
      .select('id, name')

    if (!ticketsError && !staffError) {
      const withProperties = await attachProperties(ticketsData, 'address')
      const merged = withProperties.map(t => ({
        ...t,
        builderName: staffData.find(s => s.id === t.assigned_builder_id)?.name,
      }))
      setTickets(merged)
      await fetchWorkedTimes(merged.map(t => t.id))
    }
    setLoading(false)
    onTicketsChanged?.()
  }

  async function fetchWorkedTimes(ticketIds) {
    if (ticketIds.length === 0) { setWorkedMsByTicket({}); return }

    const { data, error } = await supabase
      .schema('pmms')
      .from('work_sessions')
      .select('ticket_id, started_at, ended_at')
      .in('ticket_id', ticketIds)
      .not('ended_at', 'is', null)

    if (error) return

    const map = {}
    data.forEach(s => {
      const ms = new Date(s.ended_at) - new Date(s.started_at)
      map[s.ticket_id] = (map[s.ticket_id] || 0) + ms
    })
    setWorkedMsByTicket(map)
  }

  function openArchiveConfirm(ticket) {
    setArchiveConfirmTicket(ticket)
  }

  function closeArchiveConfirm() {
    setArchiveConfirmTicket(null)
  }

  async function confirmArchive() {
    const ticket = archiveConfirmTicket
    setArchiveConfirming(true)
    await verifyAndArchive(ticket)
    setArchiveConfirming(false)
    setArchiveConfirmTicket(null)
  }

  async function verifyAndArchive(ticket) {
    setArchiveErrors(prev => ({ ...prev, [ticket.id]: '' }))

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Archived', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null })
      .eq('id', ticket.id)

    if (error) {
      setArchiveErrors(prev => ({ ...prev, [ticket.id]: error.message }))
      return
    }

    const now = new Date()
    const stamp = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    await postSystemComment(ticket.id, profile, `Verified and archived by ${profile.name} on ${stamp}.`)
    await postAuditEvent(ticket.id, profile, 'Status Changed', `Completed → Archived (verified by ${profile.name})`)
    await fetchPending()
  }

  function openReopenModal(ticket) { setReopenModalTicket(ticket); setReopenReason(''); setReopenError('') }
  function closeReopenModal() { setReopenModalTicket(null) }

  async function submitReopen() {
    if (!reopenReason.trim()) { setReopenError('Please enter a reason.'); return }

    const t = reopenModalTicket

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null })
      .eq('id', t.id)

    if (error) { setReopenError(error.message); return }

    await postSystemComment(t.id, profile, `Reopened. Reason: ${reopenReason.trim()}`)
    await postAuditEvent(t.id, profile, 'Status Changed', `Completed → Assigned (reopened). Reason: ${reopenReason.trim()}`)
    await fetchPending()
    closeReopenModal()
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading pending sign-offs...</p>
    </div>
  )

  const filteredTickets = tickets.filter(t => {
    // property_id off the ticket is a number -- compare as strings so "3"
    // matches 3. Empty propertyFilter means "All Properties" (no filter).
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (ticketNumberFilter.trim() && !String(t.id).includes(ticketNumberFilter.trim())) return false
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: COLORS.purple100, color: COLORS.purple600, fontSize: '16px' }}>✓</span>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Pending Sign-Off ({filteredTickets.length} ticket{filteredTickets.length === 1 ? '' : 's'})</h1>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Tickets you raised, completed and awaiting your verification before archiving.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style={{ width: '220px' }}>
          <PropertySearchSelect properties={properties} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
        </div>
        <input
          type="text"
          value={ticketNumberFilter}
          onChange={(e) => setTicketNumberFilter(e.target.value)}
          placeholder="Search ticket #..."
          style={{ ...filterSelectStyle, cursor: 'text', width: '160px' }}
        />
        {(propertyFilter || ticketNumberFilter) && (
          <button
            onClick={() => { setPropertyFilter(''); setTicketNumberFilter('') }}
            style={{ ...filterSelectStyle, background: COLORS.white }}
          >
            Clear filters
          </button>
        )}
      </div>

      {filteredTickets.length === 0 ? (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate400, fontStyle: 'italic' }}>
            {tickets.length === 0 ? 'All clear — no completed repairs awaiting verification.' : 'No completed repairs match these filters.'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredTickets.map(t => (
            <div key={t.id} style={{ border: `1px solid ${COLORS.purple200}`, background: COLORS.purple50, borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ marginBottom: '10px' }}>
                <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{t.ticket_number}</span>
                <span style={{ display: 'block', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</span>
                <span style={{ display: 'block', fontSize: '13px', color: COLORS.slate600 }}>{t.room ? `${t.room} — ` : ''}{t.issue_tag || t.category}</span>
                <span style={{ display: 'block', fontSize: '13px', color: COLORS.purple700, fontWeight: 600, marginTop: '2px' }}>Completed by {t.builderName || 'Unknown'}</span>
                {workedMsByTicket[t.id] != null && (
                  <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', fontWeight: 700, color: COLORS.teal600, background: COLORS.teal50, padding: '2px 8px', borderRadius: '20px' }}>
                    ⏱ {formatDuration(workedMsByTicket[t.id])} worked
                  </span>
                )}
              </div>

              {/* Before / After comparison -- the whole point of this page is
                  deciding whether the completed work is good enough to
                  archive, so the reported issue and the completion evidence
                  need to sit side by side, not just whichever photo happened
                  to exist. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div style={{ background: COLORS.white, border: `1px solid ${COLORS.purple200}`, borderRadius: '10px', padding: '10px' }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Before — reported issue</p>
                  <div style={{ marginBottom: '6px' }}>
                    <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.photo_url} mediaHeight="140px" emptyLabel="No photo" />
                  </div>
                  <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600 }}>{t.description || t.issue_tag || 'No description recorded.'}</p>
                </div>

                <div style={{ background: COLORS.white, border: `1px solid ${COLORS.purple200}`, borderRadius: '10px', padding: '10px' }}>
                  <p style={{ margin: '0 0 6px 0', fontSize: '10px', fontWeight: 800, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>After — completed work</p>
                  <div style={{ marginBottom: '6px' }}>
                    <TicketAttachmentGallery ticketId={t.id} fallbackUrl={t.completion_photo_url} mediaHeight="140px" emptyLabel="No photo" stage="completed" />
                  </div>
                  {t.checklist_responses?.length > 0 && (
                    <div style={{ marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {t.checklist_responses.map((item, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '12px', color: item.checked ? COLORS.green600 : COLORS.red600 }}>
                          <span>{item.checked ? '✓' : '✕'}</span>
                          <span style={{ color: COLORS.gray700 }}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate600 }}>{t.completion_note || 'No completion note recorded.'}</p>
                  {t.needs_followup && (
                    <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: `${COLORS.violet500}14`, border: `1px solid ${COLORS.violet500}` }}>
                      <p style={{ margin: 0, fontSize: '11.5px', fontWeight: 700, color: COLORS.violet600 }}>⚑ Needs a follow-up</p>
                      {t.followup_note && <p style={{ margin: '2px 0 0 0', fontSize: '12.5px', color: COLORS.violet600 }}>{t.followup_note}</p>}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                <button
                  onClick={() => openArchiveConfirm(t)}
                  style={{ flex: 1, padding: '10px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ✓ Verify &amp; Archive
                </button>
                <button
                  onClick={() => openReopenModal(t)}
                  style={{ flex: 1, padding: '10px', background: COLORS.white, color: COLORS.red600, border: `1px solid ${COLORS.red200}`, borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ↩ Reopen
                </button>
              </div>
              {archiveErrors[t.id] && (
                <p style={modalErrorStyle}>⚠ Couldn't archive: {archiveErrors[t.id]}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reopen modal */}
      {reopenModalTicket && (
        <div style={modalOverlayStyle} onClick={closeReopenModal}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <p style={modalTitleStyle}>Reopen Ticket #{reopenModalTicket.ticket_number}</p>
            <p style={modalSubtitleStyle}>{reopenModalTicket.property?.address}</p>

            <label style={modalLabelStyle}>Reason (required)</label>
            <textarea
              value={reopenReason}
              onChange={(e) => setReopenReason(e.target.value)}
              rows={2}
              placeholder="e.g. Resident says the leak came back..."
              style={modalTextareaStyle}
            />

            {reopenError && <p style={modalErrorStyle}>{reopenError}</p>}

            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeReopenModal} style={modalCancelBtnStyle}>Cancel</button>
              <button onClick={submitReopen} style={{ ...modalConfirmBtnStyle, background: COLORS.red600 }}>Reopen Ticket</button>
            </div>
          </div>
        </div>
      )}

      {/* Archive confirmation modal */}
      {archiveConfirmTicket && (
        <div style={modalOverlayStyle} onClick={closeArchiveConfirm}>
          <div style={modalCardStyle} onClick={(e) => e.stopPropagation()}>
            <p style={modalTitleStyle}>Verify &amp; Archive Ticket #{archiveConfirmTicket.ticket_number}?</p>
            <p style={modalSubtitleStyle}>{archiveConfirmTicket.property?.address}</p>
            <p style={{ margin: '10px 0 0 0', fontSize: '13px', color: COLORS.slate500 }}>
              This confirms the work is verified and closes the ticket for good. This can't be undone from here — a closed ticket can only be reopened separately.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
              <button onClick={closeArchiveConfirm} disabled={archiveConfirming} style={modalCancelBtnStyle}>Cancel</button>
              <button
                onClick={confirmArchive}
                disabled={archiveConfirming}
                style={{ ...modalConfirmBtnStyle, background: COLORS.green600, opacity: archiveConfirming ? 0.6 : 1, cursor: archiveConfirming ? 'not-allowed' : 'pointer' }}
              >
                {archiveConfirming ? 'Archiving...' : '✓ Verify & Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// How long a ticket sat "Completed" before someone signed it off -- for a
// currently-Archived ticket that's completed_at -> status_changed_at (the
// last status transition, which is necessarily the archive itself while the
// ticket sits in that status). For a ticket still waiting, it's
// completed_at -> now, so the figure keeps climbing until it's actioned.
function signOffWaitMs(t) {
  if (!t.completed_at) return null
  if (t.status === 'Archived') return Math.max(0, new Date(t.status_changed_at) - new Date(t.completed_at))
  if (t.status === 'Completed') return Math.max(0, Date.now() - new Date(t.completed_at))
  return null
}

// thresholdMs comes from the admin-configurable "Sign-Off Threshold"
// setting (AdminSettings.jsx) -- red once a job's actually over it, amber
// from 75% of it as an early warning, teal while comfortably on track.
function signOffWaitTone(ms, thresholdMs) {
  if (ms == null) return null
  if (thresholdMs != null && ms >= thresholdMs) return { bg: COLORS.red100, color: COLORS.red600 }
  if (thresholdMs != null && ms >= thresholdMs * 0.75) return { bg: COLORS.amber100, color: COLORS.amber700 }
  return { bg: COLORS.teal50, color: COLORS.teal700 }
}

const OVERSIGHT_STATUS_LABELS = {
  Completed: 'Awaiting Sign-Off',
  Archived: 'Signed Off',
}

// Oversight of the sign-off stage specifically -- not the whole pipeline
// (that's what the Pipeline page is for). Only tickets that have actually
// reached Completed or Archived belong here: the point is watching how
// long each submitter takes to sign off their own completed work once it's
// done, since a slow sign-off is a proxy for how much a builder's
// completed job is actually being checked on. No hard KPI threshold yet
// (directors haven't set one) -- this just surfaces the wait times plainly,
// colour-graded, so one can be added later without changing how the data
// is gathered.
//
// `profile`/`onJumpToMine` are only passed for managers (admins render
// this standalone, and never have anything of "their own" to sign off) --
// their presence is what turns on the extra "you need to sign off" tile.
function SignOffOversight({ onNavigate, profile, onJumpToMine }) {
  const [tickets, setTickets] = useState([])
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [thresholdHours, setThresholdHours] = useState(48)

  const [statusFilter, setStatusFilter] = useState('All')
  const [submitterFilter, setSubmitterFilter] = useState('All')
  const [propertyFilter, setPropertyFilter] = useState('')
  const [ticketNumberFilter, setTicketNumberFilter] = useState('')

  useEffect(() => {
    fetchAll()
    fetchProperties()
    fetchThreshold()
  }, [])

  async function fetchProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('properties')
      .select('id, address')
      .order('address')

    if (!error) setProperties(data)
  }

  async function fetchThreshold() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'sign_off_wait_threshold_hours')
      .maybeSingle()

    if (data?.setting_value != null) setThresholdHours(Number(data.setting_value))
  }

  async function fetchAll() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, ticket_number, category, issue_tag, room, property_id,
        raised_by, raised_by_name, status, created_at, first_assigned_at, completed_at, status_changed_at
      `)
      .in('status', ['Completed', 'Archived'])
      .order('created_at', { ascending: false })

    if (!error) {
      const withProperties = await attachProperties(data, 'address')
      setTickets(withProperties)
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading sign-off oversight...</p>
    </div>
  )

  const submitterOptions = [...new Set(tickets.map(t => t.raised_by_name).filter(Boolean))].sort()

  const awaitingTickets = tickets.filter(t => t.status === 'Completed')
  const archivedTickets = tickets.filter(t => t.status === 'Archived')

  // Only the average reacts to the submitter/property/ticket# filters (not
  // the status dropdown, which just toggles which rows the table shows) --
  // the whole point is picking a submitter and comparing their figure
  // against another's, or against everyone's.
  const archivedForAvg = archivedTickets.filter(t => {
    if (submitterFilter !== 'All' && t.raised_by_name !== submitterFilter) return false
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (ticketNumberFilter.trim() && !String(t.ticket_number).includes(ticketNumberFilter.trim())) return false
    return true
  })
  const avgSignOffMs = archivedForAvg.length > 0
    ? archivedForAvg.reduce((sum, t) => sum + (signOffWaitMs(t) || 0), 0) / archivedForAvg.length
    : null

  const mineCount = profile ? awaitingTickets.filter(t => t.raised_by === profile.id).length : 0

  const kpis = [
    ...(profile ? [{ label: 'You Need to Sign Off', value: mineCount, colour: COLORS.purple600, jumpToMine: true }] : []),
    { label: 'Awaiting Sign-Off', value: awaitingTickets.length, colour: statusColour('Completed'), statusFilter: 'Completed' },
    { label: 'Signed Off', value: archivedTickets.length, colour: statusColour('Archived'), statusFilter: 'Archived' },
    {
      label: submitterFilter !== 'All' ? `Avg. Sign-Off Time — ${submitterFilter}` : 'Avg. Sign-Off Time',
      value: avgSignOffMs != null ? formatDurationDays(avgSignOffMs) : '—',
      colour: COLORS.slate500,
      keepFilters: true,
    },
  ]

  // The Avg tile is a live readout of whatever submitter/property/ticket#
  // is already selected, not a shortcut to a status view -- clicking it
  // shouldn't wipe out the very comparison it's showing. "You Need to Sign
  // Off" isn't a filter at all -- it jumps down to the actionable list
  // below, since this table itself has no archive/reopen actions on it.
  function applyKpiFilter(kpi) {
    if (kpi.jumpToMine) { onJumpToMine?.(); return }
    if (kpi.keepFilters) return
    setSubmitterFilter('All'); setPropertyFilter(''); setTicketNumberFilter('')
    setStatusFilter(kpi.statusFilter || 'All')
  }

  let filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'All' && t.status !== statusFilter) return false
    if (submitterFilter !== 'All' && t.raised_by_name !== submitterFilter) return false
    if (propertyFilter && String(t.property_id) !== String(propertyFilter)) return false
    if (ticketNumberFilter.trim() && !String(t.ticket_number).includes(ticketNumberFilter.trim())) return false
    return true
  })

  // Awaiting/already-signed-off views are specifically about latency, so
  // the whole reason to look at them is finding the worst offenders --
  // sort those by longest wait rather than the default "newest first".
  if (statusFilter === 'Completed' || statusFilter === 'Archived') {
    filteredTickets = [...filteredTickets].sort((a, b) => (signOffWaitMs(b) ?? -1) - (signOffWaitMs(a) ?? -1))
  }

  const hasFilters = statusFilter !== 'All' || submitterFilter !== 'All' || propertyFilter || ticketNumberFilter
  function clearFilters() { setStatusFilter('All'); setSubmitterFilter('All'); setPropertyFilter(''); setTicketNumberFilter('') }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '32px', height: '32px', borderRadius: '50%', background: COLORS.purple100, color: COLORS.purple600, fontSize: '16px' }}>✓</span>
        <div>
          <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Sign-Off Oversight</h1>
          <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>
            Completed jobs awaiting sign-off, and how long each submitter took once they've signed off.
            {' '}Sign-off wait is flagged red past {formatDurationDays(thresholdHours * 3600000)} (Settings → Sign-Off Threshold).
          </p>
        </div>
      </div>

      <KpiTiles kpis={kpis} onTileClick={applyKpiFilter} />

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Statuses</option>
          {Object.entries(OVERSIGHT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select value={submitterFilter} onChange={(e) => setSubmitterFilter(e.target.value)} style={filterSelectStyle}>
          <option value="All">All Submitters</option>
          {submitterOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <div style={{ width: '220px' }}>
          <PropertySearchSelect properties={properties} value={propertyFilter} onChange={setPropertyFilter} placeholder="All Properties" />
        </div>
        <input
          type="text"
          value={ticketNumberFilter}
          onChange={(e) => setTicketNumberFilter(e.target.value)}
          placeholder="Search ticket #..."
          style={{ ...filterSelectStyle, cursor: 'text', width: '160px' }}
        />
        {hasFilters && (
          <button onClick={clearFilters} style={{ ...filterSelectStyle, background: COLORS.white }}>Clear filters</button>
        )}
      </div>

      <div style={{ background: COLORS.white, borderRadius: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.slate200}` }}>
                <th style={thStyle}>Job</th>
                <th style={thStyle}>Submitter</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Assigned</th>
                <th style={thStyle}>Completed</th>
                <th style={thStyle}>Signed Off</th>
                <th style={thStyle}>Sign-Off Wait</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(t => {
                const wait = signOffWaitMs(t)
                const waitTone = signOffWaitTone(wait, thresholdHours * 3600000)
                return (
                  <tr key={t.id} style={{ borderBottom: `1px solid ${COLORS.slate100}` }}>
                    <td
                      style={{ ...tdStyle, cursor: onNavigate ? 'pointer' : 'default' }}
                      onClick={onNavigate ? () => onNavigate('pipeline', { ticketNumber: t.ticket_number }) : undefined}
                    >
                      <span style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>#{t.ticket_number}</span>
                      <span style={{ display: 'block', fontWeight: 700, color: onNavigate ? COLORS.blue700 : COLORS.slate900 }}>{t.property?.address || '—'}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: COLORS.slate500 }}>{t.room ? `${t.room} — ` : ''}{t.issue_tag || t.category}</span>
                    </td>
                    <td style={tdStyle}>{t.raised_by_name || '—'}</td>
                    <td style={tdStyle}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 700, color: statusColour(t.status) }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColour(t.status) }} />
                        {OVERSIGHT_STATUS_LABELS[t.status] || t.status}
                      </span>
                    </td>
                    <td style={tdStyle}>{t.first_assigned_at ? formatUKDateTime(t.first_assigned_at) : '—'}</td>
                    <td style={tdStyle}>{t.completed_at ? formatUKDateTime(t.completed_at) : '—'}</td>
                    <td style={tdStyle}>{t.status === 'Archived' ? formatUKDateTime(t.status_changed_at) : '—'}</td>
                    <td style={tdStyle}>
                      {wait != null ? (
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: waitTone.bg, color: waitTone.color }}>
                          {formatDurationDays(wait)}{t.status === 'Completed' ? ' so far' : ''}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
              {filteredTickets.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '32px 14px', textAlign: 'center', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>
                    No jobs match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
