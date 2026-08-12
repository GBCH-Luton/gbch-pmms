import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// "HH:mm" in genuine UK wall-clock time, matched with ukTimeHHMM() in
// client/src/pages/admin/shared.jsx -- BST/GMT-aware via Intl rather than
// a hardcoded offset.
function ukTimeHHMM(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  return `${get('hour')}:${get('minute')}`
}

// Turns "17:00 on 2026-08-11, UK local time" into the correct UTC instant
// -- BST vs GMT means a plain `${date}T${time}:00Z` string would be off by
// an hour for roughly half the year. Guesses UTC, measures how far that
// guess's own UK-local time is from the target, and corrects by the
// difference (always 0 or ±60 minutes for this timezone, so one pass is
// enough -- no need for a full timezone library just for this).
function ukLocalToUtcIso(dateStr: string, hhmm: string) {
  const guessUtc = new Date(`${dateStr}T${hhmm}:00Z`)
  const [gh, gm] = ukTimeHHMM(guessUtc).split(':').map(Number)
  const [th, tm] = hhmm.split(':').map(Number)
  const diffMinutes = (th * 60 + tm) - (gh * 60 + gm)
  return new Date(guessUtc.getTime() + diffMinutes * 60000).toISOString()
}

function normalizeCustomRoles(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => (typeof r === 'string'
    ? { name: r, accessLevel: 'none' }
    : { name: r.name, accessLevel: r.accessLevel || 'none' }
  ))
}

async function fetchAssignableStaffForRole(adminClient: any, roleName: string) {
  const { data: roleRows } = await adminClient.schema('pmms').from('staff_roles').select('staff_id').eq('role', roleName)
  if (!roleRows?.length) return []
  const { data: staffRows } = await adminClient.from('staff').select('id, name').in('id', roleRows.map((r: any) => r.staff_id)).eq('active', true)
  return staffRows || []
}

// The builder's last recorded position for this shift -- their most
// recently started job's clock-out coordinates, or its clock-in
// coordinates if that job was paused/still open when the shift got
// auto-closed. Bounded to sessions started on/after this shift's own
// clock-in so a previous day's last job is never picked up. Returns
// { lat, lng } (both possibly null if nothing usable was ever recorded).
async function resolveLastKnownLocation(adminClient: any, staffId: string, shiftClockInAt: string) {
  const { data: session } = await adminClient
    .schema('pmms')
    .from('work_sessions')
    .select('clock_in_lat, clock_in_lng, clock_out_lat, clock_out_lng')
    .eq('builder_id', staffId)
    .gte('started_at', shiftClockInAt)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!session) return { lat: null, lng: null }
  if (session.clock_out_lat != null && session.clock_out_lng != null) {
    return { lat: session.clock_out_lat, lng: session.clock_out_lng }
  }
  return { lat: session.clock_in_lat ?? null, lng: session.clock_in_lng ?? null }
}

// Matches BuilderDashboard.jsx's own SHORT_TRIP_REASONS -- kept in sync by
// hand, same as check-long-breaks' own copy, since a Deno function can't
// import the client bundle.
const SHORT_TRIP_REASONS = ['Going to the Office', 'Lunch Break', 'Getting materials myself']

