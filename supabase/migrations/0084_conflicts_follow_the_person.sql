-- 0084: conflicts that follow the person, and who can close a discussion.
--
-- * Discussions remember each voter's strata lot (discussion_voters.lot_number),
--   so a conflict declared on a discussion carries into the council meeting
--   that ratifies it: when that agenda item comes up, or its vote opens, the
--   member is recorded as having the conflict (acknowledged) and steps out.
-- * A discussion can be closed by the person who started it or by an Admin
--   (Super Admins have Admin rights everywhere).
-- * The person running a meeting can't declare their own conflict and keep
--   running it: declare_runner_conflict hands the meeting to someone else in
--   it who can run meetings, then records the conflict. The handover row
--   notes the item and the reason, for the minutes and for handing back.
-- Safe to re-run.
--
-- Grants: execute on declare_runner_conflict(uuid, text, text, uuid) and
-- step_out_discussion_conflicts(uuid, text), and on the redefined
-- create_discussion, close_discussion, declare_meeting_conflict and
-- open_meeting_vote, to authenticated and service_role (none to public or
-- anon). apply_discussion_conflicts is internal (no grants).

alter table public.discussion_voters add column if not exists lot_number text;
-- Voters already recorded: their lot as it stands now.
update public.discussion_voters v
  set lot_number = m.lot_number
  from public.discussions d, public.corporation_memberships m
  where v.discussion_id = d.id and v.lot_number is null and v.user_id is not null
    and m.corporation_id = d.corporation_id and m.user_id = v.user_id and m.status = 'active' and m.lot_number is not null;

alter table public.meeting_handovers add column if not exists item_id text;
alter table public.meeting_handovers add column if not exists reason text;
alter table public.meeting_handovers drop constraint if exists meeting_handovers_reason;
alter table public.meeting_handovers add constraint meeting_handovers_reason check (reason is null or reason = 'conflict');

-- Who takes part: council as it stands now, each with their strata lot.
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
  if d.id is null
     or not ((d.created_by = auth.uid() and public.can_start_discussions(d.corporation_id))
             or public.has_corporation_role(d.corporation_id, array['admin'])) then
    raise exception 'Only the person who started this discussion, or an Admin, can close it.';
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

-- Internal: council members who declared a conflict on the discussion an
-- agenda item ratifies are recorded as having it on that item, and step out.
create or replace function public.apply_discussion_conflicts(p_meeting_id uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_discussion uuid;
  r record;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null or v_meeting.type in ('agm', 'sgm') then
    return;
  end if;
  select (e->>'discussionId')::uuid into v_discussion
  from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e
  where e->>'id' = p_item_id and coalesce(e->>'discussionId', '') ~* '^[0-9a-f-]{36}$'
  limit 1;
  if v_discussion is null then
    return;
  end if;
  for r in
    select v.lot_number, v.recusal_reason
    from public.discussion_voters v
    join public.discussions d on d.id = v.discussion_id
    where v.discussion_id = v_discussion and d.corporation_id = v_meeting.corporation_id
      and v.vote = 'recused' and v.lot_number is not null
  loop
    insert into public.meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by, acknowledged_at, acknowledged_by)
    values (p_meeting_id, p_item_id, r.lot_number,
            left('Declared on the discussion: ' || btrim(coalesce(r.recusal_reason, '')), 500),
            auth.uid(), now(), auth.uid())
    on conflict (meeting_id, item_id, lot_number) do update
      set acknowledged_at = coalesce(public.meeting_conflicts.acknowledged_at, excluded.acknowledged_at),
          acknowledged_by = coalesce(public.meeting_conflicts.acknowledged_by, excluded.acknowledged_by);
    perform public.leave_vote_for_conflict(p_meeting_id, p_item_id, r.lot_number);
  end loop;
end;
$$;
revoke all on function public.apply_discussion_conflicts(uuid, text) from public, anon, authenticated;

-- The Runner's screen calls this when a ratification item comes up.
create or replace function public.step_out_discussion_conflicts(p_meeting_id uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can do that.' using errcode = '42501';
  end if;
  perform public.apply_discussion_conflicts(p_meeting_id, p_item_id);
end;
$$;

-- Declared by the member for their own lot (waits for the runner), or
-- recorded by the runner for anyone else (acknowledged at once).
create or replace function public.declare_meeting_conflict(p_meeting_id uuid, p_item_id text, p_lot text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_runner boolean;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null or v_meeting.launched_by is null or v_meeting.status = 'ADJOURNED' then
    raise exception 'Conflicts are declared during the meeting.';
  end if;
  v_runner := public.runs_meeting(p_meeting_id);
  if not (v_runner
          or (public.is_on_council(v_meeting.corporation_id) and p_lot = public.my_strata_lot(v_meeting.corporation_id))) then
    raise exception 'Declare a conflict for yourself, or ask the person running the meeting to record it.' using errcode = '42501';
  end if;
  -- The person running the meeting can't step out and keep running it:
  -- they hand it over first (declare_runner_conflict).
  if v_runner and p_lot = public.my_strata_lot(v_meeting.corporation_id) then
    raise exception 'Hand the meeting to someone else before you declare your own conflict.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Describe the conflict: its nature goes in the minutes (SPA s.32).';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e where e->>'id' = p_item_id) then
    raise exception 'That agenda item isn''t on the agenda.';
  end if;
  insert into public.meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by, acknowledged_at, acknowledged_by)
  values (p_meeting_id, p_item_id, p_lot, left(btrim(p_note), 500), auth.uid(),
          case when v_runner then now() end, case when v_runner then auth.uid() end)
  on conflict (meeting_id, item_id, lot_number) do update
    set note = excluded.note,
        acknowledged_at = coalesce(public.meeting_conflicts.acknowledged_at, excluded.acknowledged_at),
        acknowledged_by = coalesce(public.meeting_conflicts.acknowledged_by, excluded.acknowledged_by);

  if v_runner then
    perform public.leave_vote_for_conflict(p_meeting_id, p_item_id, p_lot);
  end if;
