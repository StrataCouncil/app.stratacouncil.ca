-- 0078: discussions for council and whoever runs meetings (a manager who
-- prepares motions, say). Council members, and members who can run
-- meetings, can start a discussion, read it, comment and close their own.
-- Only council votes: the voters are still council as it stands when the
-- discussion opens. A Super Admin has an SC admin's rights in every strata,
-- so they can start, read and comment too, but don't vote.
-- Safe to re-run.

-- Takes part: council, or anyone who runs meetings (which includes a
-- strata's admin, and a Super Admin, who has an admin's rights everywhere).
create or replace function public.can_start_discussions(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_on_council(target_corporation_id) or public.can_run_meetings(target_corporation_id);
$$;
revoke all on function public.can_start_discussions(text) from public, anon;
grant execute on function public.can_start_discussions(text) to authenticated, service_role;

-- Reads: the same people.
create or replace function public.can_see_discussions(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_start_discussions(target_corporation_id);
$$;
revoke all on function public.can_see_discussions(text) from public, anon;
grant execute on function public.can_see_discussions(text) to authenticated, service_role;

create or replace function public.discussion_open_to_me(p_discussion_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.discussions d
    where d.id = p_discussion_id and public.can_see_discussions(d.corporation_id)
  ) and not exists (
    select 1 from public.discussion_voters v
    where v.discussion_id = p_discussion_id and v.user_id = auth.uid() and v.vote = 'recused'
  );
$$;

drop policy if exists "council reads discussions" on public.discussions;
create policy "council reads discussions" on public.discussions
  for select to authenticated using (public.can_see_discussions(corporation_id));

drop policy if exists "council reads votes" on public.discussion_voters;
create policy "council reads votes" on public.discussion_voters
  for select to authenticated using (
    user_id = auth.uid() and exists (select 1 from public.discussions d where d.id = discussion_id and public.can_see_discussions(d.corporation_id))
    or public.discussion_open_to_me(discussion_id)
  );

drop policy if exists "council reads files" on public.discussion_files;
create policy "council reads files" on public.discussion_files
  for select to authenticated using (
    public.discussion_open_to_me(discussion_id)
    or (comment_id is null and exists (select 1 from public.discussions d where d.id = discussion_id and public.can_see_discussions(d.corporation_id)))
  );

create or replace function public.create_discussion(
  p_corporation_id text, p_title text, p_background text, p_financial text, p_risks text, p_motion text
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
  -- One at a time per strata, so two can't both take the free one.
  perform 1 from public.strata_corporations where strata_plan_number = p_corporation_id for update;
  if not exists (select 1 from public.subscriptions s where s.corporation_id = p_corporation_id and s.status = 'active')
     and exists (select 1 from public.discussions d where d.corporation_id = p_corporation_id) then
    raise exception 'free_discussion_used: Discussions after the first need a Stratasphere subscription.';
  end if;
  insert into public.discussions (corporation_id, title, background, financial, risks, motion, created_by, author_name)
  values (
    p_corporation_id, btrim(p_title), coalesce(p_background, ''), coalesce(p_financial, ''), coalesce(p_risks, ''), btrim(p_motion),
    auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), '')
  )
  returning id into v_id;
  -- The voters: council as it stands now.
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
  update public.discussions
    set title = btrim(p_title), background = coalesce(p_background, ''), financial = coalesce(p_financial, ''),
        risks = coalesce(p_risks, ''), motion = btrim(p_motion), updated_at = now()
    where id = p_discussion_id;
end;
$$;

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

create or replace function public.add_discussion_comment(p_discussion_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.discussions;
  v_id uuid;
begin
  select * into d from public.discussions where id = p_discussion_id;
  if d.id is null or not public.discussion_open_to_me(p_discussion_id) or not public.can_start_discussions(d.corporation_id) then
    raise exception 'Only council members taking part can comment.';
  end if;
  if d.status <> 'open' then
    raise exception 'This discussion is closed.';
  end if;
  insert into public.discussion_comments (discussion_id, user_id, author_name, body)
  values (p_discussion_id, auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), ''), btrim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_discussion(text, text, text, text, text, text) from public, anon;
revoke all on function public.add_discussion_comment(uuid, text) from public, anon;
grant execute on function public.add_discussion_comment(uuid, text) to authenticated;
revoke all on function public.update_discussion(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.close_discussion(uuid) from public, anon;
grant execute on function public.create_discussion(text, text, text, text, text, text) to authenticated;
grant execute on function public.update_discussion(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.close_discussion(uuid) to authenticated;