// The whole point of Stage 3: closing daily_attendance alone leaves
// whatever job the builder had open -- either genuinely In Progress, or
// locked on a short-trip break (On Hold + a SHORT_TRIP_REASONS reason) --
// running with no end in sight, sometimes into the next day, where Focus
// Mode would silently re-lock the builder straight back onto it (found
// live 2026-08-12: a job ran 19+ hours across that exact boundary). Pauses
// it instead of completing it -- there's no way to know if the work was
// actually finished -- tagged distinctly so it's obviously a system action,
// not the builder's own choice, and released (not left on a short-trip
// hold_reason) so it does NOT re-lock the builder tomorrow. At most one
// such ticket should ever exist per builder, matching the app's own
// single-active-job rule.
async function pauseOpenJob(adminClient: any, staffId: string, backdated: string, lastKnown: { lat: number | null, lng: number | null }) {
  // Two plain queries rather than one .or()/.in() filter -- simpler to get
  // right than PostgREST's or-filter syntax for a value ("In Progress")
  // that itself contains a space, on a function that runs unattended.
  const { data: inProgressTicket } = await adminClient
    .schema('pmms')
    .from('tickets')
    .select('id, ticket_number, status')
    .eq('assigned_builder_id', staffId)
    .eq('status', 'In Progress')
    .limit(1)
    .maybeSingle()

  const { data: shortTripTicket } = inProgressTicket ? { data: null } : await adminClient
    .schema('pmms')
    .from('tickets')
    .select('id, ticket_number, status')
    .eq('assigned_builder_id', staffId)
    .eq('status', 'On Hold')
    .in('hold_reason', SHORT_TRIP_REASONS)
    .limit(1)
    .maybeSingle()

  const openTicket = inProgressTicket || shortTripTicket
  if (!openTicket) return false

  const previousStatus = openTicket.status
  await adminClient
    .schema('pmms')
    .from('tickets')
    .update({
      status: 'On Hold',
      status_changed_at: backdated,
      hold_reason: 'Auto-paused (Day Ended)',
      hold_note: "System paused this job because the builder's day was auto-clocked-out without resolving it.",
      stuck_alert_sent_at: null,
      long_break_alert_sent_at: null,
      long_running_job_alert_sent_at: null,
    })
    .eq('id', openTicket.id)

  await adminClient
    .schema('pmms')
    .from('work_sessions')
    .update({ ended_at: backdated, clock_out_lat: lastKnown.lat, clock_out_lng: lastKnown.lng })
    .eq('ticket_id', openTicket.id)
    .is('ended_at', null)

  // actor_id is the builder's own id (not null) so this shows up in their
  // own History/Where's the Team feed like any other status change --
  // actor_name is what makes it read as a system action, not a real click.
  await adminClient.schema('pmms').from('audit_events').insert({
    ticket_id: openTicket.id,
    actor_id: staffId,
    actor_name: 'System (Day Auto-Clockout)',
    action: 'Status Changed',
    summary: `${previousStatus} → On Hold (Auto-paused (Day Ended) — builder's day was auto-clocked-out without resolving this job)`,
  })

  return true
}

// Same helper as check-stale-shifts/index.ts, copied rather than shared --
// attendance isn't a per-division concept for a builder (unlike tickets),
// so every Admin + every manager-accessLevel custom role gets alerted.
async function fetchAllAdminsAndManagers(adminClient: any) {
  const { data: rolesRow } = await adminClient.schema('pmms').from('settings').select('setting_value').eq('setting_key', 'custom_roles').maybeSingle()
  const normalizedCustomRoles = normalizeCustomRoles(rolesRow?.setting_value)
  const managerRoleNames = normalizedCustomRoles.filter((r: any) => r.accessLevel === 'manager').map((r: any) => r.name)

  const [managerLists, admins] = await Promise.all([
    Promise.all(managerRoleNames.map((name: string) => fetchAssignableStaffForRole(adminClient, name))),
    fetchAssignableStaffForRole(adminClient, 'Admin'),
  ])

  const byId: Record<string, any> = {}
  ;[...managerLists.flat(), ...admins].forEach((s: any) => { byId[s.id] = s })
  return Object.values(byId)
}

