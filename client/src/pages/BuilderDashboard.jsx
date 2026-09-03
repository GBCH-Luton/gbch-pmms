import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { COLORS } from '../lib/colors'
import { getCurrentPositionSafe } from '../lib/geo'
import { useLiveLocationPing } from '../lib/liveLocationPing'
import { fetchComplianceCheckTypes } from '../lib/compliance'
import { fetchMaintenanceCategories, fetchAllMaintenanceCategoryNames, sortedCategoryEntries } from '../lib/maintenanceCategories'
import { attachBuilderSafeProperties } from '../lib/properties'
import { logLoginEvent } from '../lib/loginEvents'
import { pushNotificationsSupported, hasActivePushSubscription, enablePushNotifications } from '../lib/pushNotifications'
import { pushEmergencyAlert, priorityTierLabel, fetchPriorityThresholds, Avatar, formatUKDate, formatUKDateTime, ukDateKey, ukTimeHHMM, minutesLate, shiftDateKey, fetchAttendanceSummary, formatDuration, formatDurationDays, fetchManagersForDivision, createNotification, sendPushNotification, SHORT_TRIP_REASONS } from './admin/shared'
import { distanceMetres, metresToMiles } from '../lib/geo'
import { fetchChannelMessages, subscribeToChannel, postMessage, markChannelRead, markChannelReadRemote, fetchChannelReads, countUnreadMentions, colorForSender } from '../lib/chat'
import { fetchDmContacts, fetchConversations, fetchThreadMessages, subscribeToDm, postDm, markThreadRead, countUnreadDms } from '../lib/dm'
import { NavIcon } from '../lib/icons'
import { compressImage } from '../lib/imageCompression'
import { compressVideo } from '../lib/videoCompression'
import { getSignedUrl, uploadFileWithProgress } from '../lib/storage'
import { uploadTicketAttachments, formatUploadProgress } from '../lib/ticketAttachments'
import PropertySearchSelect from '../components/PropertySearchSelect'
import ChatComposer from '../components/ChatComposer'
import PhotoLightbox from '../components/PhotoLightbox'
import AttachmentMedia from '../components/AttachmentMedia'
import TicketAttachmentGallery from '../components/TicketAttachmentGallery'
import VoiceInputButton from '../components/VoiceInputButton'
import TicketMediaPicker from '../components/TicketMediaPicker'
import gbchLogo from '../assets/gbch-logo.svg'

// Hidden for now, not removed -- flip back to true to bring the builder's
// self-serve "Log a Ticket" form back into the nav menu.
const SHOW_LOG_TICKET_NAV = false

// Hidden 2026-08-03 at the managers' request -- they want assignment to
// stay manager-controlled rather than builders self-claiming unassigned
// jobs. Not removed -- the page, the claim flow, and fetchAvailableJobs()
// are all still here, just unreachable from the nav/dashboard tile. Flip
// back to true to bring it back.
const SHOW_AVAILABLE_JOBS_NAV = false

// SHORT_TRIP_REASONS (imported above, from admin/shared) are the 3 Stop
// reasons that are a short, specific personal trip -- the builder stays
// locked to a small break timer (see the break-timer effect and
// BreakTimerBanner) with a single Resume Job button, rather than being
// released back to the job list the way "Waiting for Materials (ordered)"
// and "Unable to Do the Job" are. All three are just a hold_reason value
// on an ordinary On Hold ticket -- no new ticket status, no new table.

// Matches AdminClocking.jsx's own ROAD_DISTANCE_MULTIPLIER -- straight-line
// distance undercounts real road travel, so both places nudge it the same
// amount rather than showing a number that never matches the other page's.
const ROAD_DISTANCE_MULTIPLIER = 1.3

// Hidden 2026-08-14, not removed -- the approved Leaving Site redesign
// makes Leaving Site -> Going to Another Job the one way to open a job, so
// the full job list, its status-filter dropdown, and the "Closest to you"
// nearby-job nudge (another way to jump straight to a job) are all turned
// off together. Metric tiles stay visible but lose their onClick (see the
// tiles render below) for the same reason.
const SHOW_JOB_LIST = false
const SHOW_NEARBY_JOBS = false

// A lone "." or other punctuation-only text technically passes .trim(),
// letting someone tap through the clock-in gate's required "Other" note
// without actually describing anything -- found live 2026-09-01 (Daniel's
// note was literally "."), which is exactly why Where's the Team's new
// location pill (see AdminDashboard.jsx) showed nothing meaningful for
// him. Requires at least one real letter/digit instead of just non-empty.
function hasMeaningfulNote(note) {
  return /[a-zA-Z0-9]/.test(note)
}

