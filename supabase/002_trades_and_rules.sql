-- =============================================================================
-- Update 2: personal rules, trade posts with MT5 proof, coach review
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- (schema.sql must already have been run.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Each student's own rules for a month. Locked once the day they were set ends.
-- ---------------------------------------------------------------------------
create table public.rulebooks (
  id                uuid primary key default gen_random_uuid(),
  student_id        uuid not null references public.students(id) on delete cascade,
  month             date not null check (extract(day from month) = 1),
  max_risk_pct      numeric(5, 2) not null check (max_risk_pct > 0 and max_risk_pct <= 100),
  max_trades_day    int not null check (max_trades_day between 1 and 50),
  max_trades_week   int not null check (max_trades_week between 1 and 250),
  max_daily_loss_r  numeric(5, 2) check (max_daily_loss_r > 0),
  personal_rules    text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  unique (student_id, month)
);

-- ---------------------------------------------------------------------------
-- One row per trade, attached to a check-in day.
-- ---------------------------------------------------------------------------
create table public.trade_posts (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  date          date not null,
  symbol        text not null,
  direction     text not null check (direction in ('Long', 'Short')),
  setup         text,
  session       text,
  entry_time_ny time,
  risk_pct      numeric(5, 2) not null check (risk_pct >= 0),
  result_r      numeric(6, 2) not null,
  ticket        text,
  mt5_path      text not null,
  chart_url     text not null,
  thoughts      text not null,
  created_at    timestamptz not null default now(),
  edited_at     timestamptz
);
create index trade_posts_student_date_idx on public.trade_posts (student_id, date);

-- ---------------------------------------------------------------------------
-- Check-ins: coach review and the automatic rule check
-- ---------------------------------------------------------------------------
alter table public.check_ins
  add column coach_status  text check (coach_status in ('valid', 'invalid')),
  add column coach_note    text,
  add column reviewed_at   timestamptz,
  add column auto_flags    text[] not null default '{}',
  add column rules_ticked  text[] not null default '{}';

-- Students can't set their own review. Editing a day the coach approved sends it back for
-- review; a day the coach marked "not valid" stays not valid.
create or replace function public.guard_coach_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.coach_status := null;
    new.coach_note := null;
    new.reviewed_at := null;
  elsif old.coach_status = 'invalid' then
    new.coach_status := old.coach_status;
    new.coach_note := old.coach_note;
    new.reviewed_at := old.reviewed_at;
  else
    new.coach_status := null;
    new.coach_note := old.coach_note;
    new.reviewed_at := null;
  end if;
  return new;
end
$$;

create trigger check_ins_guard_coach
  before insert or update on public.check_ins
  for each row execute function public.guard_coach_fields();

-- Leaderboard: a day the coach marked "not valid" counts as an X.
create or replace function public.cohort_marks(from_date date, to_date date)
returns table (student_id uuid, date date, mark text)
language sql stable security definer set search_path = public as $$
  select c.student_id, c.date,
         case when c.coach_status = 'invalid' then 'X' else c.mark end
  from public.check_ins c
  join public.students s on s.id = c.student_id
  where s.status = 'active'
    and c.date between from_date and to_date
    and auth.uid() is not null
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.rulebooks   enable row level security;
alter table public.trade_posts enable row level security;

create policy "read own" on public.rulebooks for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "insert own" on public.rulebooks for insert to authenticated
  with check (student_id = public.my_student_id()
              and month >= date_trunc('month', public.ny_today())::date
              and month <= (date_trunc('month', public.ny_today()) + interval '1 month')::date);
create policy "update own same day" on public.rulebooks for update to authenticated
  using (student_id = public.my_student_id()
         and (created_at at time zone 'America/New_York')::date = public.ny_today())
  with check (student_id = public.my_student_id());
create policy "admin" on public.rulebooks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "read own" on public.trade_posts for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "insert own" on public.trade_posts for insert to authenticated
  with check (student_id = public.my_student_id()
              and date between public.ny_today() - 3 and public.ny_today());
create policy "update own" on public.trade_posts for update to authenticated
  using (student_id = public.my_student_id() and date between public.ny_today() - 3 and public.ny_today())
  with check (student_id = public.my_student_id() and date between public.ny_today() - 3 and public.ny_today());
create policy "delete own" on public.trade_posts for delete to authenticated
  using (student_id = public.my_student_id() and date between public.ny_today() - 3 and public.ny_today());
create policy "admin" on public.trade_posts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- MT5 screenshots: private bucket, one folder per student. Only that student and
-- the admin can see them. Max 3 MB per image.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('executions', 'executions', false, 3145728, array['image/jpeg', 'image/png', 'image/webp']);

create policy "executions: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'executions'
              and (storage.foldername(name))[1] = public.my_student_id()::text);
create policy "executions: read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'executions'
         and ((storage.foldername(name))[1] = public.my_student_id()::text or public.is_admin()));
create policy "executions: delete own or admin" on storage.objects for delete to authenticated
  using (bucket_id = 'executions'
         and ((storage.foldername(name))[1] = public.my_student_id()::text or public.is_admin()));
