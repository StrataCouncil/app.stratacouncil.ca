-- 0075: the person running a council meeting marks someone present (on the
-- phone, in the room), with the time, the same as joining online. Attendance
-- changes made through these functions also keep an open vote honest:
-- someone who leaves before voting is no longer counted for it, someone who
-- arrives can vote, and a vote can't close once quorum is lost.
-- Safe to re-run.

-- A join entered by the runner.
alter table public.meeting_presence drop constraint if exists meeting_presence_event_check;
alter table public.meeting_presence
  add constraint meeting_presence_event_check check (event in ('joined', 'marked_joined', 'left', 'marked_left'));

-- Internal: one lot's attendance. Leaving before Call to Order just clears
-- it (they weren't at the meeting). While a vote is open, a lot that leaves
-- without having voted drops out of it, and one that arrives (with no
-- conflict on that item) is added.
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
       and not exists (select 1 from public.meeting_conflicts c where c.meeting_id = p_meeting_id and c.item_id = v_open.item_id and c.lot_number = p_lot) then
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

-- The runner marks a council lot present, at this time.
create or replace function public.mark_joined_meeting(p_meeting_id uuid, p_lot text)
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
    raise exception 'Only the person running this meeting can mark someone present.' using errcode = '42501';
  end if;
  if v_meeting.type in ('agm', 'sgm') then
    raise exception 'That lot isn''t on council.';
  end if;
  if not exists (
    select 1 from public.owners_and_council o
    where o.corporation_id = v_meeting.corporation_id and o.is_council_member and o.lot_number = p_lot
  ) then
    raise exception 'That lot isn''t on council.';
  end if;
  if coalesce(v_meeting.attendance ->> p_lot, '') = 'present' then
    return;
  end if;
  insert into public.meeting_presence (meeting_id, user_id, lot_number, event, by_user)
  values (
    p_meeting_id,
    (select m.user_id from public.corporation_memberships m
     where m.corporation_id = v_meeting.corporation_id and m.lot_number = p_lot and m.status = 'active' limit 1),
    p_lot, 'marked_joined', auth.uid()
  );
  perform public.set_meeting_attendance(p_meeting_id, p_lot, 'present');
end;
$$;

-- Closing a vote needs quorum too: people may have left since it opened.
create or replace function public.close_meeting_vote(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
  v_meeting public.meetings;
  v_council int;
  v_present int;
  v_for int;
  v_against int;
  v_abstain int;
  v_cast int;
begin
  select * into v_vote from public.meeting_votes where id = p_vote_id for update;
  if v_vote.id is null or not public.runs_meeting(v_vote.meeting_id) then
    raise exception 'Only the person running this meeting can close the vote.' using errcode = '42501';
  end if;
  if v_vote.status <> 'open' then
    raise exception 'This vote is already closed.';
  end if;
  select * into v_meeting from public.meetings where id = v_vote.meeting_id;
  select count(*), count(*) filter (where coalesce(v_meeting.attendance ->> o.lot_number, '') = 'present')
    into v_council, v_present
  from public.owners_and_council o
  where o.corporation_id = v_meeting.corporation_id and o.is_council_member;
  if v_present < public.council_quorum(v_council) then
    raise exception 'No quorum: % of % council members present, % needed. Cancel this vote, or wait until quorum is back.',
      v_present, v_council, public.council_quorum(v_council);
  end if;
  select coalesce(sum(weight) filter (where choice = 'for'), 0),
         coalesce(sum(weight) filter (where choice = 'against'), 0),
         coalesce(sum(weight) filter (where choice = 'abstain'), 0),
         count(*)
    into v_for, v_against, v_abstain, v_cast
  from public.meeting_ballots where vote_id = p_vote_id;
  update public.meeting_votes
    set status = 'closed', closed_by = auth.uid(), closed_at = now(),
        votes_for = v_for, votes_against = v_against, votes_abstain = v_abstain,
        votes_missing = greatest(cardinality(eligible_lots) - v_cast, 0)
    where id = p_vote_id
    returning * into v_vote;
  return jsonb_build_object(
    'for', v_vote.votes_for, 'against', v_vote.votes_against, 'abstain', v_vote.votes_abstain,
    'missing', v_vote.votes_missing, 'present', cardinality(v_vote.eligible_lots)
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.mark_joined_meeting(uuid, text)', 'public.close_meeting_vote(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
