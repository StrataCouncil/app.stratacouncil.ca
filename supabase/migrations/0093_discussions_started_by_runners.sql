-- Discussions: started and run by meeting runners (2026-11-12).
--
-- Before: council members and meeting runners could start a discussion,
-- edit their own, and close it (or an Admin could). Now:
--
--   Start, and edit or attach files to, a discussion: meeting runners only
--     (can_run_meetings: the admin, the secretary, and anyone the admin has
--     given meeting-running permission; a Super Admin too).
--   Close: the person who started it (while still a meeting runner), or an
--     Admin. Unchanged in close_discussion; it follows can_start_discussions.
--   Read, comment, and vote: unchanged. Council and meeting runners read and
--     comment; council votes.
--
-- 1. can_see_discussions no longer calls can_start_discussions: it keeps its
--    own rule (council, or meeting runner), so readers don't change.
-- 2. can_start_discussions becomes can_run_meetings. create_discussion,
--    update_discussion and close_discussion already check it.
-- 3. add_discussion_comment checks can_see_discussions (it used
--    can_start_discussions), so council members keep commenting.
-- 4. create_discussion: as 0090, with the refusal reworded.
--
-- Grants: unchanged. Each function keeps its existing grant (create or
-- replace keeps them); restated below.
--
-- Safe to re-run.

-- 1. Readers: council, or anyone who runs meetings.
create or replace function public.can_see_discussions(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_on_council(target_corporation_id) or public.can_run_meetings(target_corporation_id);
$$;
revoke all on function public.can_see_discussions(text) from public, anon;
grant execute on function public.can_see_discussions(text) to authenticated, service_role;

-- 2. Starting (and running) one: meeting runners only.
create or replace function public.can_start_discussions(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.can_run_meetings(target_corporation_id);
$$;
revoke all on function public.can_start_discussions(text) from public, anon;
grant execute on function public.can_start_discussions(text) to authenticated, service_role;

-- 3. Comments: everyone taking part, as before (0078), now checked against
--    the readers' rule.
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
  if d.id is null or not public.discussion_open_to_me(p_discussion_id) or not public.can_see_discussions(d.corporation_id) then
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
revoke all on function public.add_discussion_comment(uuid, text) from public, anon;
grant execute on function public.add_discussion_comment(uuid, text) to authenticated;

-- 4. Starting one: as 0090, with the refusal saying who can.
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
    raise exception 'Only those who run meetings can start a discussion.';
  end if;
  if coalesce(p_vote_required, true) and char_length(btrim(coalesce(p_motion, ''))) = 0 then
    raise exception 'Write the motion council is voting on.';
  end if;
  insert into public.discussions (corporation_id, title, background, financial, risks, motion, vote_required, created_by, author_name)
  values (
    p_corporation_id, btrim(p_title), coalesce(p_background, ''), coalesce(p_financial, ''), coalesce(p_risks, ''),
    btrim(coalesce(p_motion, '')), coalesce(p_vote_required, true),
    auth.uid(), coalesce((select full_name from public.profiles where id = auth.uid()), '')
  )
  returning id into v_id;
  -- Who takes part: council as it stands now.
  insert into public.discussion_voters (discussion_id, user_id, name, lot_number)
  select distinct on (m.user_id) v_id, m.user_id, coalesce(p.full_name, ''), m.lot_number
  from public.corporation_memberships m
  join public.corporation_role_assignments r on r.corporation_id = m.corporation_id and r.user_id = m.user_id
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id and m.status = 'active'
    and r.role in ('president', 'vice_president', 'treasurer', 'secretary', 'member_at_large');
  return v_id;
end;
$$;
revoke all on function public.create_discussion(text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.create_discussion(text, text, text, text, text, text, boolean) to authenticated;
