-- Registers the periodic job that calls check-long-running-jobs every 15
-- minutes, same pattern as every other check-* cron (add_stuck_ticket_cron.sql,
-- add_long_break_alert_cron.sql, etc.). The secret below must match the
-- CRON_SECRET Edge Function secret already set on this project -- replace
-- the placeholder before running, same as those scripts.

select cron.schedule(
  'check-long-running-jobs',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://wvhelwxyzdkfjpyyxvbc.functions.supabase.co/check-long-running-jobs',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
      ),
      body := '{}'::jsonb
    )
  $$
);