// Shared by every Leaving Site sub-page below -- same header (Back + logo +
// hamburger, with the full nav menu behind it) every other full-screen
// "page" in this file already duplicates per page; pulled out once here
// since this change adds 6 more of them at once.
function BuilderNavHeader({ onBack, goHome, menuOpen, setMenuOpen, profile, unreadMentions, setPage, handleSignOut }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={onBack} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
            ← Back
          </button>
          <button onClick={goHome} aria-label="Go to home" style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
            <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
          </button>
        </div>
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Menu"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
        >
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
        </button>
      </div>

      {menuOpen && (
        <div style={{ background: COLORS.greenDark, padding: '20px' }}>
          <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
          <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {SHOW_LOG_TICKET_NAV && (
              <button
                onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                📝 Log a Ticket
              </button>
            )}
            <button
              onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              📋 My Reports
            </button>
            <button
              onClick={() => { setPage('mileage'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              🕐 My Mileage
            </button>
            <button
              onClick={() => { setPage('metrics'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              📊 My Metrics
            </button>
            <button
              onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              <span>💬 Team Chat</span>
              {unreadMentions > 0 && (
                <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
              )}
            </button>
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              🚪 Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function BuilderDashboard({ profile }) {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState('jobs')
  // Builder devision -- no channel picker at all here, unlike the
  // Admin/Manager view, since a builder always belongs to exactly one
  // channel. Built-in Builder role resolves profile.division as null
  // (see pmms.current_division()'s own behaviour), which defaults to
  // 'Maintenance' -- same convention used everywhere else in this app.
  const chatDivision = profile.division || 'Maintenance'
  const [chatMessages, setChatMessages] = useState([])
  const [chatMembers, setChatMembers] = useState([])
  const [chatReads, setChatReads] = useState({})
  const [chatSending, setChatSending] = useState(false)
  const [unreadMentions, setUnreadMentions] = useState(0)
  const [chatLightboxUrl, setChatLightboxUrl] = useState(null)
  // Direct Messages, alongside the division channel above -- see
  // scripts/add_pmms_dm_messages_table.sql. chatTab picks between the two;
  // dmView further splits DM into "who have I messaged" vs "an open
  // thread", since there's no room on a phone screen to show both like
  // the Admin/Manager rail does.
  const [chatTab, setChatTab] = useState('channel') // 'channel' | 'dm'
  const [dmView, setDmView] = useState('list') // 'list' | 'thread'
  const [conversations, setConversations] = useState([])
  const [dmContacts, setDmContacts] = useState([])
  const [activeContact, setActiveContact] = useState(null)
  const [dmMessages, setDmMessages] = useState([])
  const [dmSending, setDmSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [contactSearch, setContactSearch] = useState('')
  // null (not 0) until the builder actually touches the stepper/input --
  // lets 0 be a deliberate "already at this property" answer instead of
  // being indistinguishable from never having entered anything.
  const [miles, setMiles] = useState(null)
  // A GPS fix is now required to clock in/resume -- directors' call: a
  // builder can step outside for signal, so "no signal" shouldn't be an
  // acceptable reason to start work with no location on record. Shared
  // between handleClockIn and handleResumeWork since only one can ever be
  // showing at a time (selectedTicket is singular).
  const [clockingIn, setClockingIn] = useState(false)
  const [clockInError, setClockInError] = useState('')

  // Day-level shift, separate from per-job clocking above -- gates the
  // whole dashboard (see the early return right after the loading check)
  // until a builder clocks in for the day. "Currently on shift" == the
  // most recent pmms.daily_attendance row with clock_out_at still null --
  // but only counts as TODAY's shift if it's genuinely still within the
  // stale-shift threshold; see fetchTodayShift and staleShift below for
  // what happens once it isn't.
  const [todayShift, setTodayShift] = useState(null)
  useLiveLocationPing(!!todayShift, profile.id)
  // A forgotten clock-out that's rolled past the configurable threshold
  // (stale_shift_hours) into a new calendar day -- blocks the whole
  // dashboard (own early return, before the normal clock-in gate) until a
  // manager closes it out via AdminClocking.jsx's "Clock Out For Them".
  const [staleShift, setStaleShift] = useState(null)
  const [shiftLoading, setShiftLoading] = useState(true)
  const [dailyClockInDeadline, setDailyClockInDeadline] = useState('09:00')
  const [dailyClockOutDeadline, setDailyClockOutDeadline] = useState('17:00')
  const [clockingInForDay, setClockingInForDay] = useState(false)
  const [clockInForDayError, setClockInForDayError] = useState('')
  // Where they're clocking in from -- must pick one before Clock In For
  // The Day is even reachable (see the gate render below). Previewed in
  // the Builder v0.3 guide simulator and approved before building.
  // Reset to 'choose' on every fresh clock-out via finishClockOutForDay.
  const [gateStep, setGateStep] = useState('choose') // choose | pick-job | pick-property | confirm
  const [gateLocationType, setGateLocationType] = useState(null) // 'office' | 'job' | 'property' | 'other'
  const [gateLocationTicketId, setGateLocationTicketId] = useState(null)
  const [gateLocationPropertyId, setGateLocationPropertyId] = useState(null)
  const [gateLocationPropertyAddress, setGateLocationPropertyAddress] = useState('')
  const [gateOtherNote, setGateOtherNote] = useState('')
  const [clockingOutForDay, setClockingOutForDay] = useState(false)
  const [clockOutForDayError, setClockOutForDayError] = useState('')
  // Symmetric with the late clock-in flag -- clocking out before
  // dailyClockOutDeadline requires a reason, captured here before the
  // clock-out actually goes through.
  const [earlyLeavePromptOpen, setEarlyLeavePromptOpen] = useState(false)
  const [earlyLeaveReason, setEarlyLeaveReason] = useState('')
  // Plain "are you sure" gate for clocking out AFTER the deadline --
  // before this, a clock-out past dailyClockOutDeadline had zero
  // confirmation of any kind (only the early-leave case above asked for
  // anything). Found live: "Leaving Site" and "Clock Out for the Day"
  // sitting as same-row, same-size buttons led to a mis-tap that ended
  // someone's whole day by accident. This doesn't replace the early-leave
  // reason prompt -- that already serves as its own confirm step.
  const [clockOutConfirmOpen, setClockOutConfirmOpen] = useState(false)

  // My Metrics' own Attendance section -- fetched only while that page is
  // open (unlike everything else on this dashboard, nothing else needs a
  // daily_attendance date-range query up front), same aggregation
  // BuilderProfilePage.jsx uses for the admin-side view of this builder.
  const [attendancePeriodDays, setAttendancePeriodDays] = useState(7)
  const [attendanceSummary, setAttendanceSummary] = useState(null)
  const [attendanceLoading, setAttendanceLoading] = useState(true)

  // My Mileage's own ticket set, separate from the `tickets` state above --
  // that one is scoped to active jobs (excludes Archived/Cancelled, correct
  // for a job list) and would otherwise silently hide real driven mileage
  // on completed-and-signed-off jobs from this history page. Cancelled
  // stays excluded (that travel likely never happened as planned); Archived
  // doesn't, matching the admin-side Staff profile's own mileage total
  // (fetchMileageSummary), which never filters by status at all. Found live
  // 2026-08-24 -- this page's "This month" figure disagreed with the admin
  // side by exactly the miles sitting on Archived tickets.
  const [mileageAllTickets, setMileageAllTickets] = useState([])
  const [mileageDataLoading, setMileageDataLoading] = useState(true)

  // Mid-day presence, independent of both the shift above and any job's
  // own work_session -- a materials run or a break doesn't pause or
  // affect job time, it's purely a supplementary "where are they right
  // now" record for managers (see pmms.activity_log).
  const [openActivity, setOpenActivity] = useState(null)
  const [activityType, setActivityType] = useState('Travel')
  // 'shop' is the free-text "Buying Materials" flow (the 'leaving-materials'
  // page); 'job' picks one of this builder's own Assigned tickets via the
  // 'leaving-job' search page instead of typing a note, and records it in
  // destination_ticket_id; 'office' is a fixed note, no input needed (see
  // 'leaving-office'). All three still write activity_type: 'Travel', so
  // every existing "Travelling" display elsewhere in the app keeps working
  // unchanged.
  const [travelMode, setTravelMode] = useState('shop')
  const [destinationTicketId, setDestinationTicketId] = useState('')
  // Distinguishes "opened the job search to actually travel there" (Going
  // to Another Job) from "opened the same search to just browse the to-do
  // list" (the home tile below) -- both land on the identical leaving-job
  // screen with travelMode 'job', so without this flag there'd be no way
  // to tell a genuine travel pick from a casual peek at an assigned job.
  const [pickingForTravel, setPickingForTravel] = useState(false)
  const [activityNote, setActivityNote] = useState('')
  const [jobSearchQuery, setJobSearchQuery] = useState('')
  // Optional receipt capture, shown only when ending a 'materials' trip --
  // see add_activity_receipts_table.sql. Never required; "I'm Back" works
  // exactly as before if left with no rows. One row per physical receipt
  // (a materials run can span two shops/two receipts), same "array of
  // rows with add/remove" shape as materialsUsedRows below.
  const [receiptRows, setReceiptRows] = useState([])
  // Admin-configurable (AdminSettings.jsx "Material Stores") -- only the
  // active ones are offered as suggestions; inactive ones are kept so past
  // trips that named them still read fine, just not resurfaced going
  // forward.
  const [materialStores, setMaterialStores] = useState([])
  const [startingActivity, setStartingActivity] = useState(false)
  const [endingActivity, setEndingActivity] = useState(false)
  const [activityError, setActivityError] = useState('')
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [commentError, setCommentError] = useState('')
  const [elapsed, setElapsed] = useState(0)
  // Break-mode timer -- same idea as `elapsed` above, but counts from
  // whenever a short-trip Stop reason (Going to the Office / Lunch Break /
  // Getting materials myself) was chosen, via status_changed_at, rather
  // than a work_session row (there isn't one while paused).
  const [breakElapsed, setBreakElapsed] = useState(0)
  // Genuinely-idle timer -- not on a job and not on one of the 3 locked
  // short trips (those already have breakElapsed above). Covers both
  // "Away" (openActivity) and plain "nothing queued" idle. See isIdle /
  // computeIdleSince further down.
  const [idleElapsed, setIdleElapsed] = useState(0)
  // Unified "why are you stopping" flow -- replaces the old separate
  // Pause-reason-picker and "Couldn't get access" confirm screens (both
  // removed) with one Stop button and one 6-option sheet. See handleStop.
  const [stopSheetOpen, setStopSheetOpen] = useState(false)
  const [materialsAskOpen, setMaterialsAskOpen] = useState(false)
  const [stopReasonPicked, setStopReasonPicked] = useState(null)
  const [stopNote, setStopNote] = useState('')
  const [stopSubmitting, setStopSubmitting] = useState(false)
  const [stopError, setStopError] = useState('')
  const [showDelayReasonForm, setShowDelayReasonForm] = useState(false)
  const [delayReason, setDelayReason] = useState(null)
  const [delayReasonNote, setDelayReasonNote] = useState('')
  const [delayReasonSubmitting, setDelayReasonSubmitting] = useState(false)
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false)
  const [completeNote, setCompleteNote] = useState('')
  // Was a single <input type="file"> capped at one photo -- found live
  // 2026-08-12 (a Housekeeper normally attaches 4-5 photos/videos per job,
  // tickets #135/#163) that this was a real limitation, not a design
  // choice. Now the same multi-file/video TicketMediaPicker "raise a
  // ticket" already uses.
  const [completeMediaFiles, setCompleteMediaFiles] = useState([])
  const [hasBrokenCompleteMedia, setHasBrokenCompleteMedia] = useState(false)
  const [completeUploadProgress, setCompleteUploadProgress] = useState(null)
  const [completeSubmitting, setCompleteSubmitting] = useState(false)
  const [completeError, setCompleteError] = useState('')
  // A job can be genuinely done and still need something picked up later --
  // e.g. "fixed the fridge, but it should really be replaced." Was part of
  // the approved Builder v2 design but missed when the Leaving Site rework
  // shipped 2026-08-15; added back here on 2026-08-15.
  const [followUpNeeded, setFollowUpNeeded] = useState(false)
  const [followUpNote, setFollowUpNote] = useState('')
  // What this job actually used -- free text (name/kind + quantity), not a
  // catalog pick, since there's no real stock system to pick from yet. See
  // add_ticket_materials_used_table.sql -- deliberately separate from a
  // purchase-trip receipt (activity_receipts), which isn't reliably tied
  // to any one job (a bulk buy can supply several future jobs).
  const [materialsUsedRows, setMaterialsUsedRows] = useState([])
  const [routineVisitChecklistTemplate, setRoutineVisitChecklistTemplate] = useState([])
  const [checklistChecked, setChecklistChecked] = useState({})
  const [loggingMode, setLoggingMode] = useState('maintenance') // 'maintenance' | 'compliance'
  const [p1Threshold, setP1Threshold] = useState(70)
  const [p2Threshold, setP2Threshold] = useState(40)
  const [ticketProperties, setTicketProperties] = useState([])
  const [ticketPropertyId, setTicketPropertyId] = useState('')
  const [ticketRoom, setTicketRoom] = useState(null)
  const [ticketRoomContext, setTicketRoomContext] = useState(null)
  const [ticketRoomCode, setTicketRoomCode] = useState('')
  const [ticketOtherArea, setTicketOtherArea] = useState('')
  const [ticketCategory, setTicketCategory] = useState(null)
  const [ticketIssueTag, setTicketIssueTag] = useState(null)
  const [ticketIssueOther, setTicketIssueOther] = useState('')
  const [ticketMediaFiles, setTicketMediaFiles] = useState([])
  const [hasBrokenTicketMedia, setHasBrokenTicketMedia] = useState(false)
  const [ticketDuplicateWarning, setTicketDuplicateWarning] = useState(null)
  const [ticketSubmitting, setTicketSubmitting] = useState(false)
  const [ticketUploadProgress, setTicketUploadProgress] = useState(null)
  const [ticketError, setTicketError] = useState('')
  const [ticketSuccess, setTicketSuccess] = useState(false)
  const [maintenanceCategories, setMaintenanceCategories] = useState({})
  const [complianceCheckType, setComplianceCheckType] = useState(null)
  const [complianceCheckTypes, setComplianceCheckTypes] = useState([])
  const [complianceResults, setComplianceResults] = useState([])
  const [complianceNotes, setComplianceNotes] = useState([])
  const [complianceMediaFiles, setComplianceMediaFiles] = useState([])
  const [complianceMediaPreviews, setComplianceMediaPreviews] = useState([])
  const [complianceSubmitting, setComplianceSubmitting] = useState(false)
  const [complianceUploadProgress, setComplianceUploadProgress] = useState(null)
  const [complianceSuccess, setComplianceSuccess] = useState('')
  const [reportedTickets, setReportedTickets] = useState([])
  const [notifications, setNotifications] = useState([])
  const [notifPanelOpen, setNotifPanelOpen] = useState(false)
  const [notificationOpenError, setNotificationOpenError] = useState('')
  const [availableJobs, setAvailableJobs] = useState([])
  const [claimError, setClaimError] = useState('')
  const [claimingId, setClaimingId] = useState(null)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushError, setPushError] = useState('')

  async function handleEnableNotifications() {
    setPushError('')
    const result = await enablePushNotifications(profile.id)
    if (!result.success) { setPushError(result.message); return }
    setPushEnabled(true)
  }

  useEffect(() => {
    fetchTickets()
    fetchNotifications()
    fetchAvailableJobs()
    fetchTodayShift()
    fetchOpenActivity()
    fetchPriorityThresholds().then(({ p1, p2 }) => { setP1Threshold(p1); setP2Threshold(p2) })
    fetchRoutineVisitChecklistTemplate()
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'material_stores').maybeSingle()
      .then(({ data }) => { if (Array.isArray(data?.setting_value)) setMaterialStores(data.setting_value) })
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'daily_clock_in_deadline').maybeSingle()
      .then(({ data }) => { if (data?.setting_value) setDailyClockInDeadline(data.setting_value) })
    supabase.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'daily_clock_out_reminder_time').maybeSingle()
      .then(({ data }) => { if (data?.setting_value) setDailyClockOutDeadline(data.setting_value) })
    // Permission alone doesn't mean a subscription actually exists (a
    // browser can report "granted" with nothing ever subscribed) -- this
    // is the real check for whether the button should offer to enable.
    hasActivePushSubscription().then(setPushEnabled)
    refreshUnreadBadge()
    // Polled rather than pushed -- notifications are created by an admin
    // action elsewhere, so this is the only way this session finds out
    // about a new one without the builder manually refreshing. Available
    // jobs are polled the same way, for the same reason -- no realtime
    // infrastructure exists anywhere in this app, so this is how a job
    // someone else claimed disappears from here without a manual refresh.
    // The Team Chat badge (mentions + Direct Messages combined) is polled
    // here too rather than via its own Realtime subscription, since it
    // needs to update even while the chat view itself isn't open.
    const interval = setInterval(() => {
      fetchNotifications(); fetchAvailableJobs()
      refreshUnreadBadge()
    }, 45000)
    return () => clearInterval(interval)
  }, [])

  async function refreshUnreadBadge() {
    const [mentions, dms] = await Promise.all([
      countUnreadMentions(chatDivision, profile.id),
      countUnreadDms(profile.id),
    ])
    setUnreadMentions(mentions + dms)
  }

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
    if (page === 'team-chat') {
      fetchChannelMessages(chatDivision).then(setChatMessages)
      fetchChatMembers()
      fetchChannelReads(chatDivision).then(setChatReads)
      markChannelRead(chatDivision)
      markChannelReadRemote(chatDivision, profile.id)
      setUnreadMentions(0)
      const unsubscribe = subscribeToChannel(
        chatDivision,
        (newMessage) => {
          setChatMessages(prev => [...prev, newMessage])
          markChannelRead(chatDivision)
          markChannelReadRemote(chatDivision, profile.id)
          if ((newMessage.mentioned_staff_ids || []).includes(profile.id)) setUnreadMentions(0)
        },
        (read) => {
          setChatReads(prev => ({ ...prev, [read.staff_id]: read.last_read_at }))
        }
      )
      return unsubscribe
    }
  }, [page])

  useEffect(() => {
    if (page !== 'metrics') return
    let cancelled = false
    setAttendanceLoading(true)
    const toKey = ukDateKey()
    const fromKey = shiftDateKey(toKey, -(attendancePeriodDays - 1))
    fetchAttendanceSummary(profile.id, fromKey, toKey).then(summary => {
      if (!cancelled) { setAttendanceSummary(summary); setAttendanceLoading(false) }
    })
    return () => { cancelled = true }
  }, [page, attendancePeriodDays])

  useEffect(() => {
    if (page !== 'mileage') return
    let cancelled = false
    setMileageDataLoading(true)
    supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, mileage_logged, mileage_logged_at, property_id')
      .eq('assigned_builder_id', profile.id)
      .neq('status', 'Cancelled')
      .gt('mileage_logged', 0)
      .then(async ({ data }) => {
        if (cancelled) return
        setMileageAllTickets(await attachBuilderSafeProperties(data || []))
        setMileageDataLoading(false)
      })
    return () => { cancelled = true }
  }, [page])

  // Direct Messages: loaded whenever the team-chat page is open regardless
  // of which tab is active, so switching from Channel to Direct Messages
  // is instant. One subscription for every DM this builder sends/receives
  // (RLS already scopes what Realtime delivers), same pattern as
  // AdminTeamChat.jsx.
  const activeContactRef = useRef(activeContact)
  useEffect(() => { activeContactRef.current = activeContact }, [activeContact])

  useEffect(() => {
    if (page !== 'team-chat') return
    refreshConversations()
    fetchDmContacts().then(setDmContacts)

    const unsubscribe = subscribeToDm(
      (newMessage) => {
        setDmMessages(prev => {
          const inThisThread = activeContactRef.current && (
            (newMessage.sender_id === profile.id && newMessage.recipient_id === activeContactRef.current.id) ||
            (newMessage.sender_id === activeContactRef.current.id && newMessage.recipient_id === profile.id)
          )
          if (!inThisThread) return prev
          if (newMessage.recipient_id === profile.id) markThreadRead(profile.id, newMessage.sender_id)
          return [...prev, newMessage]
        })
        refreshConversations()
      },
      () => refreshConversations()
    )
    return unsubscribe
  }, [page])

  async function refreshConversations() {
    setConversations(await fetchConversations(profile.id))
  }

  async function openDm(contact) {
    setChatTab('dm')
    setDmView('thread')
    setActiveContact(contact)
    setDmMessages(await fetchThreadMessages(profile.id, contact.id))
    await markThreadRead(profile.id, contact.id)
    refreshConversations()
  }

  async function handleSendDm(body, _mentionedIds, photoFile) {
    if (!activeContact) return
    setDmSending(true)
    await postDm({ senderId: profile.id, senderName: profile.name, recipientId: activeContact.id, body, photoFile })
    setDmSending(false)
  }

  async function fetchChatMembers() {
    // Builders can only SELECT their own row in public.staff -- this
    // SECURITY DEFINER function (pmms.chat_channel_members()) is what
    // lets a builder caller get the id/name list the @mention picker
    // needs, without loosening public.staff's RLS itself. Scoped to this
    // builder's own channel (chatDivision) -- so only people who could
    // actually see/respond here show up, not the whole company.
    const { data } = await supabase.schema('pmms').rpc('chat_channel_members', { target_division: chatDivision })
    setChatMembers(data || [])
  }

  async function handleSendChatMessage(body, mentionedIds, photoFile) {
    setChatSending(true)
    await postMessage({
      division: chatDivision, senderId: profile.id, senderName: profile.name,
      body, mentionedStaffIds: mentionedIds, photoFile,
    })
    setChatSending(false)
  }

  useEffect(() => {
    setMiles(null)
    setClockingIn(false)
    setClockInError('')
    setStopSheetOpen(false)
    setMaterialsAskOpen(false)
    setStopReasonPicked(null)
    setStopNote('')
    setStopError('')
    setShowCompleteConfirm(false)
    setCompleteNote('')
    setCompleteMediaFiles([])
    setCompleteUploadProgress(null)
    setCompleteError('')
    setFollowUpNeeded(false)
    setFollowUpNote('')
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

  useEffect(() => {
    const onBreak = selectedTicket?.status === 'On Hold' && SHORT_TRIP_REASONS.includes(selectedTicket.hold_reason)
    if (!onBreak) { setBreakElapsed(0); return }

    // status_changed_at is set the moment handlePause runs, same instant
    // work_sessions.ended_at freezes the job's own timer -- no separate
    // "break started" column needed.
    const startedAt = new Date(selectedTicket.status_changed_at || Date.now())
    setBreakElapsed(Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000)))

    const interval = setInterval(() => setBreakElapsed(prev => prev + 1), 1000)
    return () => clearInterval(interval)
  }, [selectedTicket?.id, selectedTicket?.status, selectedTicket?.hold_reason, selectedTicket?.status_changed_at])

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
        id, ticket_number, status, status_changed_at, category, issue_tag, description, room, priority_score, estimated_minutes, mileage_logged, mileage_logged_at, transit_start, created_at, completed_at, completion_note, completion_photo_url, hold_reason, hold_note, photo_url, property_id, checklist_responses, delay_reason, delay_reason_note, delay_reason_status, raised_by
      `)
      .eq('assigned_builder_id', profile.id)
      .not('status', 'in', '("Archived","Cancelled")')
      .order('priority_score', { ascending: false })

    if (!error) setTickets(await attachBuilderSafeProperties(data))
    setLoading(false)
  }

  // A division-scoped builder (e.g. Housekeeper) only ever sees jobs in
  // their own division -- skill tags don't apply to them. An unscoped
  // builder (today's default "Builder" role) keeps the pre-existing
  // behaviour unchanged: matching their own tagged skills, or -- if
  // untagged -- every unassigned Pending ticket ("no tags = eligible
  // for everything").
  async function fetchAvailableJobs() {
    let query = supabase
      .schema('pmms')
      .from('tickets')
      .select('id, ticket_number, status, category, description, room, priority_score, property_id')
      .is('assigned_builder_id', null)
      .eq('status', 'Pending')
      .order('priority_score', { ascending: false })

    if (profile.division) {
      const divisionCategories = await fetchAllMaintenanceCategoryNames(profile.division)
      query = query.in('category', divisionCategories)
    } else if (profile.skills?.length) {
      query = query.in('category', profile.skills)
    }

    const { data, error } = await query
    if (!error) setAvailableJobs(await attachBuilderSafeProperties(data))
  }

  // The `.is('assigned_builder_id', null)` in the update itself is what
  // makes this safe if two builders tap Claim on the same job at once --
  // only the first UPDATE actually matches a row; the second gets back
  // zero rows and this shows "already claimed" instead of double-assigning.
  async function handleClaimJob(ticket) {
    setClaimError('')
    setClaimingId(ticket.id)

    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ assigned_builder_id: profile.id, status: 'Assigned', status_changed_at: new Date().toISOString(), stuck_alert_sent_at: null, first_assigned_at: new Date().toISOString() })
      .eq('id', ticket.id)
      .is('assigned_builder_id', null)
      .select()

    if (error) {
      setClaimError(error.message)
      setClaimingId(null)
      return
    }

    if (!data || data.length === 0) {
      setClaimError('Someone already claimed this job.')
      setClaimingId(null)
      await fetchAvailableJobs()
      return
    }

    await supabase
      .schema('pmms')
      .from('comments')
      .insert({ ticket_id: ticket.id, author_id: profile.id, author_name: profile.name, role: profile.role, body: `Claimed by ${profile.name}.` })
    await postAuditEvent(ticket.id, 'Claimed', `${profile.name} claimed this job from the Available Jobs queue.`)

    setClaimingId(null)
    await fetchAvailableJobs()
    await fetchTickets()
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

  async function fetchRoutineVisitChecklistTemplate() {
    const { data } = await supabase
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'routine_visit_checklist')
      .maybeSingle()
    if (Array.isArray(data?.setting_value)) setRoutineVisitChecklistTemplate(data.setting_value)
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

  async function fetchTodayShift() {
    const { data } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .select('id, work_date, clock_in_at, late_flag, clock_in_lat, clock_in_lng, clock_in_location_type, clock_in_location_ticket_id, clock_in_location_property_id, clock_in_location_note')
      .eq('staff_id', profile.id)
      .is('clock_out_at', null)
      .order('clock_in_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    // This used to just trust "the most recent open shift" as today's,
    // even when it was actually still open from a PREVIOUS day -- a
    // forgotten clock-out silently rolled straight into the next day as
    // one long shift instead of two. Now: a shift that's both from a
    // different calendar day AND open past the configurable threshold is
    // "stale" and blocks the app entirely -- a manager has to close it out
    // (see AdminClocking.jsx's "Clock Out For Them") before a fresh
    // clock-in is even possible. Director-approved design: no auto
    // clock-out (a guess at hours could short-change or overpay someone),
    // and no quietly letting the builder start fresh while the old shift
    // sits unresolved.
    if (data) {
      const { data: thresholdRow } = await supabase
        .schema('pmms').from('settings').select('setting_value')
        .eq('setting_key', 'stale_shift_hours').maybeSingle()
      const thresholdHours = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 16
      const hoursOpen = (Date.now() - new Date(data.clock_in_at).getTime()) / 3600000
      if (data.work_date !== ukDateKey() && hoursOpen >= thresholdHours) {
        setStaleShift(data)
        setTodayShift(null)
        setShiftLoading(false)
        return
      }
    }
    setStaleShift(null)
    setTodayShift(data || null)
    setShiftLoading(false)
  }

  function resetGateLocationPicker() {
    setGateStep('choose')
    setGateLocationType(null)
    setGateLocationTicketId(null)
    setGateLocationPropertyId(null)
    setGateLocationPropertyAddress('')
    setGateOtherNote('')
  }

  async function handleClockInForDay() {
    if (!gateLocationType) return
    if (gateLocationType === 'other' && !hasMeaningfulNote(gateOtherNote)) return

    setClockInForDayError('')
    setClockingInForDay(true)
    const position = await getCurrentPositionSafe()
    if (!position) {
      setClockingInForDay(false)
      setClockInForDayError("Couldn't get your location. Make sure location is turned on and you have signal, then try again.")
      return
    }

    const now = new Date()
    const { data, error } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .insert({
        staff_id: profile.id,
        work_date: ukDateKey(now.getTime()),
        clock_in_at: now.toISOString(),
        clock_in_lat: position.latitude,
        clock_in_lng: position.longitude,
        late_flag: ukTimeHHMM(now.getTime()) > dailyClockInDeadline,
        clock_in_location_type: gateLocationType,
        clock_in_location_ticket_id: gateLocationType === 'job' ? gateLocationTicketId : null,
        clock_in_location_property_id: gateLocationType === 'property' ? gateLocationPropertyId : null,
        clock_in_location_note: gateLocationType === 'other' ? gateOtherNote.trim() : null,
      })
      .select('id, work_date, clock_in_at, late_flag, clock_in_location_type, clock_in_location_ticket_id, clock_in_location_property_id, clock_in_location_note')
      .single()

    setClockingInForDay(false)
    if (error) { setClockInForDayError(error.message); return }
    setTodayShift(data)
    resetGateLocationPicker()
  }

  function attemptClockOutForDay() {
    setClockOutForDayError('')
    const stillWorking = tickets.find(t => t.status === 'In Progress')
    if (stillWorking) {
      setClockOutForDayError(`Job #${stillWorking.ticket_number} is still in progress -- pause or complete it before clocking out for the day.`)
      return
    }
    if (openActivity) {
      setClockOutForDayError("You're still logged as away -- tap \"I'm Back\" before clocking out for the day.")
      return
    }
    // Same "clearly not just normal variation" framing as the late
    // clock-in flag -- ask why, rather than silently letting a much
    // shorter-than-expected day pass with no record of the reason.
    if (ukTimeHHMM() < dailyClockOutDeadline) {
      setEarlyLeaveReason('')
      setEarlyLeavePromptOpen(true)
      return
    }
    setClockOutConfirmOpen(true)
  }

  function submitEarlyLeave() {
    if (!earlyLeaveReason.trim()) { setClockOutForDayError('Please give a reason for finishing early.'); return }
    submitClockOutForDay(earlyLeaveReason.trim())
  }

  async function submitClockOutForDay(earlyReason) {
    setClockOutForDayError('')
    setClockingOutForDay(true)
    // Unlike clocking IN for the day, a missing GPS fix here doesn't block
    // clocking out -- same asymmetry as the existing per-job clock-out,
    // which only ever requires a fix on the way in.
    const position = await getCurrentPositionSafe()
    const now = new Date().toISOString()

    const { error } = await supabase
      .schema('pmms')
      .from('daily_attendance')
      .update({
        clock_out_at: now,
        clock_out_lat: position?.latitude ?? null,
        clock_out_lng: position?.longitude ?? null,
        ...(earlyReason ? { early_leave_reason: earlyReason } : {}),
      })
      .eq('id', todayShift.id)

    setClockingOutForDay(false)
    if (error) { setClockOutForDayError(error.message); return }

    // attemptClockOutForDay already blocks on a same-render openActivity,
    // but that's local state -- it can go stale if an activity leg started
    // in another tab/session, or between that check and this submit. A
    // leg left open here never gets closed by anything else and resurfaces
    // in "Where's the Team" every day after, looking like it just
    // happened (found live: Stuart Blease's lunch break, still open a day
    // later). Belt-and-braces: close out anything still open for this
    // staff member at the same moment the day itself ends.
    await supabase
      .schema('pmms')
      .from('activity_log')
      .update({ ended_at: now, end_note: 'Auto-closed — clocked out for the day' })
      .eq('staff_id', profile.id)
      .is('ended_at', null)

    setEarlyLeavePromptOpen(false)
    setTodayShift(null)
    resetGateLocationPicker()
  }

  async function fetchOpenActivity() {
    const { data } = await supabase
      .schema('pmms')
      .from('activity_log')
      .select('id, activity_type, activity_category, note, started_at, destination_ticket_id, ticket_id')
      .eq('staff_id', profile.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setOpenActivity(data || null)
  }

  function openActivityPicker() {
    setActivityType('Travel')
    setTravelMode('shop')
    setDestinationTicketId('')
    setActivityNote('')
    setJobSearchQuery('')
    setActivityError('')
    setPickingForTravel(false)
    setPage('leaving-choices')
  }

  async function handleStartActivity(overrideDestinationTicketId) {
    const destinationId = overrideDestinationTicketId ?? destinationTicketId
    if (activityType === 'Travel' && travelMode === 'shop' && !activityNote.trim()) {
      setActivityError('Please say where you\'re going (e.g. shop name).')
      return
    }
    if (activityType === 'Travel' && travelMode === 'job' && !destinationId) {
      setActivityError('Please pick which job you\'re heading to.')
      return
    }
    setActivityError('')

    // Going to Another Job only ever reaches here from the new
    // leaving-job-confirm screen's explicit "Start Travelling" tap --
    // picking a destination from the search list itself is still pure
    // navigation with no write (see the leaving-job result row's onClick,
    // gated on pickingForTravel). That two-step shape (pick, then a
    // separate explicit Start) mirrors materials/office/lunch below
    // exactly, so this is the same "only log on a real button action"
    // this file has always used elsewhere -- job-to-job travel just
    // didn't have a distinct Start step until now.
    const destinationTicket = travelMode === 'job' ? tickets.find(t => t.id === destinationId) : null
    if (travelMode === 'job' && !destinationTicket) { setActivityError('Could not find that job.'); return }

    setStartingActivity(true)
    // Non-blocking, unlike the daily clock-in GPS fix -- a bad signal
    // moment shouldn't stop someone from logging that they're leaving.
    const position = await getCurrentPositionSafe()

    // Captured automatically, not builder-entered -- whichever job they
    // were mid-way through (if any) when they stepped away, so managers
    // can see "left site" and "returned" against a job number later.
    const inProgressTicket = tickets.find(t => t.status === 'In Progress')
    const note = activityType === 'Break'
      ? (activityNote.trim() || 'Lunch')
      : travelMode === 'office'
        ? 'Going to the office'
        : travelMode === 'job'
          ? `Job #${destinationTicket.ticket_number} — ${destinationTicket.property?.address || 'address unknown'}`
          : activityNote.trim()

    // Distinct from activity_type ('Travel'/'Break') -- lets admin-side
    // displays and duration reporting tell "Buying Materials" apart from
    // "Going to the Office" instead of both collapsing into one generic
    // "Travelling" label.
    const category = activityType === 'Break' ? 'lunch'
      : travelMode === 'office' ? 'office'
      : travelMode === 'job' ? 'job'
      : 'materials'

    const { data, error } = await supabase
      .schema('pmms')
      .from('activity_log')
      .insert({
        staff_id: profile.id,
        activity_type: activityType,
        activity_category: category,
        note,
        started_at: new Date().toISOString(),
        started_lat: position?.latitude ?? null,
        started_lng: position?.longitude ?? null,
        ticket_id: inProgressTicket?.id ?? null,
        destination_ticket_id: travelMode === 'job' ? destinationId : null,
      })
      .select('id, activity_type, activity_category, note, started_at, destination_ticket_id, ticket_id')
      .single()

    setStartingActivity(false)
    if (error) { setActivityError(error.message); return }
    setOpenActivity(data)
    // Lands him straight on the picked job's own Arrived screen, same as
    // tapping directly into any other job -- generic Away flows (materials/
    // office/lunch) have no specific ticket to jump to, so selectedTicket
    // stays whatever it already was.
    if (destinationTicket) setSelectedTicket(destinationTicket)
    setPage('jobs')
  }

  function addReceiptRow() {
    setReceiptRows(prev => [...prev, { photoFile: null, amount: '' }])
  }
  function updateReceiptRow(index, field, value) {
    setReceiptRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }
  function removeReceiptRow(index) {
    setReceiptRows(prev => prev.filter((_, i) => i !== index))
  }

  async function handleEndActivity() {
    setEndingActivity(true)

    // Optional -- only ever present on a 'materials' trip, and only for
    // rows the builder actually filled in (a photo and/or an amount; a row
    // added then left completely empty is silently skipped rather than
    // inserted as a blank receipt). Uploaded before the position fetch so
    // a failed upload doesn't burn a GPS fix for nothing.
    const rowsToLog = receiptRows.filter(row => row.photoFile || row.amount.trim() !== '')
    const uploadedReceipts = []
    for (const row of rowsToLog) {
      let photoUrl = null
      if (row.photoFile) {
        try {
          const compressed = await compressImage(row.photoFile)
          const path = `receipts/${profile.id}/${Date.now()}-${compressed.name}`
          await uploadFileWithProgress('ticket-photos', path, compressed)
          photoUrl = await getSignedUrl('ticket-photos', path)
        } catch (uploadErr) {
          setEndingActivity(false)
          setActivityError(uploadErr.message)
          return
        }
      }
      uploadedReceipts.push({ photo_url: photoUrl, amount: row.amount.trim() !== '' ? Number(row.amount) : null })
    }

    const position = await getCurrentPositionSafe()

    const { error } = await supabase
      .schema('pmms')
      .from('activity_log')
      .update({ ended_at: new Date().toISOString(), ended_lat: position?.latitude ?? null, ended_lng: position?.longitude ?? null })
      .eq('id', openActivity.id)

    if (error) {
      setEndingActivity(false)
      setActivityError(error.message)
      return
    }

    if (uploadedReceipts.length > 0) {
      await supabase.schema('pmms').from('activity_receipts').insert(
        uploadedReceipts.map(r => ({
          activity_log_id: openActivity.id, ticket_id: openActivity.ticket_id ?? null, staff_id: profile.id,
          photo_url: r.photo_url, amount: r.amount,
        }))
      )
    }

    setEndingActivity(false)
    setOpenActivity(null)
    setReceiptRows([])
  }

  async function handleClockIn(transitStart, milesLogged) {
    if (tickets.some(t => t.status === 'In Progress' && t.id !== selectedTicket.id)) return
    setClockInError('')
    setClockingIn(true)
    const position = await getCurrentPositionSafe()
    if (!position) {
      setClockingIn(false)
      setClockInError("Couldn't get your location. Make sure location is turned on and you have signal, then try again.")
      return
    }

    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status

    // long_running_job_alert_sent_at reset here and on resume (see
    // handleResumeWork) -- every fresh In Progress stretch starts its own
    // check-long-running-jobs window, same reasoning as
    // long_break_alert_sent_at in handlePause.
    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({ status: 'In Progress', status_changed_at: now, stuck_alert_sent_at: null, long_running_job_alert_sent_at: null, mileage_logged: milesLogged, transit_start: transitStart, mileage_logged_at: now })
      .eq('id', selectedTicket.id)

    if (ticketError) {
      console.error('Failed to update ticket on clock-in:', ticketError)
      setClockingIn(false)
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

    // Defensive, not load-bearing under current code -- picking a
    // destination under "Going to Another Job" no longer writes a travel
    // record at all (see handleStartActivity), so openActivity should
    // never actually be set here. Kept as insurance against a stale
    // cached app bundle creating one the old way: found live 2026-08-19,
    // a builder's session ran the pre-fix code long enough to create one
    // of these, then picked up the current code before actually
    // arriving -- with no closing logic left anywhere at that point, it
    // stayed open forever and showed him as permanently "Away" despite
    // being on the job. Costs nothing when openActivity is null (the
    // normal case), and prevents this exact stuck state if it isn't.
    if (openActivity?.activity_type === 'Travel' && openActivity.activity_category === 'job' && openActivity.destination_ticket_id === selectedTicket.id) {
      await supabase
        .schema('pmms')
        .from('activity_log')
        .update({ ended_at: now, ended_lat: position?.latitude ?? null, ended_lng: position?.longitude ?? null })
        .eq('id', openActivity.id)
      setOpenActivity(null)
    }

    // idleSince is captured from the render that created this closure, i.e.
    // the moment right before this job started -- see computeIdleSince.
    if (idleSince) {
      const idleSeconds = Math.max(0, Math.floor((Date.now() - new Date(idleSince).getTime()) / 1000))
      if (idleSeconds >= 60) {
        await postAuditEvent(selectedTicket.id, 'Status Changed', `Idle for ${formatElapsed(idleSeconds)} before starting this job`)
      }
    }

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → In Progress (logged)`)

    await fetchTickets()
    setSelectedTicket(prev => ({ ...prev, status: 'In Progress' }))
    // Only cleared at the very end -- the button (disabled while this is
    // true) must stay locked for the ticket update + work_sessions insert
    // above too, not just the GPS fetch. Clearing it right after the GPS
    // fetch left a window where a fast double-tap on the button fired this
    // whole function twice, inserting two work_sessions rows for the same
    // clock-in that a later clock-out then both closed at once -- found
    // live on a real ticket, its "Total Time" roughly doubled as a result.
    setClockingIn(false)
  }

  function addMaterialsUsedRow() {
    setMaterialsUsedRows(prev => [...prev, { name: '', quantity: '' }])
  }

  function updateMaterialsUsedRow(index, field, value) {
    setMaterialsUsedRows(prev => prev.map((row, i) => i === index ? { ...row, [field]: value } : row))
  }

  function removeMaterialsUsedRow(index) {
    setMaterialsUsedRows(prev => prev.filter((_, i) => i !== index))
  }

  async function handleComplete(note, mediaFiles, checklistResponses, needsFollowup, followupNote) {
    setCompleteError('')

    if (!note || !note.trim()) {
      setCompleteError('Please add a note describing the completed work.')
      return
    }

    if (!mediaFiles || mediaFiles.length === 0) {
      setCompleteError('Please add at least one photo or video of the completed work before closing this ticket.')
      return
    }

    setCompleteSubmitting(true)

    let photoUrl = null
    try {
      // stage: 'completed' keeps these apart from whatever the ticket was
      // raised with -- same ticket_attachments table, filtered by stage on
      // every reader (TicketAttachmentGallery), so "what he reported" and
      // "what he did to fix it" never mix in the same gallery.
      const urls = await uploadTicketAttachments(mediaFiles, selectedTicket.id, profile.id, {
        onProgress: setCompleteUploadProgress,
        attachmentStage: 'completed',
      })
      photoUrl = urls[0] ?? null
    } catch (uploadErr) {
      setCompleteSubmitting(false)
      setCompleteUploadProgress(null)
      setCompleteError(uploadErr.message)
      return
    }
    setCompleteUploadProgress(null)

    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status
    const position = await getCurrentPositionSafe()

    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        status: 'Completed', status_changed_at: now, stuck_alert_sent_at: null, completed_at: now,
        completion_note: note.trim(), completion_photo_url: photoUrl,
        needs_followup: !!needsFollowup, followup_note: needsFollowup ? (followupNote || null) : null,
        ...(checklistResponses ? { checklist_responses: checklistResponses } : {}),
      })
      .eq('id', selectedTicket.id)

    // The photo/video is already uploaded by this point (see the try/catch
    // above) -- if the status update itself fails (dropped connection, RLS
    // hiccup), stop here rather than carrying on as if the job closed. The
    // overlay stays open with the note/photos still attached so a retry
    // doesn't need re-entering anything.
    if (ticketError) {
      console.error('Failed to complete ticket:', ticketError)
      setCompleteSubmitting(false)
      setCompleteError("Couldn't save -- check your connection and try again.")
      return
    }

    // Close the loop with whoever raised it -- not just the assigned-to
    // notifications this app already sends. Skip self-notifying a builder
    // who raised and completed their own ticket.
    if (selectedTicket.raised_by && selectedTicket.raised_by !== profile.id) {
      await sendPushNotification([selectedTicket.raised_by], 'Ticket completed', `Job #${selectedTicket.ticket_number} — ${selectedTicket.property?.address || 'your reported issue'} has been marked completed.`)
    }

    await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: now, clock_out_lat: position?.latitude ?? null, clock_out_lng: position?.longitude ?? null })
      .eq('ticket_id', selectedTicket.id)
      .is('ended_at', null)

    // Completing a job always starts a fresh idle stretch -- reset the
    // guard so check-idle-builders can alert again for this one, not stay
    // silenced by a guard left over from earlier in the shift.
    if (todayShift) {
      await supabase.schema('pmms').from('daily_attendance').update({ idle_alert_sent_at: null }).eq('id', todayShift.id)
    }

    // Gardens tracking: a completed garden-related job stamps the property's
    // "last attended" record automatically -- the only path for a staff visit,
    // since a contractor visit (no PMMS login) has to be entered by hand on
    // the property's Gardens tab instead. Deliberately doesn't touch
    // garden_state or the front/back photos here -- there's no reliable way
    // to know which of the two a single completion photo represents.
    const isGardenJob = selectedTicket.category === 'Grounds & External Works' &&
      ['Garden maintenance', 'Tree/hedge trimming', 'Grass cutting'].includes(selectedTicket.issue_tag)
    if (isGardenJob) {
      // Builders only have SELECT on pmms.properties -- this goes through a
      // security-definer function that verifies server-side this is really
      // the builder's own garden job before stamping the property, rather
      // than granting broad property UPDATE access just for this.
      await supabase.schema('pmms').rpc('complete_garden_ticket_property_update', {
        p_ticket_id: selectedTicket.id,
        p_attended_by: profile.name,
      })
    }

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → Completed — ${note.trim()}`)

    // Optional -- what this job actually used. Name is free text, quantity
    // is a real number (see alter_ticket_materials_used_quantity_numeric.sql
    // -- was free text, let letters through where only a count made sense).
    // Rows left completely blank are silently skipped, same convention as
    // the receipts rows on "I'm Back".
    const materialsToLog = materialsUsedRows.filter(row => row.name.trim() !== '')
    if (materialsToLog.length > 0) {
      await supabase.schema('pmms').from('ticket_materials_used').insert(
        materialsToLog.map(row => ({
          ticket_id: selectedTicket.id, staff_id: profile.id,
          name: row.name.trim(), quantity: row.quantity.trim() !== '' ? Number(row.quantity) : 1,
        }))
      )
      setMaterialsUsedRows([])
    }

    setCompleteSubmitting(false)
    await fetchTickets()
    setSelectedTicket(null)
  }

  // keepLocked: true for the 3 short-trip Stop reasons (Going to the
  // Office / Lunch Break / Getting materials myself) -- the builder stays
  // on this same ticket, now showing the break timer, instead of being
  // released back to the job list. Everything else about the pause is
  // identical regardless of which reason it is.
  // Returns { error } rather than throwing -- handleStop (the only caller)
  // needs to know whether to keep the Stop sheet open and show something,
  // instead of closing it and silently leaving the ticket in whatever
  // state it was already in.
  async function handlePause(reason, note, { keepLocked = false } = {}) {
    const now = new Date().toISOString()
    const ticket = selectedTicket
    const previousStatus = ticket.status
    const position = await getCurrentPositionSafe()

    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      // long_break_alert_sent_at reset here, not just on Resume -- every
      // fresh pause starts its own break, so a repeat short trip gets its
      // own alert window instead of being silently covered by a guard left
      // over from days ago (see check-long-breaks Edge Function).
      .update({ status: 'On Hold', status_changed_at: now, stuck_alert_sent_at: null, long_break_alert_sent_at: null, hold_reason: reason, hold_note: note })
      .eq('id', ticket.id)

    if (ticketError) {
      console.error('Failed to pause ticket:', ticketError)
      return { error: ticketError }
    }

    await supabase
      .schema('pmms')
      .from('work_sessions')
      .update({ ended_at: now, clock_out_lat: position?.latitude ?? null, clock_out_lng: position?.longitude ?? null })
      .eq('ticket_id', ticket.id)
      .is('ended_at', null)

    // Only for a genuine idle-causing pause -- the 3 short trips (keepLocked)
    // already have their own break-alert guard (long_break_alert_sent_at
    // above); this one is specifically for check-idle-builders.
    if (todayShift && !SHORT_TRIP_REASONS.includes(reason)) {
      await supabase.schema('pmms').from('daily_attendance').update({ idle_alert_sent_at: null }).eq('id', todayShift.id)
    }

    await postAuditEvent(ticket.id, 'Status Changed', `${previousStatus} → On Hold (${reason}${note ? ' — ' + note : ''})`)

    if (reason === 'Unable to Do the Job') {
      await notifyUnableToDo(ticket, note)
    }

    await fetchTickets()
    if (keepLocked) {
      setSelectedTicket(prev => (prev ? { ...prev, status: 'On Hold', status_changed_at: now, hold_reason: reason, hold_note: note } : prev))
    } else {
      setSelectedTicket(null)
    }
    return { error: null }
  }

  // Instant push + in-app notification to whoever manages this ticket's
  // division, the moment a builder flags a job they can't do -- the whole
  // point is a manager finding out right away, not stumbling on it later
  // via the dashboard tile (see notifyUnableToDo's caller, and the new
  // "Unable to Do" KPI on AdminDashboard.jsx).
  async function notifyUnableToDo(ticket, note) {
    const division = maintenanceCategories[ticket.category]?.division || 'Maintenance'
    const managers = await fetchManagersForDivision(division)
    if (managers.length === 0) return

    const message = `Job #${ticket.ticket_number} flagged: ${profile.name} can't do this job${note ? ' — ' + note : ''}`
    for (const manager of managers) {
      await createNotification(manager.id, ticket.id, message)
    }
    await sendPushNotification(managers.map(m => m.id), 'Job flagged: Unable to Do', `#${ticket.ticket_number} — ${ticket.property?.address || 'a property'}`)
  }

  // Handles all 6 Stop-sheet outcomes -- see the Stop sheet's onClick
  // handlers, which are the only callers. "Job Completed" is the one
  // exception, handled by the existing completion flow instead (never
  // routes through here).
  async function handleStop(reason, note) {
    setStopSubmitting(true)
    setStopError('')
    const result = await handlePause(reason, note, { keepLocked: SHORT_TRIP_REASONS.includes(reason) })
    setStopSubmitting(false)
    if (result?.error) {
      setStopError("Couldn't save -- check your connection and try again.")
      return
    }
    setStopSheetOpen(false)
    setMaterialsAskOpen(false)
    setStopReasonPicked(null)
    setStopNote('')
  }

  async function handleReportDelay(reason, note) {
    setDelayReasonSubmitting(true)
    const now = new Date().toISOString()

    const { error } = await supabase
      .schema('pmms')
      .from('tickets')
      .update({
        delay_reason: reason, delay_reason_note: note, delay_reason_status: 'pending',
        delay_reason_submitted_at: now, delay_reason_reviewed_at: null, delay_reason_reviewed_by: null,
      })
      .eq('id', selectedTicket.id)

    setDelayReasonSubmitting(false)
    if (error) return

    await postAuditEvent(selectedTicket.id, 'Delay Reason Submitted', `${reason}${note ? ' — ' + note : ''} (awaiting manager review)`)

    setSelectedTicket(prev => ({ ...prev, delay_reason: reason, delay_reason_note: note, delay_reason_status: 'pending' }))
    setShowDelayReasonForm(false)
    setDelayReason(null)
    setDelayReasonNote('')
    await fetchTickets()
  }

  async function handleResumeWork(milesLogged) {
    if (tickets.some(t => t.status === 'In Progress' && t.id !== selectedTicket.id)) return
    setClockInError('')
    setClockingIn(true)
    const position = await getCurrentPositionSafe()
    if (!position) {
      setClockingIn(false)
      setClockInError("Couldn't get your location. Make sure location is turned on and you have signal, then try again.")
      return
    }

    const now = new Date().toISOString()
    const previousStatus = selectedTicket.status

    const { error: ticketError } = await supabase
      .schema('pmms')
      .from('tickets')
      // mileage_logged/mileage_logged_at mirror handleClockIn -- an on-hold
      // job resumed after a genuine trip away (materials ordered, unable to
      // do) can involve real travel, same as any other arrival now that the
      // job-ready mileage step is shared across every arrival path.
      .update({ status: 'In Progress', status_changed_at: now, stuck_alert_sent_at: null, long_running_job_alert_sent_at: null, hold_reason: null, hold_note: null, mileage_logged: milesLogged, transit_start: null, mileage_logged_at: now })
      .eq('id', selectedTicket.id)

    if (ticketError) {
      console.error('Failed to resume ticket:', ticketError)
      setClockingIn(false)
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

    // Only fires for a genuine idle resume -- computeIdleSince() already
    // returns null while this ticket is one of the 3 locked short trips,
    // since that already has its own breakElapsed clock and isn't "idle".
    if (idleSince) {
      const idleSeconds = Math.max(0, Math.floor((Date.now() - new Date(idleSince).getTime()) / 1000))
      if (idleSeconds >= 60) {
        await postAuditEvent(selectedTicket.id, 'Status Changed', `Idle for ${formatElapsed(idleSeconds)} before resuming`)
      }
    }

    await postAuditEvent(selectedTicket.id, 'Status Changed', `${previousStatus} → In Progress (resumed)`)

    await fetchTickets()
    setSelectedTicket(prev => ({ ...prev, status: 'In Progress', hold_reason: null, hold_note: null }))
    // See handleClockIn's matching comment -- stays locked through the
    // writes above, not just the GPS fetch, to prevent the same
    // double-tap-creates-two-sessions bug.
    setClockingIn(false)
  }

  async function handleSignOut() {
    // Logged here, before signOut() -- by the time the auth listener sees
    // the session go away, the token's already cleared and an insert from
    // there has no valid credentials (confirmed live: silent 401).
    await logLoginEvent(profile, profile.email, 'Signed Out')
    await supabase.auth.signOut()
  }

  function goHome() {
    closeTicket()
    setPage('jobs')
    setMenuOpen(false)
  }

  const ROOM_OPTIONS = ['Kitchen', 'Bathroom', 'Communal Area', 'Bedroom', 'Hallways / Stairs', 'Garden', 'Other Area...']

  const UNLISTED_MARKER_PREFIX = '__UNLISTED_FALLBACK__'

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

  const selectedTicketProperty = ticketProperties.find(p => String(p.id) === String(ticketPropertyId))

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
    setTicketMediaFiles([])
    setTicketDuplicateWarning(null)
    setTicketSubmitting(false)
    setTicketError('')
    setTicketSuccess(false)
    setComplianceCheckType(null)
    setComplianceResults([])
    setComplianceNotes([])
    setComplianceMediaFiles([])
    setComplianceMediaPreviews([])
    setComplianceSubmitting(false)
    setComplianceSuccess('')
  }

  async function fetchTicketProperties() {
    const { data, error } = await supabase
      .schema('pmms')
      .rpc('builder_properties')
      .order('address')

    if (!error) setTicketProperties(data)
  }

  async function fetchReportedTickets() {
    const { data, error } = await supabase
      .schema('pmms')
      .from('tickets')
      .select(`
        id, ticket_number, status, category, description, room, photo_url, created_at, property_id
      `)
      .eq('raised_by', profile.id)
      .order('created_at', { ascending: false })

    if (!error) setReportedTickets(await attachBuilderSafeProperties(data))
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

    if (ticketMediaFiles.length === 0) {
      setTicketError('Please add at least one photo or video of the issue before submitting.')
      return
    }

    const finalIssueTag = isUnlistedTag(ticketIssueTag) ? `[Unlisted: ${ticketCategory}] ${ticketIssueOther}` : ticketIssueTag
    const priorityScore = calculatePriorityScore(ticketCategory, ticketIssueTag) + (selectedTicketProperty?.high_vulnerability ? 30 : 0)
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
        status: 'Pending',
        raised_by: profile.id,
        raised_by_name: profile.name,
        created_at: new Date().toISOString(),
        status_changed_at: new Date().toISOString(),
      })
      .select('id, ticket_number')

    if (error) {
      setTicketSubmitting(false)
      setTicketError(error.message)
      return
    }

    if (ticketMediaFiles.length > 0) {
      try {
        const [firstUrl] = await uploadTicketAttachments(ticketMediaFiles, data[0].id, profile.id, { onProgress: setTicketUploadProgress })
        await supabase.schema('pmms').from('tickets').update({ photo_url: firstUrl }).eq('id', data[0].id)
      } catch (uploadErr) {
        setTicketSubmitting(false)
        setTicketUploadProgress(null)
        setTicketError(uploadErr.message)
        return
      }
    }

    setTicketSubmitting(false)
    setTicketUploadProgress(null)

    if (priorityTierLabel(priorityScore, p1Threshold, p2Threshold) === 'P1 Critical') {
      const division = maintenanceCategories[ticketCategory]?.division || 'Maintenance'
      await pushEmergencyAlert(
        { ticket_number: data[0].ticket_number, category: ticketCategory, property: selectedTicketProperty },
        division
      )
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

    const selectedType = complianceCheckTypes.find(t => t.name === complianceCheckType)
    const items = selectedType?.items || []
    const vulnBonus = selectedTicketProperty?.high_vulnerability ? 30 : 0
    const failedItems = items
      .map((item, idx) => ({ ...item, result: complianceResults[idx], note: complianceNotes[idx], mediaFile: complianceMediaFiles[idx] }))
      .filter(i => i.result === 'Fail')

    // Checked up front, before any ticket is created, so this never ends
    // up with some failed items submitted and others blocked partway
    // through the loop below.
    if (failedItems.some(i => !i.mediaFile)) {
      setTicketError('Please add a photo for every failed item before submitting.')
      return
    }

    setComplianceSubmitting(true)
    setTicketError('')

    for (const failedItem of failedItems) {
      const category = selectedType?.category || 'Other / Unlisted Trade'
      const score = failedItem.score + vulnBonus
      const description = `[Compliance Failure: ${complianceCheckType}] ${failedItem.label}${failedItem.note ? ' — ' + failedItem.note : ''}`

      let photoUrl = null
      if (failedItem.mediaFile) {
        // This field can be either a photo or a video, per the input's
        // accept attr -- compressImage is a no-op for video, compressVideo
        // is a no-op for photos, so exactly one of the two actually runs.
        const isVideo = failedItem.mediaFile.type.startsWith('video/')
        let path
        try {
          const compressedMedia = isVideo
            ? await compressVideo(failedItem.mediaFile, { onProgress: pct => setComplianceUploadProgress({ index: 1, total: 1, stage: 'compressing', pct }) })
            : await compressImage(failedItem.mediaFile)
          path = `${profile.id}/${Date.now()}-${compressedMedia.name}`
          await uploadFileWithProgress('ticket-photos', path, compressedMedia, pct => setComplianceUploadProgress({ index: 1, total: 1, stage: 'uploading', pct }))
        } catch (uploadErr) {
          setComplianceSubmitting(false)
          setComplianceUploadProgress(null)
          setTicketError(`Media upload failed: ${uploadErr.message}`)
          return
        }
        photoUrl = await getSignedUrl('ticket-photos', path)
        setComplianceUploadProgress(null)
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
          status: 'Pending',
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

      if (priorityTierLabel(score, p1Threshold, p2Threshold) === 'P1 Critical') {
        const division = maintenanceCategories[category]?.division || 'Maintenance'
        await pushEmergencyAlert(
          { ticket_number: data[0].ticket_number, category, property: selectedTicketProperty },
          division
        )
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
    if (status === 'Pending')     return COLORS.red600
    if (status === 'In Progress') return COLORS.teal600
    if (status === 'On Hold')     return COLORS.amber600
    if (status === 'Completed')   return COLORS.green600
    return COLORS.blue500
  }

  // Display-only -- see admin/shared.jsx's statusLabel for why this is
  // duplicated locally rather than imported (this file's own convention).
  const statusLabel = (status) => (status === 'Pending' ? 'Unassigned' : status)

  const inProgressTickets = tickets.filter(t => t.status === 'In Progress')
  const activeTicket = inProgressTickets[0] || null
  // Whichever ticket has the builder "locked" to it right now -- either
  // actually running (In Progress) or on one of the 3 short, timed trips
  // (see SHORT_TRIP_REASONS). Everywhere the app would otherwise let a
  // builder leave a ticket (Back button, the header logo, tapping another
  // job, tapping a notification) is guarded through openTicket/closeTicket
  // below instead of setSelectedTicket directly, so it always redirects
  // back to this one job until Stop resolves it -- see the Focus Mode
  // proposal ("Builder v.2") this implements.
  const onBreakTicket = tickets.find(t => t.status === 'On Hold' && SHORT_TRIP_REASONS.includes(t.hold_reason)) || null
  const lockedTicket = activeTicket || onBreakTicket || null

  // Of the 3 short trips, only these two are genuinely a driving errand --
  // "Lunch Break" stays a single-button resume with no mileage step, but
  // "Getting materials myself" and "Going to the Office" get the same
  // mileage stepper the real On Hold / fresh-arrival resume already uses,
  // since that round trip is real, trackable mileage the report was
  // otherwise silently losing (mileage_logged was never touched on these
  // two resumes before -- handleResumeWork() was just called with no
  // argument at all).
  const shortTripNeedsMileage = !!selectedTicket && SHORT_TRIP_REASONS.includes(selectedTicket.hold_reason) && selectedTicket.hold_reason !== 'Lunch Break'

  const isIdle = inProgressTickets.length === 0 && !lockedTicket

  // "Idle since" -- the moment he stopped actively working, if he's not on
  // any job or (for the 3 short trips) locked to one. Reused for both the
  // running clock below and the idle-duration line posted the moment he
  // starts his next job (see handleClockIn/handleResumeWork), so what he
  // sees live and what ends up in the log always agree. A plain function
  // (not a hook) so those handlers, defined earlier in this file, can call
  // it too -- closures don't care about textual order within the component.
  function computeIdleSince() {
    if (inProgressTickets.length > 0 || lockedTicket) return null
    if (openActivity) return openActivity.started_at
    const stopTimes = tickets
      .filter(t => t.status === 'Completed' || (t.status === 'On Hold' && !SHORT_TRIP_REASONS.includes(t.hold_reason)))
      .map(t => t.status_changed_at)
      .filter(Boolean)
      .sort()
    const lastStop = stopTimes.slice(-1)[0] || null
    const clockInAt = todayShift?.clock_in_at || null
    // Never earlier than today's own clock-in -- found live: Craig put a
    // job on hold Friday afternoon ("coming back the next working day"),
    // then resumed it Monday morning, and this posted "Idle for 87h 46m"
    // -- the entire weekend, when he simply wasn't clocked in at all, not
    // idle. A leftover stop time from a previous shift/day is never a
    // meaningful "how long have I been idle" reference once a fresh
    // clock-in has happened since.
    if (lastStop && clockInAt) return lastStop > clockInAt ? lastStop : clockInAt
    return lastStop || clockInAt
  }

  const idleSince = computeIdleSince()

  useEffect(() => {
    if (!idleSince) { setIdleElapsed(0); return }
    setIdleElapsed(Math.max(0, Math.floor((Date.now() - new Date(idleSince).getTime()) / 1000)))
    const interval = setInterval(() => setIdleElapsed(prev => prev + 1), 1000)
    return () => clearInterval(interval)
  }, [idleSince])

  // Without this, the guards in openTicket/closeTicket only stop someone
  // *leaving* an already-open lock screen -- a fresh login or page refresh
  // with a job already running would land on the ordinary dashboard
  // first (selectedTicket starts null) and never force Focus Mode open at
  // all. This keeps selectedTicket in sync with lockedTicket on every
  // render, not just at the moment a user taps something, so refreshing
  // mid-job (or mid-break) always lands straight back on the lock screen.
  useEffect(() => {
    if (lockedTicket && selectedTicket?.id !== lockedTicket.id) setSelectedTicket(lockedTicket)
  }, [lockedTicket?.id, lockedTicket?.status, lockedTicket?.hold_reason])

  function openTicket(t) {
    setSelectedTicket(lockedTicket || t)
  }
  function closeTicket() {
    // A "Start Travelling" tap on leaving-job-confirm opens a real
    // activity_log row for this destination (see handleStartActivity) --
    // backing out here without ever tapping "Arrived -- Start Work" would
    // leave it open forever if not closed. Fire-and-forget, same as the
    // rest of this function -- handleEndActivity() only touches
    // openActivity/receiptRows (empty for a 'job' leg) and never
    // navigates, so it can't race with setSelectedTicket below. Guarded to
    // this exact destination + still-Assigned so it never double-handles
    // a job handleClockIn already closed and moved to In Progress.
    if (!lockedTicket && selectedTicket?.status === 'Assigned' && openActivity?.activity_category === 'job' && openActivity.destination_ticket_id === selectedTicket.id) {
      handleEndActivity()
    }
    setSelectedTicket(lockedTicket || null)
  }

  const isRoutineVisit = selectedTicket?.category === 'Cleaning Rota' && selectedTicket?.issue_tag === 'Routine 2-Week Visit'
  const checklistIncomplete = isRoutineVisit && routineVisitChecklistTemplate.some(item => !checklistChecked[item])
  const urgentTickets = tickets.filter(t => t.status === 'Assigned' && t.priority_score >= p1Threshold)
  const toDoTickets = tickets.filter(t => t.status === 'Assigned' && t.priority_score < p1Threshold)
  const onHoldTickets = tickets.filter(t => t.status === 'On Hold')
  const doneTickets = tickets.filter(t => t.status === 'Completed')

  // 'ALL' is the main dashboard's default view -- a completed job has
  // nothing left to action, so it's excluded here to keep this list to what
  // the builder still needs to do. Still reachable via the "Done" filter/
  // tile above, or from their own profile page.
  const filteredTickets =
    statusFilter === 'WORKING' ? inProgressTickets :
    statusFilter === 'URGENT' ? urgentTickets :
    statusFilter === 'TODO'   ? toDoTickets :
    statusFilter === 'HOLD'   ? onHoldTickets :
    statusFilter === 'DONE'   ? doneTickets :
    tickets.filter(t => t.status !== 'Completed')

  // "Closest to you" -- a nudge, not a reorder (see the Builder v.2
  // guide's step 9): the main list below stays exactly as it always was,
  // priority first. This just surfaces the 1-2 remaining assigned jobs
  // nearest to wherever the builder most recently stopped, using the same
  // straight-line-times-multiplier estimate AdminClocking.jsx already
  // shows managers for travel mileage.
  const recentlyLeftTicket = [...tickets]
    .filter(t => (t.status === 'Completed' || t.status === 'On Hold') && t.property?.latitude != null && t.property?.longitude != null)
    .sort((a, b) => new Date(b.status_changed_at || 0) - new Date(a.status_changed_at || 0))[0] || null

  const nearbyJobs = (() => {
    if (!recentlyLeftTicket) return []
    const candidates = [...urgentTickets, ...toDoTickets].filter(t => t.property?.latitude != null && t.property?.longitude != null)
    return candidates
      .map(t => ({
        ticket: t,
        miles: metresToMiles(distanceMetres(
          recentlyLeftTicket.property.latitude, recentlyLeftTicket.property.longitude,
          t.property.latitude, t.property.longitude,
        )) * ROAD_DISTANCE_MULTIPLIER,
      }))
      .sort((a, b) => a.miles - b.miles)
      .slice(0, 2)
  })()

  // Same estimate as nearbyJobs above, reused for the mileage pill shown
  // against each result on the "Going to Another Job" search page --
  // origin is wherever the builder most recently stopped, not a live GPS
  // read, matching the existing convention. Before their first
  // completed/held job of the day there's no "recently left" property to
  // measure from -- falls back to where they clocked in this morning
  // (already captured, see handleClockInForDay) rather than showing no
  // estimate at all for the whole first half of the day.
  function estimateMilesTo(ticket) {
    if (ticket.property?.latitude == null || ticket.property?.longitude == null) return null
    const origin = recentlyLeftTicket?.property
      ?? (todayShift?.clock_in_lat != null && todayShift?.clock_in_lng != null
        ? { latitude: todayShift.clock_in_lat, longitude: todayShift.clock_in_lng }
        : null)
    if (!origin) return null
    return metresToMiles(distanceMetres(
      origin.latitude, origin.longitude,
      ticket.property.latitude, ticket.property.longitude,
    )) * ROAD_DISTANCE_MULTIPLIER
  }

  const mileageTickets = mileageAllTickets
    .slice()
    .sort((a, b) => new Date(b.mileage_logged_at) - new Date(a.mileage_logged_at))

  const totalMiles = mileageTickets.reduce((sum, t) => sum + t.mileage_logged, 0)

  const thisMonth = new Date()
  // Filtered by mileage_logged_at (when the trip was actually made), not
  // created_at (when the ticket was raised) -- those can land in different
  // months for the same ticket (e.g. raised in July, travelled to in
  // August), which is exactly why this "This month" tile could disagree
  // with the admin-side Staff profile's own mileage total, which has
  // always used mileage_logged_at. Found live 2026-08-24.
  const monthMiles = mileageTickets
    .filter(t => {
      const d = new Date(t.mileage_logged_at)
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

  // Which floor is a nice-to-have, not a blocker -- most properties don't
  // have real Floor Layout data entered yet (see PropertyCoreTab.jsx), so
  // forcing a Ground/First Floor guess out of whoever's raising the ticket
  // just to get past this step isn't worth it. Room itself is still
  // required; floor context is optional extra detail if they know it.
  const ticketStep2Complete = ticketRoom === 'Other Area...'
    ? !!ticketOtherArea.trim()
    : !!ticketRoom

  const ticketStep4Complete = !!ticketIssueTag && (!isUnlistedTag(ticketIssueTag) || !!ticketIssueOther.trim())

  if (loading || shiftLoading) return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100 }}>
      <p style={{ color: COLORS.slate400, fontWeight: 600, fontFamily: 'system-ui' }}>Loading your jobs...</p>
    </div>
  )

  // Takes priority over the normal clock-in gate below -- a stale shift
  // means there's nothing a fresh clock-in would fix; a manager has to
  // close the old one first (see fetchTodayShift for the staleness rule).
  // Director-approved: no self-service way past this, and deliberately no
  // automatic clock-out on the old shift either.
  if (staleShift) return (
    <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
      <div style={{ width: '100%', maxWidth: '360px', background: COLORS.white, borderRadius: '20px', padding: '28px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
        <img src={gbchLogo} alt="GBCH" style={{ height: '44px', marginBottom: '16px' }} />
        <p style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: COLORS.amber800 }}>⚠ Waiting on your manager</p>
        <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate600, lineHeight: 1.5 }}>
          Your shift from {formatUKDate(staleShift.work_date)} (clocked in {formatUKDateTime(staleShift.clock_in_at)}) was never closed out. A manager's been notified and needs to close it before you can clock in today.
        </p>
        <button onClick={fetchTodayShift} style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
          Check again
        </button>
        <button onClick={handleSignOut} style={{ marginTop: '18px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>
          Sign out
        </button>
      </div>
    </div>
  )

  // Gates the whole dashboard -- no job list, no other pages -- until the
  // builder clocks in for the day. Directors' call: they couldn't tell
  // where a builder was or whether they'd started work, so the day itself
  // now has its own clock-in, separate from (and required before) clocking
  // into any individual job.
  //
  // Which of their own assigned jobs' properties to offer under "A
  // Property" -- builders have no general property directory access (see
  // attachBuilderSafeProperties), so this is deliberately scoped to
  // properties they already have a reason to be at, not a full list.
  const gatePropertyOptions = [...new Map(
    tickets.filter(t => t.property_id && t.property?.address).map(t => [t.property_id, { id: t.property_id, address: t.property.address }])
  ).values()]

  if (!todayShift) {
    const greeting = <>
      <img src={gbchLogo} alt="GBCH" style={{ height: '44px', marginBottom: '16px' }} />
      <p style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'}, {profile.name.split(' ')[0]}</p>
    </>

    let inner
    if (gateStep === 'pick-job') {
      const assigned = tickets.filter(t => t.status === 'Assigned')
      inner = (
        <>
          {greeting}
          <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>Which job?</p>
          {assigned.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No assigned jobs to pick from.</p>
          ) : (
            <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', overflow: 'hidden', background: COLORS.white, textAlign: 'left', maxHeight: '280px', overflowY: 'auto' }}>
              {assigned.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => { setGateLocationTicketId(t.id); setGateStep('confirm') }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: i < assigned.length - 1 ? `1px solid ${COLORS.slate200}` : 'none', background: COLORS.white, cursor: 'pointer' }}
                >
                  <span style={{ display: 'block', fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#{t.ticket_number} · {t.category}</span>
                  <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 800, color: COLORS.slate900, marginTop: '2px' }}>{t.property?.address}</span>
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
        </>
      )
    } else if (gateStep === 'pick-property') {
      inner = (
        <>
          {greeting}
          <p style={{ margin: '0 0 12px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>Which property?</p>
          {gatePropertyOptions.length === 0 ? (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic' }}>No properties from your current jobs to pick from.</p>
          ) : (
            <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', overflow: 'hidden', background: COLORS.white, textAlign: 'left', maxHeight: '280px', overflowY: 'auto' }}>
              {gatePropertyOptions.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => { setGateLocationPropertyId(p.id); setGateLocationPropertyAddress(p.address); setGateStep('confirm') }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: i < gatePropertyOptions.length - 1 ? `1px solid ${COLORS.slate200}` : 'none', background: COLORS.white, cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}
                >
                  {p.address}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
        </>
      )
    } else if (gateStep === 'confirm') {
      const isOther = gateLocationType === 'other'
      const label = gateLocationType === 'office' ? 'The Office'
        : gateLocationType === 'job' ? (() => { const t = tickets.find(x => x.id === gateLocationTicketId); return t ? `Job #${t.ticket_number} — ${t.property?.address}` : 'A Job' })()
        : gateLocationType === 'property' ? gateLocationPropertyAddress
        : 'Other'
      inner = (
        <>
          {greeting}
          <div style={{ background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, borderRadius: '10px', padding: '12px 14px', margin: '0 0 16px 0', textAlign: 'left' }}>
            <p style={{ margin: 0, fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Clocking in from</p>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>{label}</p>
          </div>
          {isOther && (
            <input
              type="text"
              autoFocus
              value={gateOtherNote}
              onChange={(e) => setGateOtherNote(e.target.value)}
              placeholder="Describe where you are..."
              style={{ width: '100%', padding: '13px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '16px' }}
            />
          )}
          <button
            onClick={handleClockInForDay}
            disabled={clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))}
            style={{ width: '100%', padding: '16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: (clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))) ? 'not-allowed' : 'pointer', opacity: (clockingInForDay || (isOther && !hasMeaningfulNote(gateOtherNote))) ? 0.7 : 1 }}
          >
            {clockingInForDay ? 'Getting your location…' : '✓ Clock In for the Day'}
          </button>
          {clockInForDayError && <p style={{ margin: '12px 0 0 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInForDayError}</p>}
          <button onClick={() => setGateStep('choose')} style={{ marginTop: '16px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>← Back</button>
        </>
      )
    } else {
      inner = (
        <>
          {greeting}
          <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: COLORS.slate500, lineHeight: 1.5 }}>Where are you clocking in from?</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              { type: 'office', label: '🏢 The Office' },
              { type: 'job', label: '🔧 A Job' },
              { type: 'property', label: '🏘️ A Property' },
              { type: 'other', label: '📍 Other' },
            ].map(o => (
              <button
                key={o.type}
                onClick={() => { setGateLocationType(o.type); setGateStep(o.type === 'job' ? 'pick-job' : o.type === 'property' ? 'pick-property' : 'confirm') }}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, boxSizing: 'border-box' }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <button onClick={handleSignOut} style={{ marginTop: '18px', background: 'none', border: 'none', fontSize: '12px', color: COLORS.slate400, cursor: 'pointer', textDecoration: 'underline' }}>
            Sign out
          </button>
        </>
      )
    }

    return (
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', padding: '20px' }}>
        <div style={{ width: '100%', maxWidth: '360px', background: COLORS.white, borderRadius: '20px', padding: '28px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          {inner}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100%', background: COLORS.slate100, fontFamily: 'system-ui, sans-serif', paddingTop: 'var(--pmms-banner-offset, 0px)' }}>

      {/* Header -- unlike every other screen in this file, this one isn't
          `position: fixed`, so it can't just read the offset as `top`; the
          paddingTop above does the same job by pushing this whole page down
          instead. Missing this is exactly what let the impersonation banner
          cover the ☰ menu button here (found live, View As). */}
      <div style={{ position: 'sticky', top: 'var(--pmms-banner-offset, 0px)', zIndex: 10 }}>
        <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button
            onClick={goHome}
            aria-label="Go to home"
            style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
            <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button
              onClick={() => { setNotifPanelOpen(prev => !prev); setNotificationOpenError('') }}
              aria-label="Notifications"
              style={{ position: 'relative', background: 'none', border: 'none', padding: '8px', cursor: 'pointer', fontSize: '20px', lineHeight: 1 }}
            >
              🔔
              {notifications.some(n => !n.read) && (
                <span style={{
                  position: 'absolute', top: '4px', right: '4px', minWidth: '16px', height: '16px', padding: '0 3px',
                  borderRadius: '999px', background: COLORS.red600, color: COLORS.white, fontSize: '10px', fontWeight: 800,
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
              <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
            </button>
          </div>
        </div>

        {notifPanelOpen && (
          <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, maxHeight: '320px', overflowY: 'auto' }}>
            {notificationOpenError && (
              <p style={{ margin: 0, padding: '10px 20px', fontSize: '12.5px', fontWeight: 600, color: COLORS.amber800, background: COLORS.amber50, borderBottom: `1px solid ${COLORS.amber200}` }}>
                {notificationOpenError}
              </p>
            )}
            {notifications.length === 0 ? (
              <p style={{ margin: 0, padding: '20px', fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center' }}>No notifications yet.</p>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => {
                    if (!n.read) markNotificationRead(n.id)
                    const t = tickets.find(t => t.id === n.ticket_id)
                    if (t) {
                      openTicket(t)
                      setNotifPanelOpen(false)
                      setNotificationOpenError('')
                    } else {
                      // Most likely reassigned to someone else since the
                      // notification was created -- fetchTickets() only
                      // ever returns this builder's own current jobs, so a
                      // stale ticket_id just silently matched nothing
                      // before this, with no explanation at all.
                      setNotificationOpenError("This job isn't assigned to you anymore.")
                    }
                  }}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '12px 20px', border: 'none', borderBottom: `1px solid ${COLORS.slate100}`,
                    background: n.read ? COLORS.white : COLORS.blue50, cursor: 'pointer',
                  }}
                >
                  <p style={{ margin: '0 0 2px 0', fontSize: '13px', fontWeight: n.read ? 500 : 700, color: COLORS.slate900 }}>{n.message}</p>
                  <p style={{ margin: 0, fontSize: '11px', color: COLORS.slate400 }}>{new Date(n.created_at).toLocaleString('en-GB')}</p>
                </button>
              ))
            )}
          </div>
        )}

        {menuOpen && (
          <div style={{ background: COLORS.greenDark, padding: '20px' }}>
            <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
            <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {SHOW_LOG_TICKET_NAV && (
                <button
                  onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                >
                  📝 Log a Ticket
                </button>
              )}
              {SHOW_AVAILABLE_JOBS_NAV && (
                <button
                  onClick={() => { setPage('available-jobs'); setMenuOpen(false) }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span>🧰 Available Jobs</span>
                  {availableJobs.length > 0 && (
                    <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{availableJobs.length}</span>
                  )}
                </button>
              )}
              <button
                onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                📋 My Reports
              </button>
              <button
                onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                🕐 My Mileage
              </button>
              <button
                onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                📊 My Metrics
              </button>
              <button
                onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                <span>💬 Team Chat</span>
                {unreadMentions > 0 && (
                  <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
                )}
              </button>
              {pushNotificationsSupported() && (
                <button
                  onClick={handleEnableNotifications}
                  disabled={pushEnabled}
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: pushEnabled ? 'rgba(255,255,255,0.6)' : COLORS.white, cursor: pushEnabled ? 'default' : 'pointer', textAlign: 'left' }}
                >
                  🔔 {pushEnabled ? 'Notifications: On' : 'Enable Notifications'}
                </button>
              )}
              <button
                onClick={handleSignOut}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                🚪 Sign out
              </button>
            </div>
            {pushError && <p style={{ margin: '8px 4px 0 4px', fontSize: '12px', color: COLORS.red300 }}>{pushError}</p>}
          </div>
        )}
      </div>

      {/* Running idle clock -- deliberately at the very top, above the more
          detailed Away/idle banners below (which still show their own
          specifics and action buttons). The point of this one is just to
          be big and unmissable: he shouldn't have to wonder whether not
          working is being noticed -- see isIdle/computeIdleSince above,
          and the matching audit log line posted the moment he starts his
          next job. */}
      {isIdle && (
        <div style={{ maxWidth: '600px', margin: '10px auto 0 auto', padding: '0 16px' }}>
          <div style={{ background: openActivity ? COLORS.slate900 : COLORS.red600, borderRadius: '16px', padding: '18px 20px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {openActivity ? `Away — ${openActivity.activity_type === 'Travel' ? 'Travelling' : 'On break'}` : 'You have been doing nothing for:'}
            </p>
            <p style={{ margin: '0 0 4px 0', fontSize: '36px', fontWeight: 800, color: COLORS.white, fontFamily: 'monospace', letterSpacing: '0.02em' }}>{formatElapsed(idleElapsed)}</p>
            <p style={{ margin: 0, fontSize: '11px', fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>This is recorded, and your manager can see it.</p>
          </div>
        </div>
      )}

      {/* Day shift banner -- only ever reachable once past the daily
          clock-in gate above, so todayShift is always set here. */}
      <div style={{ maxWidth: '600px', margin: '10px auto 0 auto', padding: '0 16px' }}>
        {openActivity ? (() => {
          const destinationTicket = openActivity.destination_ticket_id ? tickets.find(t => t.id === openActivity.destination_ticket_id) : null
          return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', background: COLORS.violet100, border: `1px solid ${COLORS.violet500}`, borderRadius: '12px', padding: '10px 14px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.violet600 }}>
              🚶 Away — {openActivity.activity_type === 'Travel' ? 'Travelling' : 'On break'}{openActivity.note ? `: ${openActivity.note}` : ''} since {formatUKDateTime(openActivity.started_at).split(' ').slice(-1)[0]}
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              {destinationTicket && (
                <button
                  onClick={() => setSelectedTicket(destinationTicket)}
                  style={{ padding: '8px 14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ✓ Arrived — Start Job #{destinationTicket.ticket_number}
                </button>
              )}
              <button
                onClick={handleEndActivity}
                disabled={endingActivity}
                style={{ padding: '8px 14px', background: destinationTicket ? COLORS.white : COLORS.teal600, color: destinationTicket ? COLORS.slate600 : COLORS.white, border: destinationTicket ? `1px solid ${COLORS.slate200}` : 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: endingActivity ? 'not-allowed' : 'pointer', opacity: endingActivity ? 0.7 : 1 }}
              >
                {endingActivity ? 'Saving…' : "✓ I'm Back"}
              </button>
            </div>
          </div>
          {/* Purchase-side materials tracking -- optional, never blocks
              "I'm Back". Separate from the "Materials Used" picker on job
              completion (that one logs what was USED on a job, a sandbox
              stub that doesn't save anywhere yet; this logs what was
              BOUGHT on this trip, real and saved to activity_log). */}
          {openActivity.activity_category === 'materials' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '10px 14px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate500 }}>Receipts (optional -- one row per receipt)</span>
              {receiptRows.map((row, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <label style={{ padding: '7px 12px', background: row.photoFile ? COLORS.green100 : COLORS.slate100, color: row.photoFile ? COLORS.green700 : COLORS.slate600, borderRadius: '8px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}>
                    {row.photoFile ? '✓ Photo attached' : '📷 Add photo'}
                    <input type="file" accept="image/*" capture="environment" onChange={(e) => updateReceiptRow(index, 'photoFile', e.target.files[0] || null)} style={{ display: 'none' }} />
                  </label>
                  <input
                    type="number" min="0" step="0.01" placeholder="£ total"
                    value={row.amount}
                    onChange={(e) => updateReceiptRow(index, 'amount', e.target.value)}
                    style={{ width: '90px', padding: '7px 10px', borderRadius: '8px', border: `1px solid ${COLORS.slate200}`, fontSize: '12px', fontFamily: 'inherit' }}
                  />
                  <button
                    onClick={() => removeReceiptRow(index)}
                    aria-label="Remove receipt"
                    style={{ width: '30px', height: '30px', flexShrink: 0, border: 'none', background: COLORS.red100, color: COLORS.red600, borderRadius: '8px', fontSize: '13px', cursor: 'pointer' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={addReceiptRow}
                style={{ padding: '8px', borderRadius: '8px', border: `1px dashed ${COLORS.slate300}`, background: COLORS.slate50, color: COLORS.slate500, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
              >
                + Add {receiptRows.length > 0 ? 'another' : 'a'} receipt
              </button>
            </div>
          )}
          {activityError && <p style={{ margin: 0, fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
          </div>
          )
        })() : (
          <div style={{ background: todayShift.late_flag ? COLORS.amber50 : COLORS.slate50, border: `1px solid ${todayShift.late_flag ? COLORS.amber300 : COLORS.slate200}`, borderRadius: '12px', padding: '10px 14px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: todayShift.late_flag ? COLORS.amber900 : COLORS.slate600 }}>
              {todayShift.late_flag ? '⚠ ' : '🟢 '}Clocked in since {formatUKDateTime(todayShift.clock_in_at).split(' ').slice(-1)[0]}
              {(() => {
                const t = todayShift.clock_in_location_type
                if (t === 'office') return ' — the Office'
                if (t === 'job') { const j = tickets.find(x => x.id === todayShift.clock_in_location_ticket_id); return j ? ` — Job #${j.ticket_number}` : '' }
                if (t === 'property') { const j = tickets.find(x => x.property_id === todayShift.clock_in_location_property_id); return j?.property?.address ? ` — ${j.property.address}` : '' }
                if (t === 'other' && todayShift.clock_in_location_note) return ` — ${todayShift.clock_in_location_note}`
                return ''
              })()}
              {todayShift.late_flag && ` (${minutesLate(todayShift.clock_in_at, dailyClockInDeadline)}m late)`}
            </span>
            {/* Deliberately its own row, set apart with a divider and
                lighter weight -- found live that this sitting as a
                same-size button right next to "Leaving Site" led to a
                mis-tap that ended someone's whole day by accident.
                Clocking out is the rarer, bigger action, so it shouldn't
                look like an equal, casual choice next to a short trip. */}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${todayShift.late_flag ? COLORS.amber200 : COLORS.slate200}`, textAlign: 'right' }}>
              <button
                onClick={attemptClockOutForDay}
                disabled={clockingOutForDay}
                style={{ padding: '6px 4px', background: 'none', color: COLORS.slate500, border: 'none', fontSize: '12px', fontWeight: 700, textDecoration: 'underline', cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
              >
                {clockingOutForDay ? 'Clocking out…' : 'Clock Out for the Day'}
              </button>
            </div>
          </div>
        )}
        {clockOutForDayError && <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{clockOutForDayError}</p>}

        {/* Its own big, distinctly-coloured button -- indigo rather than any
            shade used by the metric tiles below, so it never reads as "just
            another tile". Full-width and unmissable, per the approved
            Leaving Site redesign. */}
        <button
          onClick={openActivityPicker}
          style={{ width: '100%', marginTop: '10px', padding: '22px 20px', background: COLORS.indigo700, color: COLORS.white, border: 'none', borderRadius: '16px', fontSize: '17px', fontWeight: 800, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', boxShadow: '0 6px 16px rgba(67,56,202,0.35)' }}
        >
          🚶 Leaving Site
          <span style={{ fontSize: '12px', fontWeight: 600, opacity: 0.85 }}>Log a trip, break, or head to your next job</span>
        </button>

        {clockOutConfirmOpen && (
          <div style={{ marginTop: '8px', background: COLORS.white, border: `1px solid ${COLORS.slate300}`, borderRadius: '12px', padding: '14px' }}>
            <p style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>Clock out for the day? This ends your whole shift, not just this job.</p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setClockOutConfirmOpen(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={() => { setClockOutConfirmOpen(false); submitClockOutForDay(null) }}
                disabled={clockingOutForDay}
                style={{ flex: 2, padding: '10px', background: COLORS.slate900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
              >
                {clockingOutForDay ? 'Clocking out…' : 'Yes, Clock Out'}
              </button>
            </div>
          </div>
        )}

        {earlyLeavePromptOpen && (
          <div style={{ marginTop: '8px', background: COLORS.white, border: `1px solid ${COLORS.amber300}`, borderRadius: '12px', padding: '14px' }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '13px', fontWeight: 800, color: COLORS.amber800 }}>⚠ You're finishing before {dailyClockOutDeadline}</p>
            <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.slate500 }}>Just so your manager knows why -- e.g. "all jobs done", "doctor's appointment".</p>
            <input
              type="text"
              value={earlyLeaveReason}
              onChange={(e) => setEarlyLeaveReason(e.target.value)}
              placeholder="Reason for finishing early..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '10px' }}
            />
            {clockOutForDayError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{clockOutForDayError}</p>}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => setEarlyLeavePromptOpen(false)} style={{ flex: 1, padding: '10px', background: COLORS.slate100, color: COLORS.slate600, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={submitEarlyLeave}
                disabled={clockingOutForDay}
                style={{ flex: 2, padding: '10px', background: COLORS.slate900, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: clockingOutForDay ? 'not-allowed' : 'pointer', opacity: clockingOutForDay ? 0.7 : 1 }}
              >
                {clockingOutForDay ? 'Clocking out…' : 'Confirm Clock Out'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Metric tiles -- Working On Now stays non-interactive (if it's
          non-zero the builder is already locked into that job's overlay
          and can't be looking at this screen anyway). The rest jump
          straight to something: Urgent/Done get their own small job lists
          below, To Do reuses the exact same "Going to Another Job" entry
          point as the green pill on the Leaving Site screen, On Hold
          already jumped to Resume Jobs. Urgent/To Do are disabled while
          away for the same reason On Hold already was -- jumping into a
          job while still marked away would leave that activity_log entry
          dangling; Done is a read-only history view, no such conflict. */}
      <div style={{ padding: '16px 16px 0 16px', maxWidth: '600px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box' }}>
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{inProgressTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Working On Now</div>
        </div>
        <button
          onClick={() => { if (!openActivity) setPage('urgent-jobs') }}
          disabled={!!openActivity}
          style={{ width: '100%', padding: '14px', background: COLORS.red500, color: COLORS.white, border: 'none', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box', cursor: openActivity ? 'default' : 'pointer' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{urgentTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Urgent</div>
        </button>
        {SHOW_AVAILABLE_JOBS_NAV && (
          <button
            onClick={() => setPage('available-jobs')}
            style={{ width: '100%', padding: '14px', background: COLORS.violet500, color: COLORS.white, border: 'none', borderRadius: '12px', cursor: 'pointer', textAlign: 'center' }}
          >
            <div style={{ fontSize: '28px', fontWeight: 800 }}>{availableJobs.length}</div>
            <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Available Jobs</div>
          </button>
        )}
        <button
          onClick={() => {
            if (openActivity) return
            setActivityType('Travel'); setTravelMode('job'); setDestinationTicketId(''); setJobSearchQuery(''); setActivityError('')
            setPickingForTravel(false)
            setPage('leaving-job')
          }}
          disabled={!!openActivity}
          style={{ width: '100%', padding: '14px', background: COLORS.blue500, color: COLORS.white, border: 'none', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box', cursor: openActivity ? 'default' : 'pointer' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{toDoTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>To do</div>
        </button>
        <button
          // Jumps straight to the same Resume Jobs screen the Leaving Site
          // pill opens, since On Hold jobs are exactly what that screen
          // lists. Disabled while away -- there's no path into Resume Jobs
          // at all while an activity is open.
          onClick={() => { if (!openActivity) setPage('leaving-resume') }}
          disabled={!!openActivity}
          style={{ width: '100%', padding: '14px', background: COLORS.amber500, color: COLORS.white, border: 'none', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box', cursor: openActivity ? 'default' : 'pointer' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{onHoldTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>On hold</div>
        </button>
        <button
          onClick={() => setPage('done-jobs')}
          style={{ width: '100%', padding: '14px', background: COLORS.slate500, color: COLORS.white, border: 'none', borderRadius: '12px', textAlign: 'center', boxSizing: 'border-box', cursor: 'pointer' }}
        >
          <div style={{ fontSize: '28px', fontWeight: 800 }}>{doneTickets.length}</div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Done</div>
        </button>

        {SHOW_JOB_LIST && (
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, fontSize: '14px', fontWeight: 700, color: COLORS.slate900, boxSizing: 'border-box', cursor: 'pointer' }}
          >
            <option value="ALL">All jobs</option>
            <option value="WORKING">🔧 Working now</option>
            <option value="URGENT">🚨 Urgent</option>
            <option value="TODO">📋 To do</option>
            <option value="HOLD">⏸ On hold</option>
            <option value="DONE">✓ Done</option>
          </select>
        )}
      </div>

      {/* Closest to you -- a nudge, not a reorder. The full list below is
          untouched (still priority first); this just calls out the 1-2
          remaining jobs nearest to wherever the builder most recently
          stopped, so an urgent-but-distant job never gets buried. */}
      {SHOW_NEARBY_JOBS && statusFilter === 'ALL' && nearbyJobs.length > 0 && (
        <div style={{ padding: '16px 16px 0', maxWidth: '600px', margin: '0 auto' }}>
          <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 800, color: COLORS.teal700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>📍 Closest to you</p>
          {nearbyJobs.map(({ ticket: t, miles }) => (
            <div key={t.id} style={{ background: COLORS.teal50, border: `1px solid ${COLORS.teal600}`, borderRadius: '16px', marginBottom: '10px', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
                  <p style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                  <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 800, color: COLORS.white, background: COLORS.teal600, padding: '3px 9px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{miles.toFixed(1)} mi</span>
                </div>
                <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                <button onClick={() => openTicket(t)} style={{ width: '100%', padding: '12px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
                  View job
                </button>
              </div>
            </div>
          ))}
          <p style={{ margin: '0 0 4px 0', fontSize: '10px', fontWeight: 800, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>All jobs</p>
        </div>
      )}

      {/* Job list */}
      {SHOW_JOB_LIST && (
      <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
        {filteredTickets.length === 0 && (
          <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <p style={{ color: COLORS.slate400, fontWeight: 600 }}>No jobs assigned to you.</p>
          </div>
        )}
        {filteredTickets.map(t => (
          <div key={t.id} style={{ background: COLORS.white, borderRadius: '16px', marginBottom: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ height: '4px', background: statusColour(t.status) }} />
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.ticket_number} · {t.category}</span>
                <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(t.status)}</span>
              </div>
              <p style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
              <button onClick={() => openTicket(t)} style={{ width: '100%', padding: '12px', background: statusColour(t.status), color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}>
  View job
</button>

            </div>
          </div>
        ))}
      </div>
      )}
      {/* Job detail modal */}
{selectedTicket && (
  <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

    {/* Header */}
    <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
      <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Hidden rather than redirecting to itself while locked (In
            Progress, or on a short-trip break) -- there's nowhere else to
            go until Stop resolves, see lockedTicket above. The ☰ menu next
            to it stays fully usable either way -- Team Chat, Metrics,
            Mileage are never part of the lock, only the job list is. */}
        {!lockedTicket ? (
          <button onClick={closeTicket} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
            ← Back
          </button>
        ) : <span />}
        <button
          onClick={() => setMenuOpen(prev => !prev)}
          aria-label="Menu"
          style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
        >
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
          <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
        </button>
      </div>

      {menuOpen && (
        <div style={{ background: COLORS.greenDark, padding: '20px' }}>
          <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
          <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {SHOW_LOG_TICKET_NAV && (
              <button
                onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
              >
                📝 Log a Ticket
              </button>
            )}
            <button
              onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              📋 My Reports
            </button>
            <button
              onClick={() => { setPage('mileage'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              🕐 My Mileage
            </button>
            <button
              onClick={() => { setPage('metrics'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              📊 My Metrics
            </button>
            <button
              onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              <span>💬 Team Chat</span>
              {unreadMentions > 0 && (
                <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
              )}
            </button>
            <button
              onClick={handleSignOut}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
            >
              🚪 Sign out
            </button>
          </div>
        </div>
      )}
    </div>

    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

      {/* Property */}
      <div style={{ background: COLORS.white, borderRadius: '16px', overflow: 'hidden', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ height: '4px', background: statusColour(selectedTicket.status) }} />
        <div style={{ padding: '20px' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{selectedTicket.category}</p>
          <p style={{ margin: '0 0 6px 0', fontSize: '18px', fontWeight: 800, color: COLORS.slate900 }}>{selectedTicket.property?.address}</p>
          {selectedTicket.property?.high_vulnerability && (
            <div style={{ background: COLORS.red50, border: `1px solid ${COLORS.red200}`, borderRadius: '10px', padding: '10px 14px', marginBottom: '8px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.red600 }}>⚠ Vulnerable Occupant — handle with care</p>
            </div>
          )}
          {selectedTicket.priority_score >= p1Threshold && (
            <div style={{ background: COLORS.amber50, border: `1px solid ${COLORS.amber300}`, borderRadius: '10px', padding: '10px 14px', marginBottom: '8px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: COLORS.amber800 }}>🔴 Urgent Priority</p>
            </div>
          )}
          <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate500 }}>{selectedTicket.description}{selectedTicket.room ? ` — ${selectedTicket.room}` : ''}</p>
        </div>
      </div>

      {/* Access & Safety */}
      {(selectedTicket.property?.safeguards || selectedTicket.property?.electrical_shutoff || selectedTicket.property?.gas_shutoff) && (
        <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>🔑 Access & Safety</p>
          {selectedTicket.property?.safeguards && <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: COLORS.gray700 }}>{selectedTicket.property.safeguards}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedTicket.property?.electrical_shutoff && (
              <div style={{ background: COLORS.amber50, borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber600 }}>⚡ Electric shutoff</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: COLORS.slate900 }}>{selectedTicket.property.electrical_shutoff}</p>
              </div>
            )}
            {selectedTicket.property?.gas_shutoff && (
              <div style={{ background: COLORS.amber50, borderRadius: '10px', padding: '12px 16px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber600 }}>🔥 Gas shutoff</p>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: COLORS.slate900 }}>{selectedTicket.property.gas_shutoff}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Photo */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Photo</p>
        <TicketAttachmentGallery ticketId={selectedTicket.id} fallbackUrl={selectedTicket.photo_url} emptyLabel="No photo" />
      </div>

      {/* Focus Mode timer -- Builder v.2: the dominant thing on screen
          whenever this ticket is what's locking the app (see lockedTicket).
          Big enough to read at a glance, with the estimate right above it
          so "how long should this take" is answered before "how long has
          it taken". */}
      {selectedTicket.status === 'In Progress' && (
        <div style={{ background: COLORS.teal600, borderRadius: '16px', padding: '24px 20px', marginBottom: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          {selectedTicket.estimated_minutes != null && (
            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Estimated {selectedTicket.estimated_minutes >= 60 ? `${Math.floor(selectedTicket.estimated_minutes / 60)}h ${selectedTicket.estimated_minutes % 60}m` : `${selectedTicket.estimated_minutes}m`} for this job
            </p>
          )}
          <p style={{ margin: '0 0 6px 0', fontSize: '40px', fontWeight: 800, color: COLORS.white, fontFamily: 'monospace', letterSpacing: '0.02em' }}>{formatElapsed(elapsed)}</p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', border: '2px solid rgba(255,255,255,0.4)', borderTopColor: COLORS.white, animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Time on this job</span>
          </div>
        </div>
      )}

      {selectedTicket.status === 'On Hold' && SHORT_TRIP_REASONS.includes(selectedTicket.hold_reason) && (
        <div style={{ background: COLORS.purple600, borderRadius: '16px', padding: '24px 20px', marginBottom: '12px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.75)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Away &mdash; {selectedTicket.hold_reason}</p>
          <p style={{ margin: '0 0 6px 0', fontSize: '32px', fontWeight: 800, color: COLORS.white, fontFamily: 'monospace', letterSpacing: '0.02em' }}>{formatElapsed(breakElapsed)}</p>
          <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: 'rgba(255,255,255,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Time since you left</p>
        </div>
      )}

      {/* Actions */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        {selectedTicket.status === 'Assigned' && (activeTicket ? (
          <div style={{ padding: '14px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
            <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job in progress</p>
            <p style={{ margin: 0, fontSize: '14px', color: COLORS.amber900 }}>
              Finish or hold Job #{activeTicket.ticket_number} before starting another job.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mileage</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
                <button
                  onClick={() => setMiles(m => Math.max(0, (m ?? 0) - 0.5))}
                  style={{ width: '40px', height: '40px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  −
                </button>
                <input
                  type="number"
                  step="0.5"
                  value={miles ?? ''}
                  onChange={(e) => setMiles(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                  style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '10px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '16px', fontWeight: 700, boxSizing: 'border-box' }}
                />
                <button
                  onClick={() => setMiles(m => (m ?? 0) + 0.5)}
                  style={{ width: '40px', height: '40px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                >
                  +
                </button>
              </div>
              {miles === null && (
                <p style={{ margin: '6px 0 0 0', fontSize: '11.5px', fontWeight: 700, color: COLORS.red500 }}>Enter miles driven, or 0 if you're already at this property.</p>
              )}
            </div>

            <button
              onClick={() => { setClockInError(''); handleClockIn(null, miles) }}
              disabled={clockingIn || miles === null}
              style={{ width: '100%', padding: '16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: (clockingIn || miles === null) ? 'not-allowed' : 'pointer', opacity: (clockingIn || miles === null) ? 0.6 : 1 }}
            >
              {clockingIn ? 'Getting your location…' : "✓ Arrived — start work"}
            </button>
            {clockInError && <p style={{ margin: 0, fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInError}</p>}

            {isRoutineVisit && (
              selectedTicket.delay_reason_status === 'pending' ? (
                <div style={{ padding: '14px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Delay reason submitted</p>
                  <p style={{ margin: 0, fontSize: '14px', color: COLORS.amber900 }}>
                    {selectedTicket.delay_reason}{selectedTicket.delay_reason_note ? ` — ${selectedTicket.delay_reason_note}` : ''} — awaiting manager review.
                  </p>
                </div>
              ) : showDelayReasonForm ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}` }}>
                  <div>
                    <p style={{ margin: '0 0 2px 0', fontSize: '14px', fontWeight: 800, color: COLORS.slate900 }}>Why can't this be done on time?</p>
                    <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>A manager will review this before it's accepted</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {['Couldn\'t get access', 'Ran out of time today', 'Property not ready for cleaning', 'Other'].map(reason => {
                      const active = delayReason === reason
                      return (
                        <button
                          key={reason}
                          onClick={() => setDelayReason(reason)}
                          style={{
                            width: '100%', padding: '12px', borderRadius: '10px',
                            border: active ? `2px solid ${COLORS.amber600}` : `1px solid ${COLORS.slate200}`,
                            background: active ? `${COLORS.amber600}14` : COLORS.slate50,
                            color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left',
                          }}
                        >
                          {reason}
                        </button>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <textarea
                      value={delayReasonNote}
                      onChange={(e) => setDelayReasonNote(e.target.value)}
                      placeholder="Add a note (optional)"
                      rows={3}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', flex: 1 }}
                    />
                    <VoiceInputButton onResult={(text) => setDelayReasonNote(prev => prev ? `${prev} ${text}` : text)} />
                  </div>
                  <button
                    onClick={() => handleReportDelay(delayReason, delayReasonNote)}
                    disabled={!delayReason || delayReasonSubmitting}
                    style={{ width: '100%', padding: '14px', background: COLORS.amber600, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: (!delayReason || delayReasonSubmitting) ? 'not-allowed' : 'pointer', opacity: (!delayReason || delayReasonSubmitting) ? 0.6 : 1 }}
                  >
                    {delayReasonSubmitting ? 'Submitting...' : 'Submit for review'}
                  </button>
                  <button
                    onClick={() => { setShowDelayReasonForm(false); setDelayReason(null); setDelayReasonNote('') }}
                    style={{ width: '100%', padding: '8px', background: 'none', border: 'none', color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDelayReasonForm(true)}
                  style={{ width: '100%', padding: '12px', background: 'none', color: COLORS.amber800, border: `1px dashed ${COLORS.amber300}`, borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ⚠ Can't do this on time? Report a delay
                </button>
              )
            )}
          </div>
        ))}
        {selectedTicket.status === 'In Progress' && !showCompleteConfirm && (
          <button onClick={() => setStopSheetOpen(true)} style={{ width: '100%', padding: '18px', background: COLORS.red600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 800, cursor: 'pointer' }}>
            ⏹ Stop
          </button>
        )}
        {selectedTicket.status === 'In Progress' && showCompleteConfirm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>Confirm job complete</p>
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>
                {isRoutineVisit ? 'Work through the checklist, then add a note and a photo of the completed work' : 'Add a note on the work done, and a photo of the completed work'}
              </p>
            </div>

            {isRoutineVisit && (
              <div>
                <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Checklist</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {routineVisitChecklistTemplate.map(item => (
                    <label
                      key={item}
                      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: checklistChecked[item] ? COLORS.green50 : COLORS.slate50, cursor: 'pointer' }}
                    >
                      <input
                        type="checkbox"
                        checked={!!checklistChecked[item]}
                        onChange={(e) => setChecklistChecked(prev => ({ ...prev, [item]: e.target.checked }))}
                      />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.slate900 }}>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea
                value={completeNote}
                onChange={(e) => setCompleteNote(e.target.value)}
                placeholder="Describe the work completed..."
                rows={3}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', flex: 1 }}
              />
              <VoiceInputButton onResult={(text) => setCompleteNote(prev => prev ? `${prev} ${text}` : text)} />
            </div>

            <TicketMediaPicker files={completeMediaFiles} onChange={setCompleteMediaFiles} inputId="complete-media-input" onBrokenChange={setHasBrokenCompleteMedia} />
            {completeUploadProgress && (
              <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500, fontWeight: 600 }}>{formatUploadProgress(completeUploadProgress)}</p>
            )}

            <div>
              <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Materials Used (optional)</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {materialsUsedRows.map((row, index) => (
                  <div key={index} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => updateMaterialsUsedRow(index, 'name', e.target.value)}
                      placeholder="What (e.g. 15mm elbow, screws)..."
                      style={{ flex: 1, padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={row.quantity}
                      onChange={(e) => updateMaterialsUsedRow(index, 'quantity', e.target.value)}
                      placeholder="Qty"
                      style={{ width: '80px', padding: '10px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13px', fontFamily: 'inherit', boxSizing: 'border-box' }}
                    />
                    <button
                      onClick={() => removeMaterialsUsedRow(index)}
                      aria-label="Remove"
                      style={{ width: '36px', height: '36px', flexShrink: 0, border: 'none', background: COLORS.red100, color: COLORS.red600, borderRadius: '8px', fontSize: '15px', cursor: 'pointer' }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={addMaterialsUsedRow}
                  style={{ width: '100%', padding: '10px', borderRadius: '10px', border: `1px dashed ${COLORS.slate300}`, background: COLORS.slate50, color: COLORS.slate500, fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
                >
                  + Add {materialsUsedRows.length > 0 ? 'another' : 'a'} material
                </button>
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}`, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={followUpNeeded}
                onChange={(e) => setFollowUpNeeded(e.target.checked)}
                style={{ marginTop: '3px', flexShrink: 0, width: '16px', height: '16px' }}
              />
              <span>
                <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: COLORS.amber900 }}>Needs a follow-up</span>
                <span style={{ display: 'block', fontSize: '12px', color: COLORS.amber800, marginTop: '2px', lineHeight: 1.4 }}>
                  Job's done, but something here needs picking up later — e.g. "fixed the fridge, but it should really be replaced."
                </span>
              </span>
            </label>
            {followUpNeeded && (
              <div style={{ display: 'flex', gap: '8px' }}>
                <textarea
                  value={followUpNote}
                  onChange={(e) => setFollowUpNote(e.target.value)}
                  placeholder="What needs following up..."
                  rows={2}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', flex: 1 }}
                />
                <VoiceInputButton onResult={(text) => setFollowUpNote(prev => prev ? `${prev} ${text}` : text)} />
              </div>
            )}

            {completeError && (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.red500 }}>{completeError}</p>
            )}

            {checklistIncomplete && (
              <p style={{ margin: 0, fontSize: '12px', color: COLORS.amber600 }}>Complete every checklist item before confirming.</p>
            )}
            {hasBrokenCompleteMedia && (
              <p style={{ margin: 0, fontSize: '12px', color: COLORS.red600, fontWeight: 700 }}>Check your photo — one couldn't be loaded, so it can't be submitted yet.</p>
            )}
            <button
              onClick={() => handleComplete(completeNote, completeMediaFiles, isRoutineVisit ? routineVisitChecklistTemplate.map(label => ({ label, checked: !!checklistChecked[label] })) : undefined, followUpNeeded, followUpNote.trim())}
              disabled={completeSubmitting || checklistIncomplete || hasBrokenCompleteMedia}
              style={{ width: '100%', padding: '16px', background: COLORS.green600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: (completeSubmitting || checklistIncomplete || hasBrokenCompleteMedia) ? 'not-allowed' : 'pointer', opacity: (completeSubmitting || checklistIncomplete || hasBrokenCompleteMedia) ? 0.6 : 1 }}
            >
              {completeSubmitting ? 'Submitting...' : '✓ Confirm complete'}
            </button>
            <button
              onClick={() => setShowCompleteConfirm(false)}
              style={{ width: '100%', padding: '10px', background: 'none', border: 'none', color: COLORS.slate500, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        )}
        {selectedTicket.status === 'On Hold' && (!SHORT_TRIP_REASONS.includes(selectedTicket.hold_reason) || shortTripNeedsMileage) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {(selectedTicket.hold_reason || selectedTicket.hold_note) && (
              <div style={{ padding: '14px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Why this job is paused</p>
                <p style={{ margin: 0, fontSize: '14px', color: COLORS.amber900 }}>
                  {selectedTicket.hold_reason}{selectedTicket.hold_note ? ` — ${selectedTicket.hold_note}` : ''}
                </p>
              </div>
            )}
            {activeTicket ? (
              <div style={{ padding: '14px', borderRadius: '10px', background: COLORS.amber50, border: `1px solid ${COLORS.amber300}` }}>
                <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.amber800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job in progress</p>
                <p style={{ margin: 0, fontSize: '14px', color: COLORS.amber900 }}>
                  Finish or hold Job #{activeTicket.ticket_number} before starting another job.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mileage</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', overflow: 'hidden' }}>
                    <button
                      onClick={() => setMiles(m => Math.max(0, (m ?? 0) - 0.5))}
                      style={{ width: '40px', height: '40px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="0"
                      value={miles ?? ''}
                      onChange={(e) => setMiles(e.target.value === '' ? null : (parseFloat(e.target.value) || 0))}
                      style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '10px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '16px', fontWeight: 700, boxSizing: 'border-box' }}
                    />
                    <button
                      onClick={() => setMiles(m => (m ?? 0) + 0.5)}
                      style={{ width: '40px', height: '40px', borderRadius: '50%', background: COLORS.slate500, color: COLORS.white, border: 'none', fontSize: '18px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                    >
                      +
                    </button>
                  </div>
                  {miles === null && (
                    <p style={{ margin: '6px 0 0 0', fontSize: '11.5px', fontWeight: 700, color: COLORS.red500 }}>Enter miles driven, or 0 if you're already at this property.</p>
                  )}
                </div>
                <button
                  onClick={() => handleResumeWork(miles)}
                  disabled={clockingIn || miles === null}
                  style={{ width: '100%', padding: '16px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: (clockingIn || miles === null) ? 'not-allowed' : 'pointer', opacity: (clockingIn || miles === null) ? 0.6 : 1 }}
                >
                  {clockingIn ? 'Getting your location…' : '✓ Arrived — restart work'}
                </button>
                {clockInError && <p style={{ margin: 0, fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInError}</p>}
              </>
            )}
          </div>
        )}
        {selectedTicket.status === 'On Hold' && SHORT_TRIP_REASONS.includes(selectedTicket.hold_reason) && !shortTripNeedsMileage && (
          <div>
            <button
              onClick={() => handleResumeWork()}
              disabled={clockingIn}
              style={{ width: '100%', padding: '18px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: 800, cursor: clockingIn ? 'not-allowed' : 'pointer', opacity: clockingIn ? 0.7 : 1 }}
            >
              {clockingIn ? 'Getting your location…' : '▶ Resume Job'}
            </button>
            {clockInError && <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{clockInError}</p>}
          </div>
        )}
        {/* Reference view only -- reached from the Done tile's job list, not
            an active job screen, so this is deliberately just the outcome
            (note + photos), no buttons of any kind. */}
        {selectedTicket.status === 'Completed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ padding: '14px', borderRadius: '10px', background: COLORS.green50, border: `1px solid ${COLORS.green200}` }}>
              <p style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 700, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Completed{selectedTicket.completed_at ? ` ${formatUKDateTime(selectedTicket.completed_at)}` : ''}
              </p>
              {selectedTicket.completion_note && (
                <p style={{ margin: 0, fontSize: '14px', color: COLORS.green900 }}>{selectedTicket.completion_note}</p>
              )}
            </div>
            <TicketAttachmentGallery ticketId={selectedTicket.id} fallbackUrl={selectedTicket.completion_photo_url} mediaHeight="140px" stage="completed" />
          </div>
        )}
      </div>

      {/* Comments */}
      <div style={{ background: COLORS.white, borderRadius: '16px', padding: '20px', marginBottom: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <p style={{ margin: '0 0 14px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Comments</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {comments.length === 0 && (
            <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400 }}>No comments yet.</p>
          )}
          {comments.map(c => (
            <div key={c.id} style={{ borderBottom: `1px solid ${COLORS.slate100}`, paddingBottom: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.slate900 }}>{c.author_name}</span>
                <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.slate500, background: COLORS.slate100, padding: '2px 8px', borderRadius: '10px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{c.role}</span>
                <span style={{ fontSize: '11px', color: COLORS.slate400, marginLeft: 'auto' }}>{formatUKDateTime(c.created_at)}</span>
              </div>
              <p style={{ margin: 0, fontSize: '14px', color: COLORS.gray700 }}>{c.body}</p>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment..."
            rows={3}
            style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', flex: 1 }}
          />
          <VoiceInputButton onResult={(text) => setCommentText(prev => prev ? `${prev} ${text}` : text)} />
        </div>
        {commentError && (
          <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.red500 }}>{commentError}</p>
        )}
        <button
          onClick={handlePostComment}
          style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 700, cursor: 'pointer' }}
        >
          Post comment
        </button>
      </div>

    </div>

    {/* Stop sheet -- the single unified "why are you stopping" flow that
        replaces the old separate Mark complete / Pause / Couldn't get
        access buttons. Job Completed hands straight to the existing
        completion flow (showCompleteConfirm); Waiting for Materials asks
        one more question first since "going myself" and "on order" behave
        completely differently (see handleStop / SHORT_TRIP_REASONS). */}
    {stopSheetOpen && (
      <div
        onClick={() => { if (!stopSubmitting) { setStopSheetOpen(false); setMaterialsAskOpen(false); setStopReasonPicked(null); setStopNote(''); setStopError('') } }}
        style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'flex-end', zIndex: 60 }}
      >
        <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '80vh', overflowY: 'auto', background: COLORS.white, borderRadius: '18px 18px 0 0' }}>
          {!materialsAskOpen && !stopReasonPicked && (
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>Why are you stopping?</p>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 500, color: COLORS.slate500 }}>This is logged and shown to the office</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  onClick={() => { setChecklistChecked({}); setMaterialsUsedRows([]); setFollowUpNeeded(false); setFollowUpNote(''); setStopSheetOpen(false); setShowCompleteConfirm(true) }}
                  style={{ width: '100%', padding: '14px', borderRadius: '10px', border: 'none', background: COLORS.green600, color: COLORS.white, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                >
                  ✓ Job Completed
                </button>
                <button onClick={() => setMaterialsAskOpen(true)} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  📦 Waiting for Materials
                </button>
                <button onClick={() => setStopReasonPicked('Going to the Office')} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  🏢 Going to the Office
                </button>
                <button onClick={() => setStopReasonPicked('Lunch Break')} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  🍽 Lunch Break
                </button>
                <button onClick={() => setStopReasonPicked('Unable to Do the Job')} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.red200}`, background: COLORS.white, color: COLORS.red600, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  🚫 Unable to Do the Job
                </button>
                <button onClick={() => setStopReasonPicked('Other')} style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
                  Other
                </button>
              </div>
              <button
                onClick={() => setStopSheetOpen(false)}
                style={{ width: '100%', padding: '10px', marginTop: '10px', background: 'none', border: 'none', color: COLORS.slate500, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}

          {materialsAskOpen && (
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>Waiting for Materials</p>
              <p style={{ margin: '0 0 16px 0', fontSize: '13px', fontWeight: 500, color: COLORS.slate500 }}>Are you going yourself, or is it on order?</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  onClick={() => { setMaterialsAskOpen(false); setStopReasonPicked('Getting materials myself') }}
                  style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                >
                  🚗 I'm going myself
                </button>
                <button
                  onClick={() => { setMaterialsAskOpen(false); setStopReasonPicked('Waiting for materials (ordered)') }}
                  style={{ width: '100%', padding: '14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}
                >
                  📬 Already ordered / awaiting delivery
                </button>
              </div>
              <button
                onClick={() => setMaterialsAskOpen(false)}
                style={{ width: '100%', padding: '10px', marginTop: '10px', background: 'none', border: 'none', color: COLORS.slate500, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          )}

          {stopReasonPicked && (
            <div style={{ padding: '20px' }}>
              <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>{stopReasonPicked}</p>
              <p style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: 500, color: COLORS.slate500 }}>
                {(stopReasonPicked === 'Other' || stopReasonPicked === 'Unable to Do the Job') ? 'Please say what happened' : 'Add a note (optional)'}
              </p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <textarea
                  value={stopNote}
                  onChange={(e) => setStopNote(e.target.value)}
                  placeholder={(stopReasonPicked === 'Other' || stopReasonPicked === 'Unable to Do the Job') ? 'e.g. Ran out of a specific part, coming back tomorrow...' : 'Add a note...'}
                  rows={3}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', fontFamily: 'inherit', boxSizing: 'border-box', resize: 'vertical', flex: 1 }}
                />
                <VoiceInputButton onResult={(text) => setStopNote(prev => prev ? `${prev} ${text}` : text)} />
              </div>
              {stopError && <p style={{ margin: '0 0 10px 0', fontSize: '13px', color: COLORS.red500, fontWeight: 600 }}>{stopError}</p>}
              <button
                onClick={() => {
                  if ((stopReasonPicked === 'Other' || stopReasonPicked === 'Unable to Do the Job') && !stopNote.trim()) { setStopError('Please add a note explaining what happened.'); return }
                  setStopError('')
                  handleStop(stopReasonPicked, stopNote.trim())
                }}
                disabled={stopSubmitting}
                style={{ width: '100%', padding: '16px', background: COLORS.amber600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: stopSubmitting ? 'not-allowed' : 'pointer', opacity: stopSubmitting ? 0.6 : 1 }}
              >
                {stopSubmitting ? 'Submitting...' : 'Confirm'}
              </button>
              <button
                onClick={() => setStopReasonPicked(null)}
                style={{ width: '100%', padding: '10px', marginTop: '4px', background: 'none', border: 'none', color: COLORS.slate500, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
              >
                Back
              </button>
            </div>
          )}
        </div>
      </div>
    )}
  </div>
)}

      {/* Leaving Site -- Where are you going? */}
      {page === 'leaving-choices' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('jobs')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Where are you going?</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => { setActivityType('Travel'); setTravelMode('job'); setDestinationTicketId(''); setJobSearchQuery(''); setActivityError(''); setPickingForTravel(true); setPage('leaving-job') }}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: 'none', background: COLORS.green600, color: COLORS.white, textAlign: 'center' }}
              >
                🚗 Going to Another Job
              </button>
              <button
                onClick={() => { setActivityType('Travel'); setTravelMode('shop'); setActivityNote(''); setActivityError(''); setPage('leaving-materials') }}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, textAlign: 'center' }}
              >
                🛒 Buying Materials
              </button>
              <button
                onClick={() => { setActivityType('Travel'); setTravelMode('office'); setActivityError(''); setPage('leaving-office') }}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, textAlign: 'center' }}
              >
                🏢 Going to the Office
              </button>
              <button
                onClick={() => { setActivityType('Break'); setActivityNote(''); setActivityError(''); setPage('leaving-lunch') }}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: `1px solid ${COLORS.slate200}`, background: COLORS.slate50, color: COLORS.slate900, textAlign: 'center' }}
              >
                🍽️ Lunch Break
              </button>
              <button
                onClick={() => setPage('leaving-resume')}
                style={{ width: '100%', padding: '16px', borderRadius: '12px', fontSize: '15px', fontWeight: 700, cursor: 'pointer', border: 'none', background: COLORS.amber500, color: COLORS.white, textAlign: 'center' }}
              >
                ▶ Resume Jobs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leaving Site -- Going to Another Job (search) */}
      {page === 'leaving-job' && (() => {
        const assignedJobs = tickets.filter(t => t.status === 'Assigned')
        const q = jobSearchQuery.trim().toLowerCase()
        const results = (q
          ? assignedJobs.filter(t =>
              String(t.ticket_number).startsWith(q) ||
              (t.property?.address || '').toLowerCase().includes(q) ||
              (t.category || '').toLowerCase().includes(q) ||
              (t.description || '').toLowerCase().includes(q)
            )
          : assignedJobs
        ).slice(0, 8)
        return (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-choices')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Going to Another Job</p>
            <input
              type="text"
              autoFocus
              value={jobSearchQuery}
              onChange={(e) => setJobSearchQuery(e.target.value)}
              placeholder="Type a job number or address..."
              style={{ width: '100%', padding: '13px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '14px' }}
            />
            {activityError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
            {assignedJobs.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center' }}>No other assigned jobs to head to right now.</p>
            ) : results.length === 0 ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center' }}>No jobs match "{jobSearchQuery}".</p>
            ) : (
              <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', overflow: 'hidden', background: COLORS.white }}>
                {results.map((t, i) => {
                  const miles = estimateMilesTo(t)
                  return (
                    <button
                      key={t.id}
                      // pickingForTravel: he's actually heading there --
                      // select only, the new confirm screen's explicit
                      // Start is what logs it. Otherwise (the "To do" tile)
                      // this is just a peek at an assigned job, same plain
                      // open used everywhere else in this file.
                      onClick={() => {
                        if (pickingForTravel) { setDestinationTicketId(t.id); setPage('leaving-job-confirm') }
                        else { setSelectedTicket(t); setPage('jobs') }
                      }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: i < results.length - 1 ? `1px solid ${COLORS.slate300}` : 'none', background: COLORS.white, cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                        <span style={{ fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#{t.ticket_number} · {t.category}</span>
                        {miles != null && (
                          <span style={{ flexShrink: 0, fontSize: '10.5px', fontWeight: 800, color: COLORS.white, background: COLORS.teal600, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{miles.toFixed(1)} mi</span>
                        )}
                      </div>
                      <p style={{ margin: '0 0 2px 0', fontSize: '13.5px', fontWeight: 800, color: COLORS.slate900 }}>{t.property?.address}</p>
                      <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        )
      })()}

      {/* Leaving Site -- Going to Another Job (confirm) -- the explicit
          "Start Travelling" tap here is what actually logs anything;
          picking the destination on the previous screen never does (see
          handleStartActivity's comment). Mirrors Buying Materials' own
          pick-then-Start shape below. */}
      {page === 'leaving-job-confirm' && (() => {
        const destinationTicket = tickets.find(t => t.id === destinationTicketId)
        const miles = destinationTicket ? estimateMilesTo(destinationTicket) : null
        return (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-job')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Going to Another Job</p>
            {!destinationTicket ? (
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate400, fontStyle: 'italic', textAlign: 'center' }}>Could not find that job.</p>
            ) : (
              <>
                <div style={{ border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '14px', background: COLORS.white, marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>#{destinationTicket.ticket_number} · {destinationTicket.category}</span>
                    {miles != null && (
                      <span style={{ flexShrink: 0, fontSize: '10.5px', fontWeight: 800, color: COLORS.white, background: COLORS.teal600, padding: '2px 8px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{miles.toFixed(1)} mi</span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 2px 0', fontSize: '13.5px', fontWeight: 800, color: COLORS.slate900 }}>{destinationTicket.property?.address}</p>
                  <p style={{ margin: 0, fontSize: '12px', color: COLORS.slate500 }}>{destinationTicket.description}{destinationTicket.room ? ` — ${destinationTicket.room}` : ''}</p>
                </div>
                {activityError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
                <button
                  onClick={() => handleStartActivity()}
                  disabled={startingActivity}
                  style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14.5px', fontWeight: 700, cursor: startingActivity ? 'not-allowed' : 'pointer', opacity: startingActivity ? 0.5 : 1 }}
                >
                  {startingActivity ? 'Starting…' : '🚗 Start Travelling'}
                </button>
              </>
            )}
          </div>
        </div>
        )
      })()}

      {/* Leaving Site -- Buying Materials */}
      {page === 'leaving-materials' && (() => {
        const q = activityNote.trim().toLowerCase()
        const activeStoreNames = materialStores.filter(s => s.active).map(s => s.name)
        const matches = q ? activeStoreNames.filter(s => s.toLowerCase().includes(q)) : []
        return (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-choices')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Buying Materials</p>
            <input
              type="text"
              autoFocus
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              placeholder="Type a store name, or your own..."
              style={{ width: '100%', padding: '13px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '10px' }}
            />
            {matches.length > 0 ? (
              <div style={{ marginBottom: '10px' }}>
                {matches.map(s => (
                  <button
                    key={s}
                    onClick={() => setActivityNote(s)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', marginBottom: '6px', border: `1px solid ${COLORS.slate100}`, borderRadius: '10px', background: COLORS.white, fontSize: '14px', fontWeight: 600, color: COLORS.slate900, cursor: 'pointer' }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : q ? (
              <p style={{ margin: '0 0 10px 0', fontSize: '12.5px', color: COLORS.slate400, fontStyle: 'italic' }}>Not listed — "{activityNote}" will be used as typed.</p>
            ) : null}
            {activityError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
            <button
              onClick={() => handleStartActivity()}
              disabled={startingActivity || !activityNote.trim()}
              style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14.5px', fontWeight: 700, cursor: (startingActivity || !activityNote.trim()) ? 'not-allowed' : 'pointer', opacity: (startingActivity || !activityNote.trim()) ? 0.5 : 1 }}
            >
              {startingActivity ? 'Starting…' : 'Start'}
            </button>
          </div>
        </div>
        )
      })()}

      {/* Leaving Site -- Going to the Office */}
      {page === 'leaving-office' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-choices')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Going to the Office</p>
            <div style={{ padding: '12px 14px', borderRadius: '10px', background: COLORS.slate50, border: `1px solid ${COLORS.slate200}`, marginBottom: '12px' }}>
              <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: COLORS.slate600 }}>You're heading to the office — no address needed.</p>
            </div>
            {activityError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
            <button
              onClick={() => handleStartActivity()}
              disabled={startingActivity}
              style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14.5px', fontWeight: 700, cursor: startingActivity ? 'not-allowed' : 'pointer', opacity: startingActivity ? 0.7 : 1 }}
            >
              {startingActivity ? 'Starting…' : 'Start'}
            </button>
          </div>
        </div>
      )}

      {/* Leaving Site -- Lunch Break */}
      {page === 'leaving-lunch' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-choices')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lunch Break</p>
            <input
              type="text"
              value={activityNote}
              onChange={(e) => setActivityNote(e.target.value)}
              placeholder="Note (optional)"
              style={{ width: '100%', padding: '13px 14px', borderRadius: '12px', border: `1px solid ${COLORS.slate200}`, fontSize: '14px', boxSizing: 'border-box', marginBottom: '12px' }}
            />
            {activityError && <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: COLORS.red500, fontWeight: 600 }}>{activityError}</p>}
            <button
              onClick={() => handleStartActivity()}
              disabled={startingActivity}
              style={{ width: '100%', padding: '14px', background: COLORS.teal600, color: COLORS.white, border: 'none', borderRadius: '12px', fontSize: '14.5px', fontWeight: 700, cursor: startingActivity ? 'not-allowed' : 'pointer', opacity: startingActivity ? 0.7 : 1 }}
            >
              {startingActivity ? 'Starting…' : 'Start'}
            </button>
          </div>
        </div>
      )}

      {/* Leaving Site -- Resume Jobs (on-hold, non-short-trip) */}
      {page === 'leaving-resume' && (() => {
        const resumable = onHoldTickets.filter(t => !SHORT_TRIP_REASONS.includes(t.hold_reason))
        return (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('leaving-choices')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Resume Jobs</p>
            {resumable.length === 0 ? (
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '34px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, color: COLORS.slate400, fontWeight: 600 }}>Nothing on hold.</p>
              </div>
            ) : resumable.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedTicket(t); setPage('jobs') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '14px', marginBottom: '10px', cursor: 'pointer' }}
              >
                <p style={{ margin: '0 0 2px 0', fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Job #{t.ticket_number} · {t.category}</p>
                <p style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                <p style={{ margin: '0 0 8px 0', fontSize: '12.5px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                {(t.hold_reason || t.hold_note) && (
                  <p style={{ margin: 0, fontSize: '12px', fontWeight: 700, color: COLORS.amber800, background: COLORS.amber50, border: `1px solid ${COLORS.amber300}`, borderRadius: '8px', padding: '6px 10px' }}>
                    ⏸ {t.hold_reason}{t.hold_note ? ` — ${t.hold_note}` : ''}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
        )
      })()}

      {/* Urgent tile's own job list -- same "tap a card, land straight on
          the ready-to-start job screen" pattern as Resume Jobs above, just
          scoped to urgentTickets instead of on-hold ones. Reached only
          from the dashboard tile, not the Leaving Site menu, so Back goes
          straight to the dashboard rather than into leaving-choices. */}
      {page === 'urgent-jobs' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('jobs')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Urgent Jobs</p>
            {urgentTickets.length === 0 ? (
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '34px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, color: COLORS.slate400, fontWeight: 600 }}>Nothing urgent right now.</p>
              </div>
            ) : urgentTickets.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedTicket(t); setPage('jobs') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: COLORS.white, border: `1px solid ${COLORS.red200}`, borderRadius: '12px', padding: '14px', marginBottom: '10px', cursor: 'pointer' }}
              >
                <p style={{ margin: '0 0 2px 0', fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Job #{t.ticket_number} · {t.category}</p>
                <p style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Done tile's own job list -- read-only history, most recently
          completed first. Tapping a card opens the same ticket overlay
          every other job uses, but a Completed ticket only ever shows the
          outcome (note + photos) there, no action buttons -- see the
          selectedTicket.status === 'Completed' branch in the Actions
          card above. */}
      {page === 'done-jobs' && (() => {
        const recentlyDone = [...doneTickets].sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))
        return (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>
          <BuilderNavHeader onBack={() => setPage('jobs')} goHome={goHome} menuOpen={menuOpen} setMenuOpen={setMenuOpen} profile={profile} unreadMentions={unreadMentions} setPage={setPage} handleSignOut={handleSignOut} />
          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Done Jobs</p>
            {recentlyDone.length === 0 ? (
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '34px 20px', textAlign: 'center' }}>
                <p style={{ margin: 0, color: COLORS.slate400, fontWeight: 600 }}>No completed jobs yet.</p>
              </div>
            ) : recentlyDone.map(t => (
              <button
                key={t.id}
                onClick={() => { setSelectedTicket(t); setPage('jobs') }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: COLORS.white, border: `1px solid ${COLORS.slate200}`, borderRadius: '12px', padding: '14px', marginBottom: '10px', cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                  <p style={{ margin: '0 0 2px 0', fontSize: '10.5px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Job #{t.ticket_number} · {t.category}</p>
                  {t.completed_at && <span style={{ flexShrink: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400 }}>{formatUKDate(t.completed_at)}</span>}
                </div>
                <p style={{ margin: '0 0 4px 0', fontSize: '14.5px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                <p style={{ margin: 0, fontSize: '12.5px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
              </button>
            ))}
          </div>
        </div>
        )
      })()}

      {/* My Mileage page */}
      {page === 'mileage' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: COLORS.greenDark, padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {SHOW_LOG_TICKET_NAV && (
                    <button
                      onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                    >
                      📝 Log a Ticket
                    </button>
                  )}
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span>💬 Team Chat</span>
                    {unreadMentions > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
                    )}
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
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
              <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>My Mileage</h1>
              <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate500 }}>{profile.name}</p>
            </div>

            {/* Summary tiles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total miles</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.blue500 }}>{totalMiles}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>This month</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.slate500 }}>{monthMiles}</p>
              </div>
            </div>

            {/* Trip list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {mileageDataLoading ? (
                <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <p style={{ color: COLORS.slate400, fontWeight: 600 }}>Loading...</p>
                </div>
              ) : mileageTickets.length === 0 && (
                <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <p style={{ color: COLORS.slate400, fontWeight: 600 }}>No trips logged yet.</p>
                </div>
              )}
              {!mileageDataLoading && mileageTickets.map(t => (
                <div key={t.id} style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                  <div>
                    <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                    <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.ticket_number}</p>
                  </div>
                  <p style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: COLORS.blue500, flexShrink: 0 }}>{t.mileage_logged}</p>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* My Metrics page */}
      {page === 'metrics' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: COLORS.greenDark, padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {SHOW_LOG_TICKET_NAV && (
                    <button
                      onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                    >
                      📝 Log a Ticket
                    </button>
                  )}
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span>💬 Team Chat</span>
                    {unreadMentions > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
                    )}
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
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
              <h1 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 800, color: COLORS.slate900 }}>My Metrics</h1>
              <p style={{ margin: 0, fontSize: '14px', color: COLORS.slate500 }}>{profile.name}</p>
            </div>

            {/* Attendance -- day-level hours, separate from the jobs stats
                below. Read-only: same numbers a manager sees on this
                builder's profile, no edit controls here. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Attendance</p>
              <div style={{ display: 'flex', gap: '4px' }}>
                {[{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }].map(p => (
                  <button
                    key={p.days}
                    onClick={() => setAttendancePeriodDays(p.days)}
                    style={{
                      padding: '5px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                      border: attendancePeriodDays === p.days ? `1px solid ${COLORS.teal700}` : `1px solid ${COLORS.slate200}`,
                      background: attendancePeriodDays === p.days ? COLORS.teal700 : COLORS.white,
                      color: attendancePeriodDays === p.days ? COLORS.white : COLORS.slate600,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {attendanceLoading || !attendanceSummary ? (
              <p style={{ margin: '0 0 20px 0', fontSize: '13px', color: COLORS.slate400, fontWeight: 600, textAlign: 'left' }}>Loading...</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '12px' }}>
                  <div style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total Hours</p>
                    <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: COLORS.teal600 }}>{formatDurationDays(attendanceSummary.totalMs)}</p>
                  </div>
                  <div style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Days Worked</p>
                    <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: COLORS.blue600 }}>{attendanceSummary.daysWorked}</p>
                  </div>
                  <div style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Late</p>
                    <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: attendanceSummary.lateCount > 0 ? COLORS.amber600 : COLORS.slate400 }}>{attendanceSummary.lateCount}</p>
                  </div>
                  <div style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overtime</p>
                    <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: attendanceSummary.overtimeCount > 0 ? COLORS.purple600 : COLORS.slate400 }}>{attendanceSummary.overtimeCount}</p>
                  </div>
                  <div style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                    <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Missed Clock-Outs</p>
                    <p style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: attendanceSummary.missedClockOutCount > 0 ? COLORS.red600 : COLORS.slate400 }}>{attendanceSummary.missedClockOutCount}</p>
                  </div>
                </div>

                {attendanceSummary.days.length > 0 && (
                  <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box', marginBottom: '20px', textAlign: 'left' }}>
                    {attendanceSummary.days.slice(0, 7).map(day => (
                      <div key={day.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '8px 0', borderBottom: `1px solid ${COLORS.slate100}`, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate900, minWidth: '80px' }}>{formatUKDate(day.work_date)}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: day.isLive ? COLORS.teal600 : COLORS.slate600, fontFamily: 'monospace' }}>
                          {day.durationMs != null ? formatDuration(day.durationMs) : 'still clocked in'}{day.isLive ? ' so far' : ''}
                        </span>
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                          {day.late_flag && <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.amber700, background: COLORS.amber100, padding: '2px 8px', borderRadius: '999px' }}>Late</span>}
                          {day.early_leave_reason && <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.amber700, background: COLORS.amber100, padding: '2px 8px', borderRadius: '999px' }}>Left early</span>}
                          {day.overtime && <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.purple700, background: COLORS.purple100, padding: '2px 8px', borderRadius: '999px' }}>Overtime</span>}
                          {day.wasMissed && (
                            <span style={{ fontSize: '10px', fontWeight: 700, color: COLORS.red600, background: COLORS.red100, padding: '2px 8px', borderRadius: '999px' }}>
                              {day.incomplete ? 'No clock-out' : 'Missed clock-out'}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Jobs completed */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Jobs completed</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.green600 }}>{completedTodayCount}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>This week</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.green600 }}>{completedWeekCount}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>This month</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.green600 }}>{completedMonthCount}</p>
              </div>
            </div>

            {/* Overall snapshot */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall snapshot</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total completed</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.green600 }}>{doneTickets.length}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total assigned</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.slate500 }}>{totalAssignedCount}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>In progress now</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.teal600 }}>{inProgressTickets.length}</p>
              </div>
              <div style={{ width: '100%', background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box' }}>
                <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>On hold</p>
                <p style={{ margin: 0, fontSize: '28px', fontWeight: 800, color: COLORS.amber600 }}>{onHoldTickets.length}</p>
              </div>
            </div>

            {/* Recently completed */}
            <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recently completed</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {recentlyCompleted.length === 0 && (
                <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                  <p style={{ color: COLORS.slate400, fontWeight: 600 }}>No completed jobs yet.</p>
                </div>
              )}
              {recentlyCompleted.map(t => (
                <div key={t.id} style={{ background: COLORS.white, borderRadius: '16px', padding: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '14px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                  <p style={{ margin: '0 0 6px 0', fontSize: '13px', color: COLORS.slate500 }}>{t.description}</p>
                  <p style={{ margin: 0, fontSize: '11px', fontWeight: 700, color: COLORS.green600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Completed {formatUKDate(t.completed_at)}</p>
                </div>
              ))}
            </div>

          </div>
        </div>
      )}

      {/* Team Chat -- no channel/division picker, unlike the Admin/Manager
          view: a builder only ever has one channel (their resolved
          division, defaulting to Maintenance), so there's nothing to
          pick between. Realtime, not polling -- this app's first use of
          Supabase Realtime (see lib/chat.js). Direct Messages sits
          alongside it as a second tab (see lib/dm.js) -- a private
          one-to-one thread with any other staff member, not division-
          scoped like the channel above. */}
      {page === 'team-chat' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              onClick={() => (chatTab === 'dm' && dmView === 'thread') ? setDmView('list') : setPage('jobs')}
              style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}
            >
              ← Back
            </button>
            {chatTab === 'channel' && (
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>💬 {chatDivision} Team Chat</p>
            )}
            {chatTab === 'dm' && dmView === 'list' && (
              <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>Direct Messages</p>
            )}
            {chatTab === 'dm' && dmView === 'thread' && activeContact && (
              <div>
                <p style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: COLORS.slate900 }}>{activeContact.name}</p>
                <p style={{ margin: '2px 0 0', fontSize: '10.5px', fontWeight: 800, color: COLORS.greenDark, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <NavIcon name="lock" size={10} /> Private thread
                </p>
              </div>
            )}
          </div>

          {/* Tabs -- hidden inside an open DM thread to keep focus on the conversation */}
          {!(chatTab === 'dm' && dmView === 'thread') && (
            <div style={{ display: 'flex', gap: '8px', padding: '10px 20px 0', background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}` }}>
              <button
                onClick={() => setChatTab('channel')}
                style={{
                  padding: '8px 4px', marginBottom: '-1px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700, color: chatTab === 'channel' ? COLORS.greenDark : COLORS.slate400,
                  borderBottom: chatTab === 'channel' ? `2px solid ${COLORS.greenDark}` : '2px solid transparent',
                }}
              >
                Channel
              </button>
              <button
                onClick={() => setChatTab('dm')}
                style={{
                  padding: '8px 4px', marginBottom: '-1px', background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 700, color: chatTab === 'dm' ? COLORS.greenDark : COLORS.slate400,
                  borderBottom: chatTab === 'dm' ? `2px solid ${COLORS.greenDark}` : '2px solid transparent',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                Direct Messages
                {conversations.some(c => c.unreadCount > 0) && (
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: COLORS.red600 }} />
                )}
              </button>
            </div>
          )}

          {chatTab === 'channel' && (
            <>
              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {chatMessages.length === 0 && (
                  <p style={{ margin: 'auto', color: COLORS.slate400, fontSize: '13px' }}>No messages yet -- say hello 👋</p>
                )}
                {chatMessages.map((m, i) => {
                  const isMine = m.sender_id === profile.id
                  const seenBy = i === chatMessages.length - 1
                    ? chatMembers
                        .filter(mem => mem.id !== m.sender_id && mem.id !== profile.id && chatReads[mem.id] && new Date(chatReads[mem.id]) >= new Date(m.created_at))
                        .map(mem => mem.name)
                    : []
                  return (
                    <div key={m.id} style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexDirection: isMine ? 'row-reverse' : 'row' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: isMine ? COLORS.slate900 : colorForSender(m.sender_id) }}>{isMine ? 'You' : m.sender_name}</span>
                        <span style={{ fontSize: '11px', color: COLORS.slate400 }}>{formatUKDateTime(m.created_at)}</span>
                      </div>
                      {m.body && (
                        <div style={{
                          marginTop: '2px', padding: '8px 12px', fontSize: '13.5px', lineHeight: 1.4,
                          background: isMine ? COLORS.greenDark : COLORS.white, color: isMine ? COLORS.white : COLORS.gray700,
                          border: isMine ? 'none' : `1px solid ${COLORS.slate200}`,
                          borderRadius: isMine ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                        }}>
                          {m.body}
                        </div>
                      )}
                      {m.photo_url && (
                        <img
                          src={m.photo_url}
                          alt=""
                          onClick={() => setChatLightboxUrl(m.photo_url)}
                          style={{ marginTop: '4px', maxWidth: '200px', maxHeight: '200px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, display: 'block', cursor: 'pointer' }}
                        />
                      )}
                      {seenBy.length > 0 && (
                        <p style={{ margin: '4px 0 0', fontSize: '11px', color: COLORS.slate400, textAlign: isMine ? 'right' : 'left' }}>Seen by {seenBy.join(', ')}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Composer */}
              <div style={{ background: COLORS.white, borderTop: `1px solid ${COLORS.slate200}`, padding: '10px 14px 14px' }}>
                <ChatComposer
                  members={chatMembers.filter(m => m.id !== profile.id)}
                  onSend={handleSendChatMessage}
                  sending={chatSending}
                  inputStyle={{ flex: 1, padding: '10px 14px', borderRadius: '20px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', fontFamily: 'inherit' }}
                  sendButtonStyle={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: COLORS.greenDark, color: COLORS.white, fontSize: '14px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                />
              </div>
            </>
          )}

          {chatTab === 'dm' && dmView === 'list' && (
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <button
                onClick={() => { setPickerOpen(true); setContactSearch('') }}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '14px 20px', background: COLORS.white, border: 'none', borderBottom: `1px solid ${COLORS.slate200}`, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <span style={{ width: '32px', height: '32px', borderRadius: '50%', background: COLORS.green50, color: COLORS.greenDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 800, flexShrink: 0 }}>+</span>
                <span style={{ fontSize: '13.5px', fontWeight: 700, color: COLORS.greenDark }}>New message</span>
              </button>
              {conversations.length === 0 && (
                <p style={{ margin: '40px 20px', textAlign: 'center', color: COLORS.slate400, fontSize: '13px' }}>No conversations yet</p>
              )}
              {conversations.map(c => {
                const otherName = c.lastMessage.sender_id === c.otherId ? c.lastMessage.sender_name : (dmContacts.find(dc => dc.id === c.otherId)?.name || '...')
                return (
                  <button
                    key={c.otherId}
                    onClick={() => openDm({ id: c.otherId, name: otherName })}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', padding: '12px 20px', background: COLORS.white, border: 'none', borderBottom: `1px solid ${COLORS.slate200}`, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    <Avatar name={otherName} size={38} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: COLORS.slate900 }}>{otherName}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: COLORS.slate400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.lastMessage.body || (c.lastMessage.photo_url ? 'Photo' : '')}
                      </span>
                    </span>
                    {c.unreadCount > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, borderRadius: '999px', minWidth: '20px', textAlign: 'center', padding: '1px 6px', flexShrink: 0 }}>{c.unreadCount}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {chatTab === 'dm' && dmView === 'thread' && activeContact && (
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {dmMessages.length === 0 && (
                  <p style={{ margin: 'auto', color: COLORS.slate400, fontSize: '13px' }}>No messages yet -- say hello 👋</p>
                )}
                {dmMessages.map((m, i) => {
                  const isMine = m.sender_id === profile.id
                  return (
                    <div key={m.id} style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexDirection: isMine ? 'row-reverse' : 'row' }}>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: isMine ? COLORS.slate900 : colorForSender(m.sender_id) }}>{isMine ? 'You' : m.sender_name}</span>
                        <span style={{ fontSize: '11px', color: COLORS.slate400 }}>{formatUKDateTime(m.created_at)}</span>
                      </div>
                      {m.body && (
                        <div style={{
                          marginTop: '2px', padding: '8px 12px', fontSize: '13.5px', lineHeight: 1.4,
                          background: isMine ? COLORS.greenDark : COLORS.white, color: isMine ? COLORS.white : COLORS.gray700,
                          border: isMine ? 'none' : `1px solid ${COLORS.slate200}`,
                          borderRadius: isMine ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                        }}>
                          {m.body}
                        </div>
                      )}
                      {m.photo_url && (
                        <img
                          src={m.photo_url}
                          alt=""
                          onClick={() => setChatLightboxUrl(m.photo_url)}
                          style={{ marginTop: '4px', maxWidth: '200px', maxHeight: '200px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, display: 'block', cursor: 'pointer' }}
                        />
                      )}
                      {i === dmMessages.length - 1 && isMine && m.read_at && (
                        <p style={{ margin: '4px 0 0', fontSize: '11px', color: COLORS.slate400, textAlign: 'right' }}>Seen by {activeContact.name}</p>
                      )}
                    </div>
                  )
                })}
              </div>

              <div style={{ background: COLORS.white, borderTop: `1px solid ${COLORS.slate200}`, padding: '10px 14px 14px' }}>
                <ChatComposer
                  members={[]}
                  onSend={handleSendDm}
                  sending={dmSending}
                  placeholder={`Message ${activeContact.name}...`}
                  inputStyle={{ flex: 1, padding: '10px 14px', borderRadius: '20px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', fontFamily: 'inherit' }}
                  sendButtonStyle={{ width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: COLORS.greenDark, color: COLORS.white, fontSize: '14px', fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                />
              </div>
            </>
          )}

          {pickerOpen && (
            <div
              onClick={() => setPickerOpen(false)}
              style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'flex-end', zIndex: 60 }}
            >
              <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '70vh', background: COLORS.white, borderRadius: '16px 16px 0 0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <p style={{ margin: 0, padding: '16px 20px', fontSize: '14px', fontWeight: 800, color: COLORS.slate900, borderBottom: `1px solid ${COLORS.slate200}` }}>New direct message</p>
                <div style={{ padding: '12px 16px' }}>
                  <input
                    autoFocus
                    value={contactSearch}
                    onChange={(e) => setContactSearch(e.target.value)}
                    placeholder="Search staff by name..."
                    style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${COLORS.slate200}`, fontSize: '13.5px', fontFamily: 'inherit', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ overflowY: 'auto', paddingBottom: '12px' }}>
                  {dmContacts.filter(c => c.name.toLowerCase().includes(contactSearch.toLowerCase())).map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setPickerOpen(false); openDm(c) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left', padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <Avatar name={c.name} size={34} />
                      <span style={{ fontSize: '13.5px', fontWeight: 600, color: COLORS.slate900 }}>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <PhotoLightbox url={chatLightboxUrl} onClose={() => setChatLightboxUrl(null)} />
        </div>
      )}

      {/* Raise New Ticket page */}
      {page === 'new-ticket' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: COLORS.greenDark, padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {SHOW_LOG_TICKET_NAV && (
                    <button
                      onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                    >
                      📝 Log a Ticket
                    </button>
                  )}
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span>💬 Team Chat</span>
                    {unreadMentions > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
                    )}
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
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
              style={{ background: 'none', border: 'none', padding: 0, marginBottom: '16px', color: COLORS.slate500, fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              ← Cancel
            </button>

            <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Log a Ticket</h1>
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
                              // A single-option property (e.g. a true
                              // one-floor house) has nothing to actually
                              // choose -- auto-fill it same as Flat already
                              // defaulted to its first option, just without
                              // leaving the picker up for a choice that
                              // isn't really one.
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
                        <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Room number (optional)
                        </p>
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
                        <p style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                          Describe the area
                        </p>
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

                  </div>
                )}

                {/* Step 5: Photo + Submit */}
                {ticketStep4Complete && (
                  <div style={{ background: SECTION_BG[0], padding: '20px' }}>
                    <p style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: 700, color: COLORS.slate900 }}>5. Photo &amp; Submit</p>

                    <TicketMediaPicker files={ticketMediaFiles} onChange={setTicketMediaFiles} inputId="ticket-photo-input" onBrokenChange={setHasBrokenTicketMedia} />

                    <div style={{ marginTop: '16px' }}>
                      <p style={{ margin: '0 0 6px 0', fontSize: '11px', fontWeight: 600, color: COLORS.slate500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Reported by</p>
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
                          disabled={hasBrokenTicketMedia}
                          style={{ width: '100%', height: '44px', background: COLORS.amber600, border: 'none', borderRadius: '10px', color: COLORS.white, fontSize: '13px', fontWeight: 600, cursor: hasBrokenTicketMedia ? 'not-allowed' : 'pointer', opacity: hasBrokenTicketMedia ? 0.6 : 1, boxSizing: 'border-box' }}
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
                          <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: COLORS.green600, fontWeight: 600 }}>✓ Ticket submitted successfully</p>
                        )}
                        {hasBrokenTicketMedia && (
                          <p style={{ margin: '16px 0 0 0', fontSize: '13px', color: COLORS.red600, fontWeight: 700 }}>Check your photo — one couldn't be loaded, so it can't be submitted yet.</p>
                        )}
                        <button
                          onClick={() => handleSubmitTicket(false)}
                          disabled={ticketSubmitting || hasBrokenTicketMedia}
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
                            cursor: (ticketSubmitting || hasBrokenTicketMedia) ? 'not-allowed' : 'pointer',
                            opacity: (ticketSubmitting || hasBrokenTicketMedia) ? 0.6 : 1,
                            boxSizing: 'border-box',
                          }}
                        >
                          {ticketSubmitting ? (formatUploadProgress(ticketUploadProgress) || 'Submitting...') : 'Submit Ticket'}
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
                                    📷 Add a photo or video
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

                    {ticketError && (
                      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.red500 }}>{ticketError}</p>
                    )}
                    {complianceSuccess && (
                      <p style={{ margin: '0 0 16px 0', fontSize: '13px', color: COLORS.green600, fontWeight: 600 }}>✓ {complianceSuccess}</p>
                    )}

                    <button
                      onClick={handleSubmitCompliance}
                      disabled={complianceSubmitting || complianceResults.length === 0 || complianceResults.some(r => r === null)}
                      style={{
                        width: '100%',
                        height: '48px',
                        background: COLORS.slate900,
                        color: COLORS.white,
                        border: 'none',
                        borderRadius: '12px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: (complianceSubmitting || complianceResults.some(r => r === null)) ? 'not-allowed' : 'pointer',
                        opacity: (complianceSubmitting || complianceResults.some(r => r === null)) ? 0.6 : 1,
                        boxSizing: 'border-box',
                      }}
                    >
                      {complianceSubmitting ? (formatUploadProgress(complianceUploadProgress) || 'Submitting...') : 'Submit Compliance Check'}
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
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
                </button>
              </div>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                aria-label="Menu"
                style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '4px', background: 'none', border: 'none', padding: '8px', cursor: 'pointer' }}
              >
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
                <span style={{ width: '22px', height: '2px', background: COLORS.slate900, borderRadius: '2px' }} />
              </button>
            </div>

            {menuOpen && (
              <div style={{ background: COLORS.greenDark, padding: '20px' }}>
                <p style={{ margin: '0 0 2px 0', fontSize: '16px', fontWeight: 800, color: COLORS.white }}>{profile.name}</p>
                <p style={{ margin: '0 0 18px 0', fontSize: '13px', fontWeight: 500, color: COLORS.white, opacity: 0.8 }}>{profile.job_title}</p>

                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {SHOW_LOG_TICKET_NAV && (
                    <button
                      onClick={() => { setPage('new-ticket'); setMenuOpen(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                    >
                      📝 Log a Ticket
                    </button>
                  )}
                  <button
                    onClick={() => { setPage('my-reports'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📋 My Reports
                  </button>
                  <button
                    onClick={() => { setPage('mileage'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    🕐 My Mileage
                  </button>
                  <button
                    onClick={() => { setPage('metrics'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    📊 My Metrics
                  </button>
                  <button
                    onClick={() => { setPage('team-chat'); setMenuOpen(false) }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    <span>💬 Team Chat</span>
                    {unreadMentions > 0 && (
                      <span style={{ background: COLORS.red600, color: COLORS.white, fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '999px' }}>{unreadMentions}</span>
                    )}
                  </button>
                  <button
                    onClick={handleSignOut}
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.15)', padding: '14px 4px', fontSize: '14px', fontWeight: 600, color: COLORS.white, cursor: 'pointer', textAlign: 'left' }}
                  >
                    🚪 Sign out
                  </button>
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>My Reports</h1>
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>Tickets you've personally raised, regardless of who they're assigned to.</p>
            </div>

            {reportedTickets.length === 0 && (
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                <p style={{ color: COLORS.slate400, fontWeight: 600 }}>You haven't raised any tickets yet.</p>
              </div>
            )}

            {reportedTickets.map(t => (
              <div key={t.id} style={{ background: COLORS.white, borderRadius: '16px', marginBottom: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ height: '4px', background: statusColour(t.status) }} />
                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.ticket_number} · {t.category}</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: statusColour(t.status), background: statusColour(t.status) + '18', padding: '3px 10px', borderRadius: '20px' }}>{statusLabel(t.status)}</span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                  {t.photo_url && (
                    <AttachmentMedia url={t.photo_url} alt="Ticket attachment" style={{ width: '100%', borderRadius: '10px', display: 'block' }} linkImages={false} controls={false} />
                  )}
                </div>
              </div>
            ))}

          </div>
        </div>
      )}

      {/* Available Jobs page */}
      {page === 'available-jobs' && (
        <div style={{ position: 'fixed', top: 'var(--pmms-banner-offset, 0px)', left: 0, right: 0, bottom: 0, background: COLORS.slate100, zIndex: 50, overflowY: 'auto', fontFamily: 'system-ui, sans-serif' }}>

          {/* Header */}
          <div style={{ position: 'sticky', top: 0, zIndex: 10 }}>
            <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.slate200}`, padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={() => setPage('jobs')} style={{ background: COLORS.slate100, border: 'none', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', fontWeight: 700, color: COLORS.slate500, cursor: 'pointer' }}>
                  ← Back
                </button>
                <button
                  onClick={goHome}
                  aria-label="Go to home"
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                >
                  <img src={gbchLogo} alt="GBCH" style={{ height: '36px' }} />
                  <span style={{ fontSize: '16px', fontWeight: 800, color: COLORS.slate900 }}>PMMS</span>
                </button>
              </div>
            </div>
          </div>

          <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>

            <div style={{ marginBottom: '16px' }}>
              <h1 style={{ margin: '0 0 4px 0', fontSize: '18px', fontWeight: 700, color: COLORS.slate900 }}>Available Jobs</h1>
              <p style={{ margin: 0, fontSize: '13px', color: COLORS.slate500 }}>
                Unassigned jobs matching your skills. First to claim gets it.
              </p>
            </div>

            {claimError && (
              <div style={{ background: COLORS.red100, border: `1px solid ${COLORS.red200}`, borderRadius: '10px', padding: '12px 16px', marginBottom: '12px' }}>
                <p style={{ margin: 0, fontSize: '13px', color: COLORS.red600, fontWeight: 600 }}>{claimError}</p>
              </div>
            )}

            {availableJobs.length === 0 && (
              <div style={{ background: COLORS.white, borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
                <p style={{ color: COLORS.slate400, fontWeight: 600 }}>No unclaimed jobs matching your skills right now.</p>
              </div>
            )}

            {availableJobs.map(t => (
              <div key={t.id} style={{ background: COLORS.white, borderRadius: '16px', marginBottom: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                <div style={{ height: '4px', background: statusColour(t.status) }} />
                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate400, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Job #{t.ticket_number} · {t.category}</span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: 700, color: COLORS.slate900 }}>{t.property?.address}</p>
                  <p style={{ margin: '0 0 12px 0', fontSize: '13px', color: COLORS.slate500 }}>{t.description}{t.room ? ` — ${t.room}` : ''}</p>
                  <button
                    onClick={() => handleClaimJob(t)}
                    disabled={claimingId === t.id}
                    style={{ width: '100%', padding: '12px', background: COLORS.greenDark, color: COLORS.white, border: 'none', borderRadius: '10px', fontSize: '14px', fontWeight: 700, cursor: claimingId === t.id ? 'not-allowed' : 'pointer', opacity: claimingId === t.id ? 0.6 : 1 }}
                  >
                    {claimingId === t.id ? 'Claiming...' : 'Claim Job'}
                  </button>
                </div>
              </div>
            ))}

          </div>
        </div>
      )}

    </div>
  )
}
