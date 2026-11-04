-- =============================================================================
-- Update 11: proof on no-trade days, reused-screenshot check, minimum trades for prizes
--   - check_ins.no_trade_proof: on a ✓ day without trades (on a day trading was allowed)
--     the student shows what they watched: { market, session, waited_for, why, chart_path }.
--   - image_hashes: a fingerprint of every uploaded screenshot, so the same image can't be
--     uploaded twice (by the same student or by someone else).
--   - challenges.min_trades: trades a student needs in the challenge to win a prize.
--     They can still pass the challenge with fewer.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- =============================================================================

alter table public.challenges
  add column if not exists min_trades int not null default 0 check (min_trades between 0 and 100);

alter table public.check_ins
  add column if not exists no_trade_proof jsonb;

-- ---------------------------------------------------------------------------
-- Screenshot fingerprints (SHA-256 of the original file)
-- ---------------------------------------------------------------------------
create table if not exists public.image_hashes (
  path        text primary key,
  hash        text not null,
  student_id  uuid not null references public.students(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists image_hashes_hash_idx on public.image_hashes (hash);

alter table public.image_hashes enable row level security;
create policy "read own" on public.image_hashes for select to authenticated
  using (student_id = public.my_student_id() or public.is_admin());
create policy "insert own" on public.image_hashes for insert to authenticated
  with check (student_id = public.my_student_id());
create policy "delete own" on public.image_hashes for delete to authenticated
  using (student_id = public.my_student_id());
create policy "admin" on public.image_hashes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Was this screenshot uploaded before? 'mine', 'other' or null. Never says by whom.
create or replace function public.image_hash_owner(h text) returns text
language sql stable security definer set search_path = public as $$
  select case when bool_or(i.student_id = public.my_student_id()) then 'mine'
              when count(*) > 0 then 'other' end
  from public.image_hashes i
  where i.hash = h and auth.uid() is not null
$$;
revoke execute on function public.image_hash_owner(text) from anon, public;
grant execute on function public.image_hash_owner(text) to authenticated;

-- Trades posted per student during a challenge (counts only), for the live standings.
create or replace function public.challenge_trade_counts(ch_id uuid)
returns table (student_id uuid, trades int)
language sql stable security definer set search_path = public as $$
  select t.student_id, count(*)::int
  from public.trade_posts t
  join public.challenges ch on ch.id = ch_id
  where t.date between ch.start_date and ch.end_date and auth.uid() is not null
  group by t.student_id
$$;
revoke execute on function public.challenge_trade_counts(uuid) from anon, public;
grant execute on function public.challenge_trade_counts(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Winners: same as update 9, plus everyone who wins needs ch.min_trades trades.
-- ---------------------------------------------------------------------------
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
  alter table _s add column trades int not null default 0;
  update _s set trades = (select count(*) from public.trade_posts t
                          where t.student_id = _s.student_id and t.date between ch.start_date and ch.end_date);

  -- Most Disciplined (needs the minimum check-in rate). Exact ties are broken at random.
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, x.student_id, 'discipline',
         jsonb_build_object('place', x.place, 'discipline', round(x.discipline * 100, 1), 'checkin_rate', round(x.checkin_rate * 100, 1),
                            'checks', x.checks, 'xs', x.xs, 'days', x.expected, 'trades', x.trades)
  from (
    select s.*, row_number() over (order by s.discipline desc, s.checkin_rate desc, s.checks desc, random()) as place
    from _s s
    where s.discipline is not null and s.checkin_rate * 100 >= ch.award_min_checkin_pct
      and s.trades >= ch.min_trades
  ) x
  where x.place <= n_disc;

  -- Most Active: highest check-in rate, skipping anyone who already won.
  insert into public.challenge_winners (challenge_id, student_id, category, details)
  select ch_id, x.student_id, 'active',
         jsonb_build_object('place', x.place, 'checkin_rate', round(x.checkin_rate * 100, 1), 'checkins', x.checkins, 'days', x.expected,
                            'discipline', round(x.discipline * 100, 1), 'trades', x.trades)
  from (
    select s.*, row_number() over (order by s.checkin_rate desc, s.checks desc, s.discipline desc nulls last, random()) as place
    from _s s
    where s.checkins > 0 and s.trades >= ch.min_trades
      and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
  ) x
  where x.place <= n_active;

  -- Team battle: average per student of discipline x check-in rate (ghosts count as 0).
  -- The minimum trades only decide who can be drawn, not the team score.
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

  -- Random draw from the winning batch: members who checked in on at least half the days
  -- and posted the minimum trades, excluding the individual winners.
  -- Draw order is the place, so the first drawn win the main prize.
  if win_batch is not null and public._award_winners(ch, 'team') > 0 then
    insert into public.challenge_winners (challenge_id, student_id, category, details)
    select ch_id, x.student_id, 'team',
           jsonb_build_object('place', x.place, 'batch_id', win_batch, 'checkin_rate', round(x.checkin_rate * 100, 1),
                              'discipline', round(x.discipline * 100, 1), 'trades', x.trades, 'drawn_at', now())
    from (
      select s.*, row_number() over (order by random()) as place
      from _s s
      where s.batch_id = win_batch and s.checkin_rate >= 0.5 and s.trades >= ch.min_trades
        and s.student_id not in (select w.student_id from public.challenge_winners w where w.challenge_id = ch_id)
    ) x
    where x.place <= public._award_winners(ch, 'team');
  end if;

  update public.challenges set finalized_at = now() where id = ch_id;
  select count(*) into n from public.challenge_winners where challenge_id = ch_id;
  return n;
end
$$;
