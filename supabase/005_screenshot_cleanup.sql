-- =============================================================================
-- Update 5: delete MT5 screenshots older than 60 days
-- Run once in Supabase AFTER deploying the "cleanup-screenshots" Edge Function:
-- SQL Editor > New query > paste this file > Run.
-- =============================================================================

-- When the screenshots of a trade were deleted. The trade itself is kept.
alter table public.trade_posts add column images_removed_at timestamptz;

-- Every day at 3:00 AM UTC (11:00 AM PH), after the New York session.
select cron.schedule(
  'cleanup-screenshots',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://hffmjtajlsqkhbdrcmpq.supabase.co/functions/v1/cleanup-screenshots',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZm1qdGFqbHNxa2hiZHJjbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDkxODgsImV4cCI6MjEwODcyNTE4OH0.-Sij7FTwWVQiItTZsLVK1aJlWhAXkxHm0Mbopfh5pVE'
    ),
    body := '{}'::jsonb
  );
  $$
);
