-- =============================================================================
-- Update 4: Forex Factory auto-sync for the news calendar
-- Run once in Supabase AFTER deploying the "ff-sync" Edge Function:
-- SQL Editor > New query > paste this file > Run.
-- =============================================================================

-- Where each calendar day came from. Days you set by hand ('manual') are never
-- overwritten by the sync.
alter table public.trading_days
  add column source text not null default 'manual' check (source in ('manual', 'forexfactory')),
  add column synced_at timestamptz;

-- Run the sync every 6 hours. Forex Factory publishes one week at a time, so the
-- new week appears on Sunday and stays up to date through the week.
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'ff-sync',
  '0 */6 * * *',
  $$
  select net.http_post(
    url := 'https://hffmjtajlsqkhbdrcmpq.supabase.co/functions/v1/ff-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZm1qdGFqbHNxa2hiZHJjbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDkxODgsImV4cCI6MjEwODcyNTE4OH0.-Sij7FTwWVQiItTZsLVK1aJlWhAXkxHm0Mbopfh5pVE'
    ),
    body := '{}'::jsonb
  );
  $$
);
