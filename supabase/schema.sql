-- =============================================================================
-- Winner Circle Traders · Accountability Check-in
-- Run this whole file once in Supabase: Dashboard > SQL Editor > New query > Run
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.batches (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  start_date  date not null,
  end_date    date,
  slots       int,
  created_at  timestamptz not null default now()
);

-- Roster. Only the admin can add rows. A student can create a login only if
-- their email is already here (see handle_new_user below).
create table public.students (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users(id) on delete set null,
  full_name       text not null,
  email           text not null,
  batch_id        uuid references public.batches(id) on delete set null,
  role            text not null default 'student' check (role in ('student', 'admin')),
  status          text not null default 'active' check (status in ('active', 'inactive')),
  discord_handle  text,
  joined_date     date not null default current_date,
  created_at      timestamptz not null default now()
);
create unique index students_email_key on public.students (lower(email));

-- Only exceptions are stored. Every Mon-Fri with no row is a NORMAL trading day.
create table public.trading_days (
  date                 date primary key,
  is_trading_day       boolean not null default true,
  news_status          text not null default 'NORMAL' check (news_status in ('NORMAL', 'RESTRICTED', 'NO_TRADE')),
  news_label           text,
  trade_allowed_after  time
);

create table public.check_ins (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students(id) on delete cascade,
  date             date not null,
  mark             text not null check (mark in ('CHECK', 'X', 'NO_ENTRY')),
  setup            text,
  session          text,
  mistake_tags     text[] not null default '{}',
  reason_note      text,
  no_entry_reason  text check (no_entry_reason in ('no_setup', 'news_day', 'missed_session', 'other')),
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  unique (student_id, date)
);
create index check_ins_date_idx on public.check_ins (date);

create table public.challenges (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  start_date       date not null,
  end_date         date not null,
  min_checkin_pct  int not null default 100 check (min_checkin_pct between 0 and 100),
  min_rules_pct    int not null default 100 check (min_rules_pct between 0 and 100),
  created_at       timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Written by a student after completing a challenge. Your testimonial pipeline.
create table public.reflections (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students(id) on delete cascade,
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  body          text not null,
  can_share     boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (student_id, challenge_id)
);

create table public.app_settings (
  id                  int primary key default 1 check (id = 1),
  followup_threshold  int not null default 2,
  inactive_days       int not null default 3
);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

create or replace function public.ny_today() returns date
language sql stable as $$
  select (now() at time zone 'America/New_York')::date
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.students where user_id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students
    where user_id = auth.uid() and role = 'admin' and status = 'active'
  )
$$;

-- Sign-up gate: reject any email that is not on the roster, otherwise link it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  sid uuid;
begin
  select id into sid from public.students
  where lower(email) = lower(new.email) and user_id is null and status = 'active';
  if sid is null then
    raise exception 'EMAIL_NOT_ON_ROSTER';
  end if;
  update public.students set user_id = new.id where id = sid;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Re-links a login to its roster row if the admin deleted and re-added the student.
create or replace function public.link_my_account() returns void
language sql security definer set search_path = public as $$
  update public.students
  set user_id = auth.uid()
  where user_id is null
    and status = 'active'
    and lower(email) = lower(auth.jwt() ->> 'email')
    and auth.uid() is not null
$$;

-- Leaderboard data: names and marks only, never notes or emails.
create or replace function public.cohort_roster()
returns table (id uuid, full_name text, batch_id uuid, joined_date date, role text)
language sql stable security definer set search_path = public as $$
  select s.id, s.full_name, s.batch_id, s.joined_date, s.role
  from public.students s
  where s.status = 'active' and auth.uid() is not null
$$;

create or replace function public.cohort_marks(from_date date, to_date date)
returns table (student_id uuid, date date, mark text)
language sql stable security definer set search_path = public as $$
  select c.student_id, c.date, c.mark
  from public.check_ins c
  join public.students s on s.id = c.student_id
  where s.status = 'active'
    and c.date between from_date and to_date
    and auth.uid() is not null
$$;

revoke execute on function public.cohort_roster() from anon, public;
revoke execute on function public.cohort_marks(date, date) from anon, public;
revoke execute on function public.link_my_account() from anon, public;
grant execute on function public.cohort_roster() to authenticated;
grant execute on function public.cohort_marks(date, date) to authenticated;
grant execute on function public.link_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.batches      enable row level security;
alter table public.students     enable row level security;
alter table public.trading_days enable row level security;
alter table public.check_ins    enable row level security;
alter table public.challenges   enable row level security;
alter table public.reflections  enable row level security;
alter table public.app_settings enable row level security;

-- Reference tables: everyone signed in reads, only the admin writes.
create policy "read" on public.batches      for select to authenticated using (true);
create policy "read" on public.trading_days for select to authenticated using (true);
create policy "read" on public.challenges   for select to authenticated using (true);
create policy "read" on public.app_settings for select to authenticated using (true);
create policy "admin" on public.batches      for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin" on public.trading_days for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin" on public.challenges   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admin" on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Roster: a student sees only their own row. Only the admin adds or edits.
create policy "read own" on public.students for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy "admin" on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Check-ins: a student reads their own and can mark today or the 3 days before.
create policy "read own" on public.check_ins for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "insert own" on public.check_ins for insert to authenticated
  with check (student_id = public.my_student_id()
              and date between public.ny_today() - 3 and public.ny_today());
create policy "update own" on public.check_ins for update to authenticated
  using (student_id = public.my_student_id()
         and date between public.ny_today() - 3 and public.ny_today())
  with check (student_id = public.my_student_id()
              and date between public.ny_today() - 3 and public.ny_today());
create policy "admin" on public.check_ins for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Reflections: a student writes their own, the admin reads all.
create policy "read own" on public.reflections for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "insert own" on public.reflections for insert to authenticated
  with check (student_id = public.my_student_id());
create policy "update own" on public.reflections for update to authenticated
  using (student_id = public.my_student_id()) with check (student_id = public.my_student_id());
create policy "admin" on public.reflections for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------------------

insert into public.app_settings (id) values (1);

insert into public.batches (name, start_date, end_date, slots) values
  ('Batch 1', '2026-09-05', '2026-09-26', 41),
  ('Batch 2', '2026-10-03', '2026-10-24', 70),
  ('Batch 3', '2026-11-07', '2026-11-28', 40);

-- You, the admin. Sign up on the site with this email after running this file.
insert into public.students (full_name, email, role, joined_date)
values ('John Oliver Fornillos', 'fornillosoliver@gmail.com', 'admin', '2026-09-01');

-- October news days, copied from row 6 of the October sheet.
insert into public.trading_days (date, news_status, news_label, trade_allowed_after) values
  ('2026-10-01', 'NO_TRADE',   'Day before NFP',                null),
  ('2026-10-02', 'RESTRICTED', 'NFP 8:30',                      '09:00'),
  ('2026-10-07', 'NO_TRADE',   'FOMC',                          null),
  ('2026-10-12', 'NO_TRADE',   'US holiday',                    null),
  ('2026-10-13', 'NO_TRADE',   'Day before CPI',                null),
  ('2026-10-14', 'RESTRICTED', 'Core CPI 8:30 · Day before PPI', null),
  ('2026-10-15', 'RESTRICTED', 'Core PPI 8:30',                 '09:00'),
  ('2026-10-28', 'NO_TRADE',   'FOMC 2PM',                      null),
  ('2026-11-26', 'NO_TRADE',   'US holiday · Thanksgiving',     null);