end;
$$;

-- The person running the meeting has a conflict: they hand the meeting to
-- someone else in it who can run meetings, then step out like anyone else.
create or replace function public.declare_runner_conflict(p_meeting_id uuid, p_item_id text, p_note text, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_lot text;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null or not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can do that.' using errcode = '42501';
  end if;
  v_lot := public.my_strata_lot(v_meeting.corporation_id);
  if v_lot is null or not public.is_on_council(v_meeting.corporation_id) then
    raise exception 'Only a council member has a vote to step out of.';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Describe the conflict: its nature goes in the minutes (SPA s.32).';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e where e->>'id' = p_item_id) then
    raise exception 'That agenda item isn''t on the agenda.';
  end if;
  -- Checks who takes over (can run meetings, in the meeting) and hands over.
  perform public.hand_over_meeting(p_meeting_id, p_to);
  update public.meeting_handovers set item_id = p_item_id, reason = 'conflict'
    where id = (select max(id) from public.meeting_handovers where meeting_id = p_meeting_id);
  insert into public.meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by, acknowledged_at, acknowledged_by)
  values (p_meeting_id, p_item_id, v_lot, left(btrim(p_note), 500), auth.uid(), now(), auth.uid())
  on conflict (meeting_id, item_id, lot_number) do update
    set note = excluded.note, acknowledged_at = coalesce(public.meeting_conflicts.acknowledged_at, excluded.acknowledged_at),
        acknowledged_by = coalesce(public.meeting_conflicts.acknowledged_by, excluded.acknowledged_by);
  perform public.leave_vote_for_conflict(p_meeting_id, p_item_id, v_lot);
end;
$$;

-- As in 0082, and first applies any conflict carried from a discussion.
create or replace function public.open_meeting_vote(p_meeting_id uuid, p_item_id text, p_motion text, p_decision_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_council int;
  v_present int;
  v_eligible text[];
  v_id uuid;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can open a vote.' using errcode = '42501';
  end if;
  if v_meeting.type in ('agm', 'sgm') then
    raise exception 'Live voting is for council meetings for now.';
  end if;
  if v_meeting.actual_start_at is null then
    raise exception 'Call the meeting to order before voting.';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e where e->>'id' = p_item_id) then
    raise exception 'That agenda item isn''t on the saved agenda yet. Try again in a moment.';
  end if;
  if coalesce(btrim(p_motion), '') = '' then
    raise exception 'Write the motion before opening the vote.';
  end if;
  if p_decision_type not in ('MAJORITY', 'THREE_QUARTER', 'EIGHTY_PERCENT', 'UNANIMOUS') then
    raise exception 'Unknown decision type.';
  end if;
  if exists (select 1 from public.meeting_votes where meeting_id = p_meeting_id and status = 'open') then
    raise exception 'Another vote is still open. Close it first.';
  end if;

  -- A council member who declared a conflict on the discussion this item
  -- ratifies has the same conflict here.
  perform public.apply_discussion_conflicts(p_meeting_id, p_item_id);

  -- Quorum (Standard Bylaws 16): council members in the meeting now.
  select count(*), count(*) filter (where coalesce(v_meeting.attendance ->> o.lot_number, '') = 'present')
    into v_council, v_present
  from public.owners_and_council o
  where o.corporation_id = v_meeting.corporation_id and o.is_council_member;
  if v_present < public.council_quorum(v_council) then
    raise exception 'No quorum: % of % council members present, % needed. Nothing can be decided until quorum is back.',
      v_present, v_council, public.council_quorum(v_council);
  end if;

  select coalesce(array_agg(o.lot_number order by o.lot_number), '{}') into v_eligible
  from public.owners_and_council o
  where o.corporation_id = v_meeting.corporation_id
    and o.is_council_member
    and coalesce(v_meeting.attendance ->> o.lot_number, '') = 'present'
    and not exists (
      select 1 from public.meeting_conflicts c
      where c.meeting_id = p_meeting_id and c.item_id = p_item_id and c.lot_number = o.lot_number
        and c.acknowledged_at is not null
    );
  if cardinality(v_eligible) = 0 then
    raise exception 'No council members are marked present to vote.';
  end if;

  insert into public.meeting_votes (meeting_id, item_id, motion, decision_type, eligible_lots, opened_by)
  values (p_meeting_id, p_item_id, left(btrim(p_motion), 4000), p_decision_type, v_eligible, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_discussion(text, text, text, text, text, text, boolean)',
    'public.close_discussion(uuid)',
    'public.step_out_discussion_conflicts(uuid, text)',
    'public.declare_meeting_conflict(uuid, text, text, text)',
    'public.declare_runner_conflict(uuid, text, text, uuid)',
    'public.open_meeting_vote(uuid, text, text, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
