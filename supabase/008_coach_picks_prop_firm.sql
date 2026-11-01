-- =============================================================================
-- Update 8: the coach chooses the prize, not the student.
--   - Each challenge announces its prizes up front (prop firm, account size,
--     account type per award). Students see them during the month.
--   - When winners are picked they get the prize for their award. The admin
--     can still change a winner's prize on the Challenges page.
--   - A winner can only enter their registered email, and only after the
--     prize is set. They can never change the prize.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- =============================================================================

alter table public.challenges add column if not exists prizes jsonb;
alter table public.challenge_winners add column if not exists account_size text;
alter table public.challenge_winners add column if not exists account_type text;

-- A new winner gets the prize announced for their award.
create or replace function public.fill_winner_prize() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p jsonb;
begin
  select c.prizes -> new.category into p from public.challenges c where c.id = new.challenge_id;
  new.prop_firm    := coalesce(new.prop_firm, p ->> 'prop_firm');
  new.account_size := coalesce(new.account_size, p ->> 'account_size');
  new.account_type := coalesce(new.account_type, p ->> 'account_type');
  return new;
end
$$;

drop trigger if exists challenge_winners_fill_prize on public.challenge_winners;
create trigger challenge_winners_fill_prize
  before insert on public.challenge_winners
  for each row execute function public.fill_winner_prize();

create or replace function public.guard_prize_claim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if old.prize_sent_at is not null then
    raise exception 'This prize was already sent. Contact your coach to change it.';
  end if;
  if old.prop_firm is null or old.account_size is null then
    raise exception 'Your coach has not chosen your prize yet.';
  end if;
  if new.prop_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  new.challenge_id  := old.challenge_id;
  new.student_id    := old.student_id;
  new.category      := old.category;
  new.details       := old.details;
  new.prop_firm     := old.prop_firm;      -- only the coach sets the prize
  new.account_size  := old.account_size;
  new.account_type  := old.account_type;
  new.prize_sent_at := old.prize_sent_at;
  new.created_at    := old.created_at;
  new.prop_email    := lower(trim(new.prop_email));
  new.claimed_at    := now();
  return new;
end
$$;
