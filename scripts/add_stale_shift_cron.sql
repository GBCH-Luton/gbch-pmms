-- Registers the every-15-minutes job that calls check-stale-shifts, same
-- interval as check-stuck-tickets/check-clock-out-reminders so a stale
-- shift gets alerted within 15 minutes of crossing the threshold.
--
-- Reuses the same CRON_SECRET Edge Function secret already set for
-- check-stuck-tickets/check-compliance-expiry/check-void-aging/
-- check-routine-visits-due/check-garden-service-due/
-- check-clock-out-reminders -- no new secret needed.

select cron.schedule(
  'check-stale-shifts',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://wvhelwxyzdkfjpyyxvbc.functions.supabase.co/check-stale-shifts',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'b13134e5c233895dd95c645c7f5ed6f55e0f8a16ad6276b63dba00d32fc93e81'
      ),
      body := '{}'::jsonb
    )
  $$
);
