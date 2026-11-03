-- =============================================================================
-- Update 10: the public winner announcement also shows each winner's prize
-- (prop firm, account size, account type). Never emails.
-- Run once in Supabase: SQL Editor > New query > paste this file > Run.
-- =============================================================================

drop function if exists public.challenge_winner_list(uuid);
create function public.challenge_winner_list(ch_id uuid)
returns table (category text, full_name text, batch_name text, details jsonb,
               prop_firm text, account_size text, account_type text)
language sql stable security definer set search_path = public as $$
  select w.category, s.full_name, b.name, w.details, w.prop_firm, w.account_size, w.account_type
  from public.challenge_winners w
  join public.students s on s.id = w.student_id
  left join public.batches b on b.id = s.batch_id
  where w.challenge_id = ch_id and auth.uid() is not null
  order by array_position(array['discipline', 'active', 'team'], w.category), (w.details ->> 'place')::int nulls last, s.full_name
$$;
revoke execute on function public.challenge_winner_list(uuid) from anon, public;
grant execute on function public.challenge_winner_list(uuid) to authenticated;
