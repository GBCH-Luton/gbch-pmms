-- Registers the daily job that calls check-garden-service-due. Staggered
-- an hour after check-routine-visits-due (which is an hour after
-- check-void-aging, which is an hour after check-compliance-expiry).
--
-- Reuses the same CRON_SECRET Edge Function secret already set for
-- check-stuck-tickets/check-compliance-expiry/check-void-aging/
-- check-routine-visits-due -- no new secret needed.

select cron.schedule(
  'check-garden-service-due',
  '0 9 * * *',
  $$
    select net.http_post(
      url := 'https://wvhelwxyzdkfjpyyxvbc.functions.supabase.co/check-garden-service-due',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'b13134e5c233895dd95c645c7f5ed6f55e0f8a16ad6276b63dba00d32fc93e81'
      ),
      body := '{}'::jsonb
    )
  $$
);
