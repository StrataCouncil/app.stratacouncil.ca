-- 0081: council discussions without a vote (2026-11-05).
--
-- "Vote required" off makes a discussion a council conversation: sharing
-- information or getting views, with nothing to decide. It has no motion
-- to vote on (the motion is optional), nobody votes, it closes without a
-- result, and so it never goes to a meeting for ratification. A member
-- can still declare a conflict of interest and step out of it.
-- Discussions with a vote are unchanged.
-- Safe to re-run.

alter table public.discussions add column if not exists vote_required boolean not null default true;
-- (Signed-in users read discussions through RLS; the table grant covers the new column.)

-- The motion is required only when there's a vote.
alter table public.discussions drop constraint if exists discussions_motion_check;
alter table public.discussions drop constraint if exists discussions_motion_when_voting;
alter table public.discussions add constraint discussions_motion_when_voting
  check (char_length(motion) <= 4000 and (not vote_required or char_length(btrim(motion)) >= 1));

-- Closed means a closing time; a result (and only then) when there was a vote.
alter table public.discussions drop constraint if exists discussions_closed;
alter table public.discussions add constraint discussions_closed check (
  (status = 'open') = (closed_at is null)
  and (status <> 'open' or result is null)
  and (not vote_required or status = 'open' or result is not null)
  and (vote_required or result is null)
);

-- create_discussion gains "vote required" (default on, as before).
drop function if exists public.create_discussion(text, text, text, text, text, text);
create or replace function public.create_discussion(
  p_corporation_id text, p_title text, p_background text, p_financial text, p_risks text, p_motion text,
  p_vote_required boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_start_discussions(p_corporation_id) then
    raise exception 'Only council members and those who run meetings can start a discussion.';
  end if;
  if coalesce(p_vote_required, true) and char_length(btrim(coalesce(p_motion, ''))) = 0 then
    raise exception 'Write the motion council is voting on.';
  end if;
  -- One at a time per strata, so two can't both take the free one.
  perform 1 from public.strata_corporations where strata_plan_number = p_corporation_id for update;
  if not exists (select 1 from public.subscriptions s where s.corporation_id = p_corporation_id and s.status = 'active')
     and exists (select 1 from public.discussions d where d.corporation_id = p_corporation_id) then
    raise exception 'free_discussion_used: Discussions after the first need a Stratasphere subscription.';
  end if;
  insert into public.discussions (corporation_id, title, background, financial, risks, motion, vote_required, created_by, author_name)
  values (
    p_corporation_id, btrim(p_title), coalesce(p_background, ''), coalesce(p_financial, ''), coalesce(p_risks, ''),
    btrim(coalesce(p_motion, '')), coalesce(p_vote_required, true),
    auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), '')
  )
  returning id into v_id;
  -- Who takes part: council as it stands now.
  insert into public.discussion_voters (discussion_id, user_id, name)
  select distinct v_id, m.user_id, coalesce(p.full_name, '')
  from public.corporation_memberships m
  join public.corporation_role_assignments r on r.corporation_id = m.corporation_id and r.user_id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id and m.status = 'active'
    and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large');
  return v_id;
end;
$$;

-- Changing a discussion: the motion may be blank only when there's no vote.
create or replace function public.update_discussion(
  p_discussion_id uuid, p_title text, p_background text, p_financial text, p_risks text, p_motion text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.can_start_discussions(d.corporation_id) or d.created_by is distinct from auth.uid() then
    raise exception 'Only the person who started this discussion can change it.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  if exists (select 1 from public.discussion_voters where discussion_id = p_discussion_id and vote is not null) then
    raise exception 'motion_locked: Someone has voted, so the motion can no longer be changed.';
  end if;
  if d.vote_required and char_length(btrim(coalesce(p_motion, ''))) = 0 then
    raise exception 'Write the motion council is voting on.';
  end if;
  update public.discussions
    set title = btrim(p_title), background = coalesce(p_background, ''), financial = coalesce(p_financial, ''),
        risks = coalesce(p_risks, ''), motion = btrim(coalesce(p_motion, '')), updated_at = now()
    where id = p_discussion_id;
end;
$$;

-- Votes only where there's a vote; a conflict can be declared either way.
create or replace function public.cast_discussion_vote(p_discussion_id uuid, p_vote text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.is_on_council(d.corporation_id) then
    raise exception 'Only council members can vote.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  if p_vote not in ('for', 'against', 'abstain', 'recused') then
    raise exception 'Choose For, Against, Abstain or a conflict of interest.';
  end if;
  if not d.vote_required and p_vote <> 'recused' then
    raise exception 'This discussion has no vote.';
  end if;
  if p_vote = 'recused' and char_length(btrim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Say briefly what the conflict of interest is.';
  end if;
  update public.discussion_voters
    set vote = p_vote, recusal_reason = case when p_vote = 'recused' then btrim(p_reason) end, voted_at = now()
    where discussion_id = p_discussion_id and user_id = auth.uid();
  if not found then
    raise exception 'You weren''t on council when this discussion opened, so you can''t vote on it.';
  end if;
end;
$$;

-- Closing: a discussion without a vote just closes (no result, no ratification).
create or replace function public.close_discussion(p_discussion_id uuid)
returns public.discussions
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
  v_for int; v_against int; v_abstain int; v_recused int; v_missing int; v_needed int;
begin
  select * into d from public.discussions where id = p_discussion_id for update;
  if d.id is null or not public.can_start_discussions(d.corporation_id) or d.created_by is distinct from auth.uid() then
    raise exception 'Only the person who started this discussion can close it.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is already closed.';
  end if;
  if not d.vote_required then
    update public.discussions set status = 'closed', closed_at = now(), updated_at = now()
      where id = p_discussion_id returning * into d;
    return d;
  end if;
  select count(*) filter (where vote = 'for'), count(*) filter (where vote = 'against'),
         count(*) filter (where vote = 'abstain'), count(*) filter (where vote = 'recused'),
         count(*) filter (where vote is null)
    into v_for, v_against, v_abstain, v_recused, v_missing
    from public.discussion_voters where discussion_id = p_discussion_id;
  v_needed := (v_for + v_against + v_abstain + v_missing) / 2 + 1;
  update public.discussions
    set status = 'closed', closed_at = now(),
        result = case when v_for >= v_needed then 'supported' when v_against >= v_needed then 'not_supported' else 'no_majority' end,
        votes_for = v_for, votes_against = v_against, votes_abstain = v_abstain, votes_recused = v_recused, votes_missing = v_missing,
        updated_at = now()
    where id = p_discussion_id
    returning * into d;
  return d;
end;
$$;

revoke all on function public.create_discussion(text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_discussion(text, text, text, text, text, text, boolean) to authenticated;
revoke all on function public.update_discussion(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_discussion(uuid, text, text, text, text, text) to authenticated;
revoke all on function public.cast_discussion_vote(uuid, text, text) from public, anon;
grant execute on function public.cast_discussion_vote(uuid, text, text) to authenticated;
revoke all on function public.close_discussion(uuid) from public, anon;
grant execute on function public.close_discussion(uuid) to authenticated;
