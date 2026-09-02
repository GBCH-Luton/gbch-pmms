import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { sendWebPushToStaff } from '../_shared/webPush.ts'

// "Head Lease Renewal -- Automatic Reminder Only" (directors' spec,
// 2026-09-02): not a Temporary Task type, just a daily check. Renewal date
// = head_lease_signed_date + 6 years; LLO is notified once, 3 months
// before that date. She isn't responsible for the renewal itself at this
// stage -- just for escalating it to Senior Management -- so admins get
// the same alert alongside her, matching every other property alert cron
// in this app (compliance expiry, void aging).
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

    const { data: candidates, error: candidatesError } = await adminClient
      .schema('pmms')
      .from('properties')
      .select('id, address, head_lease_signed_date')
      .not('head_lease_signed_date', 'is', null)
      .is('head_lease_renewal_alert_sent_at', null)

    if (candidatesError) {
      return new Response(JSON.stringify({ error: candidatesError.message }), { status: 500, headers: corsHeaders })
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const due = (candidates || []).filter((p: any) => {
      const renewalDate = new Date(p.head_lease_signed_date)
      renewalDate.setFullYear(renewalDate.getFullYear() + 6)
      const alertDate = new Date(renewalDate)
      alertDate.setMonth(alertDate.getMonth() - 3)
      return today.getTime() >= alertDate.getTime()
    })

    let alerted = 0
    if (due.length > 0) {
      const [llo, admins] = await Promise.all([
        fetchAssignableStaffForRole(adminClient, 'Landlord Liaison Manager'),
        fetchAssignableStaffForRole(adminClient, 'Admin'),
      ])
      const byId: Record<string, any> = {}
      ;[...llo, ...admins].forEach((s: any) => { byId[s.id] = s })
      const recipients = Object.values(byId)

      for (const p of due) {
        if (recipients.length > 0) {
          await sendWebPushToStaff(
            adminClient,
            recipients.map((s: any) => s.id),
            `Head Lease Renewal Due in 3 Months — ${p.address}`,
            'Please notify Senior Management that the Head Lease is approaching its renewal date.',
          )
        }

        await adminClient
          .schema('pmms')
          .from('properties')
          .update({ head_lease_renewal_alert_sent_at: new Date().toISOString() })
          .eq('id', p.id)

        alerted += 1
      }
    }

    return new Response(JSON.stringify({ checked: candidates?.length || 0, due: due.length, alerted }), { status: 200, headers: corsHeaders })
  } catch (err) {
    if (err instanceof Response) return err
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders })
  }
})
