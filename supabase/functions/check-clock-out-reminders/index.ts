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

// Triggered every 15 minutes by pg_cron + pg_net (see
// scripts/add_clock_out_reminder_cron.sql), same shared-secret pattern as
// check-stuck-tickets/check-compliance-expiry/check-void-aging/
// check-routine-visits-due -- verify_jwt is false for this function in
// supabase/config.toml so the secret check below is the only gate.
//
// Unlike those, the recipient here is the builder themselves, not a
// manager -- this is a personal reminder ("you're still clocked in"), not
// an escalation. clock_out_reminder_sent_at is a one-shot guard so someone
// who stays clocked in past the deadline for hours only gets pinged once,
// not every 15 minutes.
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

    const nowUk = ukTimeHHMM(new Date())
    if (nowUk < reminderTime) {
      return new Response(JSON.stringify({ skipped: 'before reminder time', nowUk, reminderTime }), { status: 200, headers: corsHeaders })
    }

    const { data: openShifts, error: shiftsError } = await adminClient
      .schema('pmms')
      .from('daily_attendance')
      .select('id, staff_id')
      .is('clock_out_at', null)
      .is('clock_out_reminder_sent_at', null)

    if (shiftsError) {
      return new Response(JSON.stringify({ error: shiftsError.message }), { status: 500, headers: corsHeaders })
    }

    let reminded = 0
    for (const shift of openShifts || []) {
      await sendWebPushToStaff(adminClient, [shift.staff_id], "Don't forget to clock out", "You're still clocked in for the day -- tap to clock out when you're finished.")
      await adminClient
        .schema('pmms')
        .from('daily_attendance')
        .update({ clock_out_reminder_sent_at: new Date().toISOString() })
        .eq('id', shift.id)
      reminded += 1
    }

    return new Response(JSON.stringify({ checked: (openShifts || []).length, reminded }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
