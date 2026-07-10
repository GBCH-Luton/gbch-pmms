-- Registers the periodic job that calls check-stuck-tickets every 15
-- minutes. pg_net lets a cron job make an outbound HTTP call from inside
-- Postgres -- this is new to this project (the only prior pg_cron job,
-- error_logs' retention delete, never needed to leave the database).
--
-- The literal secret below must match the CRON_SECRET Edge Function
-- secret set via `npx supabase secrets set CRON_SECRET=... --project-ref
-- hfubtfohtieglrvdgblc` -- it's how check-stuck-tickets authenticates
-- this call, since there's no logged-in user for a cron job to present.

create extension if not exists pg_net;

select cron.schedule(
  'check-stuck-tickets',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://hfubtfohtieglrvdgblc.functions.supabase.co/check-stuck-tickets',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '184285e4445895e8e690796857314ea8e3b90b290daaac6d2137b4832fa2efdd'
      ),
      body := '{}'::jsonb
    )
  $$
);
