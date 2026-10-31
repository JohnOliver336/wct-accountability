-- =============================================================================
-- Update 6: schedules for the daily reminder emails and the weekly Claude report
-- Run once in Supabase AFTER deploying the "daily-reminders" and "weekly-report"
-- Edge Functions and adding their secrets: SQL Editor > New query > paste > Run.
-- BEFORE running, replace both PASTE_YOUR_CRON_SECRET_HERE with your CRON_SECRET.
-- Never commit the real secret to GitHub; keep this file with the placeholder.
-- =============================================================================

-- Daily reminders: Monday-Friday at 11:00 PM PH (15:00 UTC), after the NY open session.
select cron.schedule(
  'daily-reminders',
  '0 15 * * 1-5',
  $$
  select net.http_post(
    url := 'https://hffmjtajlsqkhbdrcmpq.supabase.co/functions/v1/daily-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'PASTE_YOUR_CRON_SECRET_HERE',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZm1qdGFqbHNxa2hiZHJjbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDkxODgsImV4cCI6MjEwODcyNTE4OH0.-Sij7FTwWVQiItTZsLVK1aJlWhAXkxHm0Mbopfh5pVE'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Weekly report: Saturday 7:00 AM PH (Friday 23:00 UTC), before the 10 AM lesson.
select cron.schedule(
  'weekly-report',
  '0 23 * * 5',
  $$
  select net.http_post(
    url := 'https://hffmjtajlsqkhbdrcmpq.supabase.co/functions/v1/weekly-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'PASTE_YOUR_CRON_SECRET_HERE',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmZm1qdGFqbHNxa2hiZHJjbXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNDkxODgsImV4cCI6MjEwODcyNTE4OH0.-Sij7FTwWVQiItTZsLVK1aJlWhAXkxHm0Mbopfh5pVE'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
