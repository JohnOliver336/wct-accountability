-- =============================================================================
-- Update 9: several winners per award, with up to two prize tiers.
--   - prizes.<award> = { count, prop_firm, account_size, account_type,
--                        extra: { count, prop_firm, account_size, account_type } }
--     Places 1..count win the main prize, the next extra.count win the extra.
--     e.g. team draw: 2 x ACG then 3 x Equity Edge = 5 winners drawn.
--   - team_draw_count stays the total number drawn (the website keeps it in sync).
--   - One prize per person: someone who already won moves aside for the next.
--   - Each winner's place (1st, 2nd, ...) is stored in details.place.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- =============================================================================

-- Total winners for an award: main tier + extra tier.
create or replace function public._award_winners(ch public.challenges, cat text) returns int
language sql immutable as $$
  select case when cat = 'team' then coalesce((ch.prizes -> cat ->> 'count')::int, ch.team_draw_count, 1)
              else greatest(1, coalesce((ch.prizes -> cat ->> 'count')::int, 1)) end
       + greatest(0, coalesce((ch.prizes -> cat -> 'extra' ->> 'count')::int, 0))
$$;

-- A new winner gets the prize for their place: main tier first, then the extra tier.
create or replace function public.fill_winner_prize() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ch public.challenges;
  p jsonb;
  main_count int;
begin
  select * into ch from public.challenges c where c.id = new.challenge_id;
  p := ch.prizes -> new.category;
  main_count := case when new.category = 'team' then coalesce((p ->> 'count')::int, ch.team_draw_count, 1)
                     else greatest(1, coalesce((p ->> 'count')::int, 1)) end;
  if coalesce((new.details ->> 'place')::int, 1) > main_count then
    p := p -> 'extra';
  end if;
  new.prop_firm    := coalesce(new.prop_firm, p ->> 'prop_firm');
  new.account_size := coalesce(new.account_size, p ->> 'account_size');
  new.account_type := coalesce(new.account_type, p ->> 'account_type');
  return new;
end
$$;

create or replace function public._finalize_challenge(ch_id uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  ch public.challenges;
  win_batch uuid;
  n int;
  n_disc int;
  n_active int;
begin
  select * into ch from public.challenges where id = ch_id for update;
  if ch.id is null then raise exception 'Challenge not found'; end if;
  if ch.finalized_at is not null then return 0; end if;
  n_disc   := public._award_winners(ch, 'discipline');
  n_active := public._award_winners(ch, 'active');

  drop table if exists _s; -- several challenges can finalize in one run
  create temp table _s on commit drop as select * from public._challenge_standings(ch_id);

  -- Most Disciplined (needs the minimum check-in rate). Exact ties are broken at random.
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, x.student_id, 'discipline',
         jsonb_build_object('place', x.place, 'discipline', round(x.discipline * 100, 1), 'checkin_rate', round(x.checkin_rate * 100, 1),
                            'checks', x.checks, 'xs', x.xs, 'days', x.expected)
  from (
    select s.*, row_number() over (order by s.discipline desc, s.checkin_rate desc, s.checks desc, random()) as place
    from _s s
    where s.discipline is not null and s.checkin_rate * 100 >= ch.award_min_checkin_pct
  ) x
  where x.place <= n_disc;

  -- Most Active: highest check-in rate, skipping anyone who already won.
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, x.student_id, 'active',
         jsonb_build_object('place', x.place, 'checkin_rate', round(x.checkin_rate * 100, 1), 'checkins', x.checkins, 'days', x.expected,
                            'discipline', round(x.discipline * 100, 1))
  from (
    select s.*, row_number() over (order by s.checkin_rate desc, s.checks desc, s.discipline desc nulls last, random()) as place
    from _s s
    where s.checkins > 0
      and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
  ) x
  where x.place <= n_active;

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
  -- Draw order is the place, so the first drawn win the main prize.
  if win_batch is not null and public._award_winners(ch, 'team') > 0 then
    insert into public.challenge_winners (challenge_id, student_id, category, details)
    select ch_id, x.student_id, 'team',
           jsonb_build_object('place', x.place, 'batch_id', win_batch, 'checkin_rate', round(x.checkin_rate * 100, 1),
                              'discipline', round(x.discipline * 100, 1), 'drawn_at', now())
    from (
      select s.*, row_number() over (order by random()) as place
      from _s s
      where s.batch_id = win_batch and s.checkin_rate >= 0.5
        and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
    ) x
    where x.place <= public._award_winners(ch, 'team');
  end if;

  update public.challenges set finalized_at = now() where id = ch_id;
  select count(*) into n from public.challenge_winners where challenge_id = ch_id;
  return n;
end
$$;

-- Announcement list: winners in award order, then by place.
create or replace function public.challenge_winner_list(ch_id uuid)
returns table (category text, full_name text, batch_name text, details jsonb)
language sql stable security definer set search_path = public as $$
  select w.category, s.full_name, b.name, w.details
  from public.challenge_winners w
  join public.students s on s.id = w.student_id
  left join public.batches b on b.id = s.batch_id
  where w.challenge_id = ch_id and auth.uid() is not null
  order by array_position(array['discipline', 'active', 'team'], w.category), (w.details ->> 'place')::int nulls last, s.full_name
$$;
