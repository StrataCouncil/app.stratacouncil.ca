-- 0082: a conflict of interest declared by a council member waits for the
-- person running the meeting to acknowledge it (SPA s.32: the member
-- discloses it and leaves while the matter is discussed and voted on;
-- council doesn't approve a conflict, the runner just acknowledges it).
-- Until it's acknowledged the member is still in the meeting and can vote.
-- Once acknowledged they step out: they leave the video, aren't counted for
-- the item's votes, and are back when the meeting moves on. A conflict the
-- runner records for someone is acknowledged at once.
-- Safe to re-run.
--
-- Grants: execute on acknowledge_meeting_conflict(uuid, text, text) and the
-- redefined declare_meeting_conflict, open_meeting_vote and
-- live_meeting_state to authenticated and service_role (none to public or
-- anon). set_meeting_attendance stays internal (no grants).

alter table public.meeting_conflicts add column if not exists acknowledged_at timestamptz;
alter table public.meeting_conflicts add column if not exists acknowledged_by uuid references public.profiles(id) on delete set null;

-- Conflicts recorded before this change took effect at once: they count as
-- acknowledged. Meetings running right now are left as they are.
update public.meeting_conflicts c
  set acknowledged_at = c.declared_at
  where c.acknowledged_at is null
    and not exists (select 1 from public.meetings m where m.id = c.meeting_id and m.status = 'LIVE');

-- Internal: an acknowledged conflict takes the lot out of an open vote on
-- that item (their ballot, if any, is withdrawn).
create or replace function public.leave_vote_for_conflict(p_meeting_id uuid, p_item_id text, p_lot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open public.meeting_votes;
begin
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
revoke all on function public.leave_vote_for_conflict(uuid, text, text) from public, anon, authenticated;

-- Declared by the member for their own lot (waits for the runner), or
-- recorded by the runner for anyone (acknowledged at once).
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

-- The runner acknowledges a member's declaration: they step out.
create or replace function public.acknowledge_meeting_conflict(p_meeting_id uuid, p_item_id text, p_lot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can acknowledge a conflict.' using errcode = '42501';
  end if;
  update public.meeting_conflicts
    set acknowledged_at = now(), acknowledged_by = auth.uid()
    where meeting_id = p_meeting_id and item_id = p_item_id and lot_number = p_lot and acknowledged_at is null;
  if not found and not exists (
    select 1 from public.meeting_conflicts where meeting_id = p_meeting_id and item_id = p_item_id and lot_number = p_lot
  ) then
    raise exception 'That declaration isn''t there any more.';
  end if;
  perform public.leave_vote_for_conflict(p_meeting_id, p_item_id, p_lot);
end;
$$;

-- As in 0074: only acknowledged conflicts keep a lot out of a vote.
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

-- As in 0075: only acknowledged conflicts keep an arriving lot out of an open vote.
create or replace function public.set_meeting_attendance(p_meeting_id uuid, p_lot text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_att jsonb;
  v_open public.meeting_votes;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id;
  if v_meeting.id is null then
    return;
  end if;
  v_att := coalesce(v_meeting.attendance, '{}'::jsonb);
  if p_status = 'left' and v_meeting.actual_start_at is null then
    v_att := v_att - p_lot;
  else
    v_att := v_att || jsonb_build_object(p_lot, p_status);
  end if;
  update public.meetings
    set attendance = v_att,
        attendees = coalesce((select jsonb_agg(k order by k) from jsonb_each_text(v_att) e(k, v) where v = 'present'), '[]'::jsonb)
    where id = p_meeting_id;

  select * into v_open from public.meeting_votes where meeting_id = p_meeting_id and status = 'open' for update;
  if v_open.id is null then
    return;
  end if;
  if p_status = 'present' then
    if not (p_lot = any (v_open.eligible_lots))
       and not exists (select 1 from public.meeting_conflicts c where c.meeting_id = p_meeting_id and c.item_id = v_open.item_id and c.lot_number = p_lot
                         and c.acknowledged_at is not null) then
      update public.meeting_votes set eligible_lots = array_append(eligible_lots, p_lot) where id = v_open.id;
    end if;
  elsif p_lot = any (v_open.eligible_lots)
        and not exists (select 1 from public.meeting_ballots b where b.vote_id = v_open.id and b.lot_number = p_lot) then
    -- A ballot already cast stands: they were there when they voted.
    update public.meeting_votes set eligible_lots = array_remove(eligible_lots, p_lot) where id = v_open.id;
  end if;
end;
$$;
revoke all on function public.set_meeting_attendance(uuid, text, text) from public, anon, authenticated;

-- As in 0074, with each conflict's acknowledged state.
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
      select jsonb_agg(jsonb_build_object('itemId', item_id, 'lot', lot_number, 'note', note, 'acknowledged', acknowledged_at is not null) order by declared_at)
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

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.declare_meeting_conflict(uuid, text, text, text)', 'public.acknowledge_meeting_conflict(uuid, text, text)',
    'public.open_meeting_vote(uuid, text, text, text)', 'public.live_meeting_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
