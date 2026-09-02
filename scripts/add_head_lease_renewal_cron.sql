-- Registers the daily job that calls check-head-lease-renewal. Same
-- pattern as add_compliance_expiry_cron.sql -- reuses the existing
-- CRON_SECRET Edge Function secret, no new secret needed. Replace
-- YOUR_CRON_SECRET_HERE with the real value before running (never commit
-- the real secret -- see the CRON_SECRET rotation incident, 2026-08-24).
select cron.schedule(
  'check-head-lease-renewal',
  '0 6 * * *',
  $$
    select net.http_post(
      url := 'https://hfubtfohtieglrvdgblc.functions.supabase.co/check-head-lease-renewal',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
      ),
      body := '{}'::jsonb
    )
  $$
);
