import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// "YYYY-MM-DD" in genuine UK calendar-day terms, matched with ukDateKey()
// in client/src/pages/admin/shared.jsx -- BST/GMT-aware via Intl rather
// than a hardcoded offset, and compared against daily_attendance.work_date
// (already stored as a plain date, so no timezone conversion needed on
// that side).
function ukDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

function normalizeCustomRoles(raw: any) {
  if (!Array.isArray(raw)) return []
  return raw.map((r: any) => (typeof r === 'string'
    ? { name: r, accessLevel: 'none' }
    : { name: r.name, accessLevel: r.accessLevel || 'none' }
  ))
}

async function fetchAssignableStaffForRole(adminClient: any, roleName: string) {
  const { data: roleRows } = await adminClient
    .schema('pmms')
    .from('staff_roles')
    .select('staff_id')
    .eq('role', roleName)

  if (!roleRows?.length) return []

  const { data: staffRows } = await adminClient
    .from('staff')
    .select('id, name')
    .in('id', roleRows.map((r: any) => r.staff_id))
    .eq('active', true)

  return staffRows || []
}

// Attendance isn't a per-division concept for a builder (unlike tickets,
// which have a category->division mapping) -- every Admin + every
// manager-accessLevel custom role gets alerted, same as
// check-void-aging/check-compliance-expiry's fetchAllAdminsAndManagers.
async function fetchAllAdminsAndManagers(adminClient: any) {
  const { data: rolesRow } = await adminClient
    .schema('pmms')
    .from('settings')
    .select('setting_value')
    .eq('setting_key', 'custom_roles')
    .maybeSingle()

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
// scripts/add_stale_shift_cron.sql), same pattern as
// check-stuck-tickets/check-clock-out-reminders/etc. verify_jwt is false
// for this function in supabase/config.toml so the secret check below is
// the only gate.
//
// A shift only counts as "stale" once it's BOTH open from a previous UK
// calendar day AND past stale_shift_hours (default 16) -- matches the
// client-side rule in BuilderDashboard.jsx's fetchTodayShift exactly, so
// the push notification and the builder's own block fire at the same
// moment. stale_alert_sent_at is a one-shot guard so a shift that stays
// unresolved for days doesn't re-page every manager every 15 minutes.
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

    const { data: thresholdRow } = await adminClient
      .schema('pmms')
      .from('settings')
      .select('setting_value')
      .eq('setting_key', 'stale_shift_hours')
      .maybeSingle()
    const thresholdHours = thresholdRow?.setting_value != null ? Number(thresholdRow.setting_value) : 16

    const { data: openShifts, error: shiftsError } = await adminClient
      .schema('pmms')
      .from('daily_attendance')
      .select('id, staff_id, work_date, clock_in_at')
      .is('clock_out_at', null)
      .is('stale_alert_sent_at', null)

    if (shiftsError) {
      return new Response(JSON.stringify({ error: shiftsError.message }), { status: 500, headers: corsHeaders })
    }

    const now = new Date()
    const todayKey = ukDateKey(now)
    const staleShifts = (openShifts || []).filter((s: any) => {
      const hoursOpen = (now.getTime() - new Date(s.clock_in_at).getTime()) / 3600000
      return s.work_date !== todayKey && hoursOpen >= thresholdHours
    })

    let alerted = 0
    if (staleShifts.length > 0) {
      const recipients = await fetchAllAdminsAndManagers(adminClient)

      for (const shift of staleShifts) {
        const { data: staffRow } = await adminClient.from('staff').select('name').eq('id', shift.staff_id).maybeSingle()

        if (recipients.length > 0) {
          await sendWebPushToStaff(
            adminClient,
            recipients.map((r: any) => r.id),
            'Shift not closed out',
            `${staffRow?.name || 'A builder'} still hasn't clocked out from ${shift.work_date} -- they're locked out until it's closed.`,
          )
        }

        await adminClient
          .schema('pmms')
          .from('daily_attendance')
          .update({ stale_alert_sent_at: now.toISOString() })
          .eq('id', shift.id)

        alerted += 1
      }
    }

    return new Response(JSON.stringify({ checked: (openShifts || []).length, stale: staleShifts.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
