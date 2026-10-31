-- =============================================================================
-- Update 7: challenge awards, team battle and prize claims
--   - A challenge can be limited to some batches (e.g. Batch 1 vs Batch 2).
--   - When it ends it is finalized automatically: Most Disciplined, Most Active,
--     and a random draw from the winning batch (team score = average per student
--     of discipline % x check-in rate). The draw runs once and is stored.
--   - Winners claim their prize with their prop firm and registered email.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- =============================================================================

alter table public.challenges
  add column batch_ids uuid[],                         -- null = every batch
  add column award_min_checkin_pct int not null default 80 check (award_min_checkin_pct between 0 and 100),
  add column team_draw_count int not null default 1 check (team_draw_count between 0 and 50),
  add column team_results jsonb,
  add column finalized_at timestamptz;

create table public.challenge_winners (
  id             uuid primary key default gen_random_uuid(),
  challenge_id   uuid not null references public.challenges(id) on delete cascade,
  student_id     uuid not null references public.students(id) on delete cascade,
  category       text not null check (category in ('discipline', 'active', 'team')),
  details        jsonb not null default '{}',
  prop_firm      text,
  prop_email     text,
  claimed_at     timestamptz,
  prize_sent_at  timestamptz,
  created_at     timestamptz not null default now(),
  unique (challenge_id, category, student_id)
);

alter table public.challenge_winners enable row level security;

-- A winner sees only their own row (with their prop firm email). The admin sees all.
create policy "read own" on public.challenge_winners for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "claim own" on public.challenge_winners for update to authenticated
  using (student_id = public.my_student_id()) with check (student_id = public.my_student_id());
create policy "admin" on public.challenge_winners for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- A student may only fill in their prop firm and email, until the prize is sent.
create or replace function public.guard_prize_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if old.prize_sent_at is not null then
    raise exception 'This prize was already sent. Contact your coach to change it.';
  end if;
  if coalesce(trim(new.prop_firm), '') = '' then
    raise exception 'Choose your prop firm.';
  end if;
  if new.prop_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  new.challenge_id  := old.challenge_id;
  new.student_id    := old.student_id;
  new.category      := old.category;
  new.details       := old.details;
  new.prize_sent_at := old.prize_sent_at;
  new.created_at    := old.created_at;
  new.prop_email    := lower(trim(new.prop_email));
  new.claimed_at    := now();
  return new;
end
$$;

create trigger challenge_winners_guard_claim
  before update on public.challenge_winners
  for each row execute function public.guard_prize_claim();

-- Winner announcement for everyone signed in: names and awards only, never emails.
create or replace function public.challenge_winner_list(ch_id uuid)
returns table (category text, full_name text, batch_name text, details jsonb)
language sql stable security definer set search_path = public as $$
  select w.category, s.full_name, b.name, w.details
  from public.challenge_winners w
  join public.students s on s.id = w.student_id
  left join public.batches b on b.id = s.batch_id
  where w.challenge_id = ch_id and auth.uid() is not null
  order by array_position(array['discipline', 'active', 'team'], w.category), s.full_name
$$;
revoke execute on function public.challenge_winner_list(uuid) from anon, public;
grant execute on function public.challenge_winner_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Standings: same rules as the website (js/metrics.js).
-- Expected days = Mon-Fri from the later of challenge start, batch start and
-- "counts from", to the earlier of challenge end and today; today counts only once
-- marked; days marked "not counted" in the calendar are skipped.
-- Discipline = CHECK / (CHECK + X); a coach "not valid" day is an X.
-- ---------------------------------------------------------------------------
create or replace function public._challenge_standings(ch_id uuid)
returns table (student_id uuid, full_name text, batch_id uuid, expected int, checkins int,
               checks int, xs int, discipline numeric, checkin_rate numeric)
language sql stable security definer set search_path = public as $$
  with ch as (select * from public.challenges where id = ch_id),
  st as (
    select s.id, s.full_name, s.batch_id,
           greatest(ch.start_date, coalesce(b.start_date, ch.start_date), s.joined_date) as start_d,
           least(ch.end_date, public.ny_today()) as end_d
    from public.students s
    cross join ch
    left join public.batches b on b.id = s.batch_id
    where s.status = 'active' and s.role = 'student'
      and (ch.batch_ids is null or s.batch_id = any (ch.batch_ids))
  ),
  days as (
    select st.id as sid, g::date as d
    from st cross join lateral generate_series(st.start_d, st.end_d, interval '1 day') g
    where extract(isodow from g) < 6
      and not exists (select 1 from public.trading_days t where t.date = g::date and t.is_trading_day = false)
  ),
  dm as (
    select days.sid, days.d,
           case when c.coach_status = 'invalid' then 'X' else c.mark end as m
    from days
    left join public.check_ins c on c.student_id = days.sid and c.date = days.d
    where days.d < public.ny_today() or c.id is not null
  )
  select st.id, st.full_name, st.batch_id,
         count(dm.d)::int,
         count(dm.m)::int,
         (count(*) filter (where dm.m = 'CHECK'))::int,
         (count(*) filter (where dm.m = 'X'))::int,
         case when count(*) filter (where dm.m in ('CHECK', 'X')) > 0
              then (count(*) filter (where dm.m = 'CHECK'))::numeric / count(*) filter (where dm.m in ('CHECK', 'X')) end,
         case when count(dm.d) > 0 then count(dm.m)::numeric / count(dm.d) end
  from st
  left join dm on dm.sid = st.id
  group by st.id, st.full_name, st.batch_id
