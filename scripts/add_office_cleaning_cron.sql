-- Registers the weekday-morning job that calls check-office-cleaning-due.
-- Monday-Friday only at the cron level (the function itself also checks
-- the weekday as a backstop) -- staggered half an hour after
-- check-routine-visits-due.
--
-- Reuses the same CRON_SECRET Edge Function secret already set for the
-- other check-* jobs -- no new secret needed.

select cron.schedule(
  'check-office-cleaning-due',
  '30 7 * * 1-5',
  $$
    select net.http_post(
      url := 'https://wvhelwxyzdkfjpyyxvbc.functions.supabase.co/check-office-cleaning-due',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', 'YOUR_CRON_SECRET_HERE'
      ),
      body := '{}'::jsonb
    )
  $$
);
