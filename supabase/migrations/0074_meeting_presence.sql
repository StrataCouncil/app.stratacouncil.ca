-- Joining and leaving meetings, one agenda editor at a time (2026-11-04).
--
--   Agenda checkout: before a meeting is launched, one person who can run
--   meetings edits its agenda at a time (meetings.agenda_editor, with
--   agenda_editor_at refreshed as they work). Anyone else sees who has it.
--   A checkout untouched for 15 minutes can be taken over.
--
--   meeting_presence: who joined and left a launched meeting, and when.
--   Council members and the manager join from the Meetings tab once the
--   meeting is launched (not only once it's called to order); joining marks
--   a council member's lot present in the attendance, leaving marks it
--   'left', and either can happen any number of times. The person running
--   the meeting can mark someone as having left (typing "Left meeting" to
--   confirm), e.g. a phone caller who hung up. Late arrivals and departures
--   go in the minutes from here.
--
--   Live voting (0073) works from launch too, with two more rules: a vote
--   can't be opened without quorum, and a conflict of interest needs its
--   nature described (SPA s.32: disclose "the nature and extent" of it).
--
-- Grants: meeting_presence is read through its policy (select only) and
-- written only through the functions below; anon gets nothing. The new
-- meetings columns are granted to authenticated like the table's others
-- (0072).
--
-- Safe to re-run.

alter table public.meetings add column if not exists agenda_editor uuid references public.profiles(id) on delete set null;
alter table public.meetings add column if not exists agenda_editor_at timestamptz;
grant select (agenda_editor, agenda_editor_at) on public.meetings to authenticated;

-- 'left' joins the attendance statuses: present earlier, not in the meeting now.
-- (Attendance is jsonb {lot: status}; its values are checked by the app.)

create table if not exists public.meeting_presence (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  -- The council lot, when the person has one (a manager doesn't).
  lot_number text,
  event text not null check (event in ('joined', 'left', 'marked_left')),
  by_user uuid references public.profiles(id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists meeting_presence_meeting_idx on public.meeting_presence (meeting_id, id);

alter table public.meeting_presence enable row level security;
revoke all on public.meeting_presence from anon, authenticated;
grant select on public.meeting_presence to authenticated;
grant all on public.meeting_presence to service_role;

drop policy if exists "followers read presence" on public.meeting_presence;
create policy "followers read presence" on public.meeting_presence
  for select using (public.can_follow_meeting(meeting_id));

-- ── Agenda checkout ────────────────────────────────────────────────────

-- Takes (or keeps) the agenda for editing. Returns who has it: the caller
-- if they got it. A checkout untouched for 15 minutes is free to take.
create or replace function public.claim_agenda(p_meeting_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_name text;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'Only someone who can run meetings can edit the agenda.' using errcode = '42501';
  end if;
  if v_meeting.status <> 'DRAFT' or v_meeting.launched_by is not null then
    raise exception 'This meeting has been launched, so its agenda can''t be changed here any more.';
  end if;
  if v_meeting.agenda_editor is null or v_meeting.agenda_editor = auth.uid()
     or v_meeting.agenda_editor_at < now() - interval '15 minutes' then
    update public.meetings set agenda_editor = auth.uid(), agenda_editor_at = now() where id = p_meeting_id;
    return jsonb_build_object('mine', true, 'since', now());
  end if;
  select full_name into v_name from public.profiles where id = v_meeting.agenda_editor;
  return jsonb_build_object('mine', false, 'editor', coalesce(v_name, 'Someone'), 'since', v_meeting.agenda_editor_at);
end;
$$;

create or replace function public.release_agenda(p_meeting_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.meetings set agenda_editor = null, agenda_editor_at = null
  where id = p_meeting_id and agenda_editor = auth.uid();
$$;

-- ── Who runs a meeting, from launch ────────────────────────────────────

-- Whoever launched this meeting, while it's launched and not adjourned
-- (0073 required it to be called to order).
create or replace function public.runs_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id and m.status <> 'ADJOURNED' and m.launched_by = auth.uid()
      and public.can_run_meetings(m.corporation_id)
  );
$$;

-- Council quorum (Standard Bylaws 16(1)): 1 member, 1; 2 to 4, 2; 5 or 6, 3;
-- 7, 4; a larger council, a majority. Mirrors councilQuorum() in
-- lib/meetings/rules.ts.
create or replace function public.council_quorum(p_members int)
returns int
language sql
immutable
set search_path = public
as $$
  select case
    when p_members <= 1 then 1
    when p_members <= 4 then 2
    when p_members <= 6 then 3
    when p_members = 7 then 4
    else p_members / 2 + 1
  end;
$$;

-- ── Joining and leaving ────────────────────────────────────────────────

-- Sets one lot's attendance status (and the present list) on a meeting.
create or replace function public.set_meeting_attendance(p_meeting_id uuid, p_lot text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_att jsonb;
begin
  select coalesce(attendance, '{}'::jsonb) || jsonb_build_object(p_lot, p_status) into v_att
  from public.meetings where id = p_meeting_id;
  update public.meetings
    set attendance = v_att,
        attendees = coalesce((select jsonb_agg(k order by k) from jsonb_each_text(v_att) e(k, v) where v = 'present'), '[]'::jsonb)
    where id = p_meeting_id;
end;
$$;
revoke all on function public.set_meeting_attendance(uuid, text, text) from public, anon, authenticated;

-- The signed-in person joins (or rejoins) a launched meeting.
create or replace function public.join_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_lot text;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.can_follow_meeting(p_meeting_id) then
    raise exception 'This meeting isn''t available to you.' using errcode = '42501';
  end if;
  if v_meeting.launched_by is null or v_meeting.status = 'ADJOURNED' then
    raise exception 'This meeting isn''t running.';
  end if;
  -- Their council lot, if they're on council.
  select o.lot_number into v_lot
  from public.owners_and_council o
  where o.corporation_id = v_meeting.corporation_id and o.is_council_member
    and o.lot_number = public.my_strata_lot(v_meeting.corporation_id);
  -- Already in: nothing to record.
  if exists (
    select 1 from (
      select event from public.meeting_presence
      where meeting_id = p_meeting_id and user_id = auth.uid()
      order by id desc limit 1
    ) last where last.event = 'joined'
  ) and (v_lot is null or v_meeting.attendance ->> v_lot = 'present') then
    return;
  end if;
  insert into public.meeting_presence (meeting_id, user_id, lot_number, event, by_user)
  values (p_meeting_id, auth.uid(), v_lot, 'joined', auth.uid());
  if v_lot is not null then
    perform public.set_meeting_attendance(p_meeting_id, v_lot, 'present');
  end if;
end;
$$;

-- The signed-in person leaves.
create or replace function public.leave_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_lot text;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.can_follow_meeting(p_meeting_id) or v_meeting.status = 'ADJOURNED' then
    return;
  end if;
  select o.lot_number into v_lot
  from public.owners_and_council o
  where o.corporation_id = v_meeting.corporation_id and o.is_council_member
    and o.lot_number = public.my_strata_lot(v_meeting.corporation_id);
  insert into public.meeting_presence (meeting_id, user_id, lot_number, event, by_user)
  values (p_meeting_id, auth.uid(), v_lot, 'left', auth.uid());
  if v_lot is not null and v_meeting.attendance ->> v_lot = 'present' then
    perform public.set_meeting_attendance(p_meeting_id, v_lot, 'left');
  end if;
end;
$$;

-- The runner marks a council lot as having left (a phone caller who hung
-- up, someone whose connection dropped). They type "Left meeting" first.
create or replace function public.mark_left_meeting(p_meeting_id uuid, p_lot text, p_confirm text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can mark someone as having left.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> 'left meeting' then
    raise exception 'Type "Left meeting" to confirm.';
  end if;
  if coalesce(v_meeting.attendance ->> p_lot, '') <> 'present' then
    raise exception 'That lot isn''t marked present.';
  end if;
  insert into public.meeting_presence (meeting_id, user_id, lot_number, event, by_user)
  values (
    p_meeting_id,
    (select m.user_id from public.corporation_memberships m
     where m.corporation_id = v_meeting.corporation_id and m.lot_number = p_lot and m.status = 'active' limit 1),
    p_lot, 'marked_left', auth.uid()
  );
  perform public.set_meeting_attendance(p_meeting_id, p_lot, 'left');
end;
$$;

-- ── Live voting, from launch, with quorum ──────────────────────────────

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

create or replace function public.declare_meeting_conflict(p_meeting_id uuid, p_item_id text, p_lot text, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_open public.meeting_votes;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null or v_meeting.launched_by is null or v_meeting.status = 'ADJOURNED' then
    raise exception 'Conflicts are declared during the meeting.';
  end if;
  if not (public.runs_meeting(p_meeting_id)
          or (public.is_on_council(v_meeting.corporation_id) and p_lot = public.my_strata_lot(v_meeting.corporation_id))) then
    raise exception 'Declare a conflict for yourself, or ask the person running the meeting to record it.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'Describe the conflict: its nature goes in the minutes (SPA s.32).';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e where e->>'id' = p_item_id) then
    raise exception 'That agenda item isn''t on the agenda.';
  end if;
  insert into public.meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by)
  values (p_meeting_id, p_item_id, p_lot, left(btrim(p_note), 500), auth.uid())
  on conflict (meeting_id, item_id, lot_number) do update set note = excluded.note;

  select * into v_open from public.meeting_votes
  where meeting_id = p_meeting_id and item_id = p_item_id and status = 'open' for update;
  if v_open.id is not null and p_lot = any (v_open.eligible_lots) then
    update public.meeting_votes set eligible_lots = array_remove(eligible_lots, p_lot) where id = v_open.id;
    delete from public.meeting_ballots where vote_id = v_open.id and lot_number = p_lot;
    insert into public.meeting_ballot_log (vote_id, lot_number, choice, cast_by, note)
    values (v_open.id, p_lot, null, auth.uid(), 'conflict declared: left the vote');
  end if;
end;
$$;

-- As in 0073, plus who's in the meeting and the join/leave log.
create or replace function public.live_meeting_state(p_meeting_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_runner boolean;
  v_lot text;
  v_on_council boolean;
  v_open public.meeting_votes;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null or not public.can_follow_meeting(p_meeting_id) then
    return null;
  end if;
  v_runner := v_meeting.launched_by = auth.uid();
  v_lot := public.my_strata_lot(v_meeting.corporation_id);
  v_on_council := public.is_on_council(v_meeting.corporation_id);
  select * into v_open from public.meeting_votes where meeting_id = p_meeting_id and status = 'open';

  return jsonb_build_object(
    'status', v_meeting.status,
    'launched', v_meeting.launched_by is not null,
    'agenda', v_meeting.agenda,
    'attendance', v_meeting.attendance,
    'currentItemId', v_meeting.current_item_id,
    'calledToOrderAt', v_meeting.actual_start_at,
    'chair', v_meeting.chair_name,
    'updatedAt', v_meeting.updated_at,
    'isRunner', v_runner,
    'myLot', case when v_on_council then v_lot end,
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object('itemId', item_id, 'lot', lot_number, 'note', note) order by declared_at)
      from public.meeting_conflicts where meeting_id = p_meeting_id), '[]'::jsonb),
    'presence', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'userId', p.user_id, 'name', coalesce(pr.full_name, ''), 'lot', p.lot_number, 'event', p.event, 'at', p.at) order by p.id)
      from public.meeting_presence p left join public.profiles pr on pr.id = p.user_id
      where p.meeting_id = p_meeting_id), '[]'::jsonb),
    'openVote', case when v_open.id is null then null else jsonb_build_object(
      'id', v_open.id,
      'itemId', v_open.item_id,
      'motion', v_open.motion,
      'decisionType', v_open.decision_type,
      'openedAt', v_open.opened_at,
      'eligibleLots', to_jsonb(v_open.eligible_lots),
      'votedCount', (select count(*) from public.meeting_ballots b where b.vote_id = v_open.id),
      'myBallot', (select b.choice from public.meeting_ballots b where b.vote_id = v_open.id and b.lot_number = v_lot and v_on_council),
      'ballots', case when v_runner then coalesce((
        select jsonb_agg(jsonb_build_object('lot', b.lot_number, 'choice', b.choice, 'forOther', b.cast_for_other, 'at', b.cast_at) order by b.lot_number)
        from public.meeting_ballots b where b.vote_id = v_open.id), '[]'::jsonb) end
    ) end,
    'closedVotes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'itemId', v.item_id, 'for', v.votes_for, 'against', v.votes_against,
        'abstain', v.votes_abstain, 'missing', v.votes_missing, 'present', cardinality(v.eligible_lots),
        'closedAt', v.closed_at) order by v.closed_at)
      from public.meeting_votes v where v.meeting_id = p_meeting_id and v.status = 'closed'), '[]'::jsonb)
  );
end;
$$;

-- ── Function grants ────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.claim_agenda(uuid)', 'public.release_agenda(uuid)', 'public.runs_meeting(uuid)',
    'public.council_quorum(int)', 'public.join_meeting(uuid)', 'public.leave_meeting(uuid)',
    'public.mark_left_meeting(uuid, text, text)', 'public.open_meeting_vote(uuid, text, text, text)',
    'public.declare_meeting_conflict(uuid, text, text, text)', 'public.live_meeting_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