$$;

-- Picks the winners once and stores them. Never re-rolls a finalized challenge.
create or replace function public._finalize_challenge(ch_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  ch public.challenges;
  win_batch uuid;
  n int;
begin
  select * into ch from public.challenges where id = ch_id for update;
  if ch.id is null then raise exception 'Challenge not found'; end if;
  if ch.finalized_at is not null then return 0; end if;

  drop table if exists _s; -- several challenges can finalize in one run
  create temp table _s on commit drop as select * from public._challenge_standings(ch_id);

  -- Most Disciplined (needs the minimum check-in rate). Exact ties are broken at random.
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, s.student_id, 'discipline',
         jsonb_build_object('discipline', round(s.discipline * 100, 1), 'checkin_rate', round(s.checkin_rate * 100, 1),
                            'checks', s.checks, 'xs', s.xs, 'days', s.expected)
  from _s s
  where s.discipline is not null and s.checkin_rate * 100 >= ch.award_min_checkin_pct
  order by s.discipline desc, s.checkin_rate desc, s.checks desc, random()
  limit 1;

  -- Most Active: highest check-in rate (a different person from Most Disciplined).
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, s.student_id, 'active',
         jsonb_build_object('checkin_rate', round(s.checkin_rate * 100, 1), 'checkins', s.checkins, 'days', s.expected,
                            'discipline', round(s.discipline * 100, 1))
  from _s s
  where s.checkins > 0
    and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
  order by s.checkin_rate desc, s.checks desc, s.discipline desc nulls last, random()
  limit 1;

  -- Team battle: average per student of discipline x check-in rate (ghosts count as 0).
  update public.challenges set team_results = (
    select jsonb_agg(jsonb_build_object('batch_id', t.batch_id, 'batch', b.name, 'members', t.members,
                                        'score', round(t.score * 100, 1)) order by t.score desc)
    from (select s.batch_id, count(*) as members,
                 avg(coalesce(s.discipline, 0) * coalesce(s.checkin_rate, 0)) as score
          from _s s where s.batch_id is not null group by s.batch_id) t
    join public.batches b on b.id = t.batch_id
  ) where id = ch_id;

  select s.batch_id into win_batch
  from _s s where s.batch_id is not null
  group by s.batch_id
  order by avg(coalesce(s.discipline, 0) * coalesce(s.checkin_rate, 0)) desc, random()
  limit 1;

  -- Random draw from the winning batch: members who checked in on at least half the days,
  -- excluding the individual winners.
  if win_batch is not null and ch.team_draw_count > 0 then
    insert into public.challenge_winners (challenge_id, student_id, category, details)
    select ch_id, s.student_id, 'team',
           jsonb_build_object('batch_id', win_batch, 'checkin_rate', round(s.checkin_rate * 100, 1),
                              'discipline', round(s.discipline * 100, 1), 'drawn_at', now())
    from _s s
    where s.batch_id = win_batch and s.checkin_rate >= 0.5
      and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
    order by random()
    limit ch.team_draw_count;
  end if;

  update public.challenges set finalized_at = now() where id = ch_id;
  select count(*) into n from public.challenge_winners where challenge_id = ch_id;
  return n;
end
$$;

-- Runs every day: finalizes challenges whose last day has passed (New York time).
create or replace function public.finalize_due_challenges() returns int
language plpgsql security definer set search_path = public as $$
declare
  c record;
  total int := 0;
begin
  for c in select id from public.challenges where finalized_at is null and end_date < public.ny_today() loop
    total := total + public._finalize_challenge(c.id);
  end loop;
  return total;
end
$$;

-- Admin button "Finalize now" (e.g. to announce winners early).
create or replace function public.finalize_challenge_now(ch_id uuid) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return public._finalize_challenge(ch_id);
end
$$;

revoke execute on function public._challenge_standings(uuid) from anon, authenticated, public;
revoke execute on function public._finalize_challenge(uuid) from anon, authenticated, public;
revoke execute on function public.finalize_due_challenges() from anon, authenticated, public;
revoke execute on function public.finalize_challenge_now(uuid) from anon, public;
grant execute on function public.finalize_challenge_now(uuid) to authenticated;

-- Every day at 1:30 PM PH (05:30 UTC), just after the New York day rolls over.
select cron.schedule('finalize-challenges', '30 5 * * *', $$ select public.finalize_due_challenges(); $$);