// Triggered every 15 minutes by pg_cron + pg_net (see
// scripts/add_clock_out_reminder_cron.sql), same shared-secret pattern as
// check-stuck-tickets/check-compliance-expiry/check-void-aging/
// check-routine-visits-due -- verify_jwt is false for this function in
// supabase/config.toml so the secret check below is the only gate.
//
// Builder v.2 ("Locked Job Focus Mode") extended this from a single
// builder-only reminder into a 3-stage escalation, all driven off the same
// 15-minute tick, entirely via one-shot guard columns on daily_attendance
// so re-running never double-fires any stage:
//   1. At the deadline (daily_clock_out_reminder_time, default 17:00) --
//      remind the builder. Unchanged from the original version of this
//      function.
//   2. 15 minutes before the grace period (auto_clock_out_grace_minutes,
//      default 120) expires -- alert every admin/manager, a chance to step
//      in manually (they already have a "Clock Out For Them" action on
//      AdminClocking.jsx) before stage 3 fires.
//   3. Once the grace period fully expires with the shift still open --
//      the system closes it itself. clock_out_at is backdated to the
//      deadline time on today's date, not whenever this actually ran, so
//      reported hours reflect the 17:00 cutoff everyone already expects,
//      not an arbitrary cron-tick timestamp. auto_clocked_out marks it
//      distinctly from clock_out_override (that column means a manager did
//      it by hand -- AdminClocking.jsx already labels it "Manager
//      override", which this must never be confused with). There's no real
//      GPS reading at a backdated instant, so clock_out_lat/lng are
//      backfilled from the builder's own last recorded position that shift
//      (their last job's clock-out, or clock-in if that job was never
//      finished) rather than left blank -- see resolveLastKnownLocation.
//      Also pauses whatever job the builder still had open at that moment
//      (see pauseOpenJob) -- directors approved this 2026-08-12, after a
//      job was found still running 19+ hours past its builder's own
//      auto-clockout, silently re-locking him into it the next morning.
//
// This only ever closes TODAY's still-open shift. It does not touch
// check-stale-shifts.ts's separate next-morning lockout -- that remains
// the backstop for the (now much rarer) case where a shift is still
// unresolved a full day later; the two were deliberately left to coexist
// rather than one replacing the other.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const cronSecret = Deno.env.get('CRON_SECRET')
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: reminderTimeRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'daily_clock_out_reminder_time')
      .maybeSingle()
    const reminderTime = reminderTimeRow?.setting_value || '17:00'

    const { data: graceRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'auto_clock_out_grace_minutes')
      .maybeSingle()
    const graceMinutes = graceRow?.setting_value != null ? Number(graceRow.setting_value) : 120

    const now = new Date()
    const nowUk = ukTimeHHMM(now)
    if (nowUk < reminderTime) {
      return new Response(JSON.stringify({ skipped: 'before reminder time', nowUk, reminderTime }), { status: 200, headers: corsHeaders })
    }

    const [deadlineH, deadlineM] = reminderTime.split(':').map(Number)
    const [nowH, nowM] = nowUk.split(':').map(Number)
    const minutesPastDeadline = (nowH * 60 + nowM) - (deadlineH * 60 + deadlineM)

    const { data: openShifts, error: shiftsError } = await adminClient
      .schema('pmms')
      .from('daily_attendance')
      .select('id, staff_id, work_date, clock_in_at, clock_out_reminder_sent_at, manager_clock_out_alert_sent_at')
      .is('clock_out_at', null)

    if (shiftsError) {
      return new Response(JSON.stringify({ error: shiftsError.message }), { status: 500, headers: corsHeaders })
    }

    let reminded = 0
    let managerAlerted = 0
    let autoClosed = 0
    let jobsPaused = 0
    let recipients: any[] | null = null

    for (const shift of openShifts || []) {
      // Stage 1 -- builder's own reminder, one-shot.
      if (!shift.clock_out_reminder_sent_at) {
        await sendWebPushToStaff(adminClient, [shift.staff_id], "Don't forget to clock out", "You're still clocked in for the day -- tap to clock out when you're finished.")
        await adminClient.schema('pmms').from('daily_attendance').update({ clock_out_reminder_sent_at: now.toISOString() }).eq('id', shift.id)
        reminded += 1
      }

      // Stage 2 -- managers, 15 minutes ahead of the auto-close threshold.
      if (!shift.manager_clock_out_alert_sent_at && minutesPastDeadline >= graceMinutes - 15) {
        if (recipients === null) recipients = await fetchAllAdminsAndManagers(adminClient)
        if (recipients.length > 0) {
          const { data: staffRow } = await adminClient.from('staff').select('name').eq('id', shift.staff_id).maybeSingle()
          await sendWebPushToStaff(
            adminClient,
            recipients.map((r: any) => r.id),
            'Still clocked in',
            `${staffRow?.name || 'A builder'} is still clocked in, past their ${reminderTime} deadline.`,
          )
        }
        await adminClient.schema('pmms').from('daily_attendance').update({ manager_clock_out_alert_sent_at: now.toISOString() }).eq('id', shift.id)
        managerAlerted += 1
      }

      // Stage 3 -- auto-close, only once the grace period has fully
      // expired. Backdated to the deadline time on the shift's own work
      // date (not "now"), same UK-local rule ukTimeHHMM already applies.
      if (minutesPastDeadline >= graceMinutes) {
        const backdated = ukLocalToUtcIso(shift.work_date, reminderTime)
        const lastKnown = await resolveLastKnownLocation(adminClient, shift.staff_id, shift.clock_in_at)
        await adminClient
          .schema('pmms')
          .from('daily_attendance')
          .update({ clock_out_at: backdated, auto_clocked_out: true, clock_out_lat: lastKnown.lat, clock_out_lng: lastKnown.lng })
          .eq('id', shift.id)
        autoClosed += 1
        if (await pauseOpenJob(adminClient, shift.staff_id, backdated, lastKnown)) jobsPaused += 1
      }
    }

    return new Response(JSON.stringify({ checked: (openShifts || []).length, reminded, managerAlerted, autoClosed, jobsPaused }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
