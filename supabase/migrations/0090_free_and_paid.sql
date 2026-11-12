-- Free and paid (2026-11-12, docs/learn-decide-remember.md §2–§3, §8).
--
-- The one-free-meeting trial ends. Council business is free for good:
-- council and committee meetings, Meeting Mode, minutes, and Discussions,
-- unlimited. Stratasphere (the assistant, document search, the decision
-- ledger) is the paid tier, and is for council, the strata's managers, and
-- its admins only, never owners. Nothing in how a meeting runs changes:
-- quorum, thresholds, voting, conflicts, and minutes are untouched; only
-- the check at launch is gone.
--
-- 1. has_stratasphere_access: subscribed, and the person is on council, a
--    manager, or an admin of that strata (or a Super Admin). The free
--    meeting's clause goes. This one function guards decisions,
--    match_knowledge_chunks, and document search, so the rule holds in the
--    database, not only in the pages.
-- 2. stratasphere_allowed: 'ok', 'subscription', or 'limit'. No quota for
--    subscribers; a person who asks 30 questions within an hour waits (a
--    guard against scripts and loops, not a limit anyone should meet).
--    consume_stratasphere_request (0015) now follows it, for any page still
--    running the previous release while this deploys.
-- 3. launch_meeting: no trial check, nothing marked as the free meeting.
--    General meetings (AGMs and SGMs, not yet creatable) need a subscription.
-- 4. create_discussion: the "first one free" check goes.
-- 5. meetings.video_link: the council's own video link (Zoom, Teams, Meet),
--    for stratas without built-in video. Same access as the meeting row.
-- 6. documents.indexing_status gains 'waiting': stored, not read or indexed
--    until the strata subscribes; subscribing queues them.
--
-- Columns kept for history: strata_corporations.free_meeting_used,
-- free_meeting_used_at, free_meeting_ai_requests_used; meetings.is_trial.
--
-- Grants: has_stratasphere_access keeps its grant (execute: authenticated).
-- stratasphere_allowed: execute for authenticated only. The other functions
-- keep their grants; create or replace doesn't change them. No table grants
-- change.
--
-- Safe to re-run.

-- 1 ────────────────────────────────────────────────────────────────────────
create or replace function public.has_stratasphere_access(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
      select 1 from public.subscriptions
      where corporation_id = target_corporation_id and status = 'active'
    )
    and (
      public.is_super_admin()
      or (
        public.is_corporation_member(target_corporation_id)
        and (
          public.is_on_council(target_corporation_id)
          or public.has_corporation_role(target_corporation_id, array['admin', 'manager'])
        )
      )
    );
$$;

-- 2 ────────────────────────────────────────────────────────────────────────
create or replace function public.stratasphere_allowed(p_corporation_id text)
returns text
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.has_stratasphere_access(p_corporation_id) then
    return 'subscription';
  end if;
  if (
    select count(*) from public.stratasphere_usage
    where user_id = auth.uid() and created_at > now() - interval '1 hour'
  ) >= 30 then
    return 'limit';
  end if;
  return 'ok';
end;
$$;
revoke all on function public.stratasphere_allowed(text) from public, anon;
grant execute on function public.stratasphere_allowed(text) to authenticated;

create or replace function public.consume_stratasphere_request(p_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.stratasphere_allowed(p_corporation_id) = 'ok';
$$;

-- 3 ────────────────────────────────────────────────────────────────────────
create or replace function public.launch_meeting(p_meeting_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_meeting.status = 'ADJOURNED' then
    raise exception 'This meeting has already been adjourned.';
  end if;
  if v_meeting.launched_by is not null then
    if v_meeting.launched_by <> auth.uid() then
      raise exception 'This meeting is already being run by someone else.';
    end if;
    return 'resumed';
  end if;
  if jsonb_array_length(v_meeting.agenda) = 0 then
    raise exception 'Build the agenda before launching.';
  end if;
  if v_meeting.type in ('agm', 'sgm') and not exists (
    select 1 from public.subscriptions where corporation_id = v_meeting.corporation_id and status = 'active'
  ) then
    raise exception 'General meetings come with a Stratasphere subscription.'
      using errcode = 'P0001', hint = 'subscription_required';
  end if;

  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings
    set launched_by = auth.uid(), launched_at = now()
    where id = p_meeting_id;
  return 'launched';
end;
$$;

-- 4 ────────────────────────────────────────────────────────────────────────
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

-- 5 ────────────────────────────────────────────────────────────────────────
alter table public.meetings add column if not exists video_link text;
alter table public.meetings drop constraint if exists meetings_video_link_check;
alter table public.meetings add constraint meetings_video_link_check
  check (video_link is null or (char_length(video_link) <= 500 and video_link ~* '^https?://[^\s]+$'));

-- 6 ────────────────────────────────────────────────────────────────────────
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.documents'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%indexing_status%'
  loop
    execute format('alter table public.documents drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.documents add constraint documents_indexing_status_check
  check (indexing_status in ('pending', 'processing', 'indexed', 'failed', 'not_indexable', 'needs_text', 'waiting'));
