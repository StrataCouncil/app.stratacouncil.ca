-- Live voting in Meeting Mode (2026-11-04). Council members vote from their
-- own screens while the meeting runs; whoever runs the meeting sees each
-- vote as it comes in and can enter a vote for anyone (someone on the
-- phone, or in the room without a device). Council meetings only for now;
-- the tables already carry what general meetings will need (one vote per
-- lot, weights, proxy holders, secret ballots), unused until then.
--
--   meetings.current_item_id   the agenda item the runner has on screen, so
--                              members' pages follow along
--   meeting_votes              one vote held on a motion: a copy of the
--                              motion, who may vote (a snapshot of the
--                              council lots present, minus anyone with a
--                              declared conflict), and once closed, the
--                              counts. Locked once closed or cancelled.
--   meeting_ballots            one ballot per lot per vote. The member can
--                              change their own until the vote closes; the
--                              runner can change only ballots they entered
--                              for someone else (and their own).
--   meeting_ballot_log         every ballot as cast or changed, with who
--                              pressed the button
--   meeting_conflicts          conflicts of interest declared on an agenda
--                              item (SPA s.32). The member is left out of
--                              "present" for that item's votes, and the
--                              declaration goes in the minutes.
--
-- Who may vote: council members (their membership's lot is a council lot)
-- whose lot is marked present. A manager or anyone else following the
-- meeting has no vote. Who may follow: anyone on council or able to run
-- meetings, the strata's manager, and Super Admins.
--
-- Grants: all four tables are read through their policies (select only) and
-- written only through the functions below; anon gets nothing.
-- meetings.current_item_id is granted to authenticated like the table's
-- other columns (0072).
--
-- Safe to re-run.

alter table public.meetings add column if not exists current_item_id text;
grant select (current_item_id) on public.meetings to authenticated;

create table if not exists public.meeting_votes (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  item_id text not null,
  motion text not null,
  decision_type text not null check (decision_type in ('MAJORITY', 'THREE_QUARTER', 'EIGHTY_PERCENT', 'UNANIMOUS')),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  -- General meetings, later: a secret ballot hides how each lot voted from
  -- everyone but the record; weights by unit entitlement for some votes.
  secret boolean not null default false,
  weighting text not null default 'one_per_voter' check (weighting in ('one_per_voter', 'unit_entitlement')),
  eligible_lots text[] not null,
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  votes_for int,
  votes_against int,
  votes_abstain int,
  votes_missing int
);
create unique index if not exists meeting_votes_one_open on public.meeting_votes (meeting_id) where status = 'open';
create index if not exists meeting_votes_meeting_idx on public.meeting_votes (meeting_id, item_id);

create table if not exists public.meeting_ballots (
  vote_id uuid not null references public.meeting_votes(id) on delete cascade,
  lot_number text not null,
  choice text not null check (choice in ('for', 'against', 'abstain')),
  weight int not null default 1 check (weight > 0),
  cast_by uuid references public.profiles(id) on delete set null,
  -- True when the runner entered it for someone else.
  cast_for_other boolean not null default false,
  -- General meetings, later: the proxy holder who cast it.
  proxy_holder text,
  cast_at timestamptz not null default now(),
  primary key (vote_id, lot_number)
);

create table if not exists public.meeting_ballot_log (
  id bigint generated always as identity primary key,
  vote_id uuid not null references public.meeting_votes(id) on delete cascade,
  lot_number text not null,
  choice text check (choice in ('for', 'against', 'abstain')),
  cast_by uuid references public.profiles(id) on delete set null,
  cast_for_other boolean not null default false,
  note text,
  at timestamptz not null default now()
);
create index if not exists meeting_ballot_log_vote_idx on public.meeting_ballot_log (vote_id, at);

create table if not exists public.meeting_conflicts (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  item_id text not null,
  lot_number text not null,
  note text not null default '',
  declared_by uuid references public.profiles(id) on delete set null,
  declared_at timestamptz not null default now(),
  primary key (meeting_id, item_id, lot_number)
);

alter table public.meeting_votes enable row level security;
alter table public.meeting_ballots enable row level security;
alter table public.meeting_ballot_log enable row level security;
alter table public.meeting_conflicts enable row level security;

revoke all on public.meeting_votes, public.meeting_ballots, public.meeting_ballot_log, public.meeting_conflicts from anon, authenticated;
grant select on public.meeting_votes, public.meeting_ballots, public.meeting_ballot_log, public.meeting_conflicts to authenticated;
grant all on public.meeting_votes, public.meeting_ballots, public.meeting_ballot_log, public.meeting_conflicts to service_role;

-- ── Helpers ────────────────────────────────────────────────────────────

-- The signed-in person's lot on this strata (their active membership).
create or replace function public.my_strata_lot(p_corporation_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lot_number from public.corporation_memberships
  where corporation_id = p_corporation_id and user_id = auth.uid() and status = 'active'
  limit 1;
$$;

-- Who can follow a meeting live: council, anyone who can run meetings, the manager, Super Admins.
create or replace function public.can_follow_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id
      and (public.is_super_admin()
        or (public.is_corporation_member(m.corporation_id)
            and (public.is_on_council(m.corporation_id) or public.can_run_meetings(m.corporation_id)
                 or public.has_corporation_role(m.corporation_id, array['manager']))))
  );
$$;

-- Whoever is running this meeting (it's live and they launched it).
create or replace function public.runs_meeting(p_meeting_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id and m.status = 'LIVE' and m.launched_by = auth.uid()
      and public.can_run_meetings(m.corporation_id)
  );
$$;

-- ── Read rules ─────────────────────────────────────────────────────────

drop policy if exists "followers read votes" on public.meeting_votes;
create policy "followers read votes" on public.meeting_votes
  for select using (public.can_follow_meeting(meeting_id));

-- How each lot voted: the runner, Super Admins, and each member their own.
drop policy if exists "runner and voter read ballots" on public.meeting_ballots;
create policy "runner and voter read ballots" on public.meeting_ballots
  for select using (exists (
    select 1 from public.meeting_votes v join public.meetings m on m.id = v.meeting_id
    where v.id = meeting_ballots.vote_id
      and (m.launched_by = auth.uid() or public.is_super_admin()
        or (public.is_on_council(m.corporation_id) and meeting_ballots.lot_number = public.my_strata_lot(m.corporation_id)))
  ));

drop policy if exists "runner reads the ballot log" on public.meeting_ballot_log;
create policy "runner reads the ballot log" on public.meeting_ballot_log
  for select using (exists (
    select 1 from public.meeting_votes v join public.meetings m on m.id = v.meeting_id
    where v.id = meeting_ballot_log.vote_id and (m.launched_by = auth.uid() or public.is_super_admin())
  ));

drop policy if exists "followers read conflicts" on public.meeting_conflicts;
create policy "followers read conflicts" on public.meeting_conflicts
  for select using (public.can_follow_meeting(meeting_id));

-- ── Votes ──────────────────────────────────────────────────────────────

-- Open a vote on an agenda item's motion. The runner's screen saves the
-- agenda first; the motion text and decision type are copied in.
create or replace function public.open_meeting_vote(p_meeting_id uuid, p_item_id text, p_motion text, p_decision_type text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
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

  -- Council lots marked present, less anyone with a declared conflict on this item.
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

-- Saves a ballot and logs it. Shared by cast_meeting_vote and record_meeting_vote.
create or replace function public.put_meeting_ballot(p_vote_id uuid, p_lot text, p_choice text, p_for_other boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.meeting_ballots (vote_id, lot_number, choice, cast_by, cast_for_other, cast_at)
  values (p_vote_id, p_lot, p_choice, auth.uid(), p_for_other, now())
  on conflict (vote_id, lot_number) do update
    set choice = excluded.choice, cast_by = excluded.cast_by, cast_for_other = excluded.cast_for_other, cast_at = now();
  insert into public.meeting_ballot_log (vote_id, lot_number, choice, cast_by, cast_for_other)
  values (p_vote_id, p_lot, p_choice, auth.uid(), p_for_other);
end;
$$;
revoke all on function public.put_meeting_ballot(uuid, text, text, boolean) from public, anon, authenticated;

-- A council member votes for their own lot, and can change it until the vote closes.
create or replace function public.cast_meeting_vote(p_vote_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
  v_corp text;
  v_lot text;
begin
  select * into v_vote from public.meeting_votes where id = p_vote_id for update;
  if v_vote.id is null or v_vote.status <> 'open' then
    raise exception 'This vote is closed.';
  end if;
  if p_choice not in ('for', 'against', 'abstain') then
    raise exception 'Choose For, Against or Abstain.';
  end if;
  select corporation_id into v_corp from public.meetings where id = v_vote.meeting_id;
  v_lot := public.my_strata_lot(v_corp);
  if v_lot is null or not public.is_on_council(v_corp) or not (v_lot = any (v_vote.eligible_lots)) then
    raise exception 'Only council members present can vote on this motion.' using errcode = '42501';
  end if;
  perform public.put_meeting_ballot(p_vote_id, v_lot, p_choice, false);
end;
$$;

-- The runner enters a vote for any council member present (on the phone,
-- or without a device). They can change a vote they entered, and their
-- own, but never one a member cast themselves.
create or replace function public.record_meeting_vote(p_vote_id uuid, p_lot text, p_choice text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
  v_corp text;
  v_existing public.meeting_ballots;
  v_own boolean;
begin
  select * into v_vote from public.meeting_votes where id = p_vote_id for update;
  if v_vote.id is null or v_vote.status <> 'open' then
    raise exception 'This vote is closed.';
  end if;
  if not public.runs_meeting(v_vote.meeting_id) then
    raise exception 'Only the person running this meeting can enter votes for others.' using errcode = '42501';
  end if;
  if p_choice not in ('for', 'against', 'abstain') then
    raise exception 'Choose For, Against or Abstain.';
  end if;
  if not (p_lot = any (v_vote.eligible_lots)) then
    raise exception 'That lot isn''t voting on this motion.';
  end if;
  select corporation_id into v_corp from public.meetings where id = v_vote.meeting_id;
  v_own := p_lot = public.my_strata_lot(v_corp) and public.is_on_council(v_corp);
  select * into v_existing from public.meeting_ballots where vote_id = p_vote_id and lot_number = p_lot;
  if not v_own and v_existing.vote_id is not null and not v_existing.cast_for_other then
    raise exception 'That member voted themselves. Only they can change it.' using errcode = '42501';
  end if;
  perform public.put_meeting_ballot(p_vote_id, p_lot, p_choice, not v_own);
end;
$$;

-- Close the vote: counts are fixed and nothing can change after this.
-- Anyone who didn't vote is counted as abstaining (council decisions are
-- by a majority of the members present, so a non-vote has the same effect).
create or replace function public.close_meeting_vote(p_vote_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
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

-- Cancel an open vote (opened by mistake, or the motion is amended). Its
-- ballots stay in the log.
create or replace function public.cancel_meeting_vote(p_vote_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
begin
  select * into v_vote from public.meeting_votes where id = p_vote_id for update;
  if v_vote.id is null or not public.runs_meeting(v_vote.meeting_id) then
    raise exception 'Only the person running this meeting can cancel the vote.' using errcode = '42501';
  end if;
  if v_vote.status <> 'open' then
    raise exception 'This vote is already closed.';
  end if;
  update public.meeting_votes set status = 'cancelled', closed_by = auth.uid(), closed_at = now() where id = p_vote_id;
end;
$$;

-- ── Conflicts of interest ──────────────────────────────────────────────

-- Declared by the member for their own lot, or recorded by the runner for
-- anyone. If a vote on the item is open, they leave it: their ballot is
-- withdrawn and they no longer count as present for it.
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
  if v_meeting.id is null or v_meeting.status <> 'LIVE' then
    raise exception 'Conflicts are declared during the meeting.';
  end if;
  if not (public.runs_meeting(p_meeting_id)
          or (public.is_on_council(v_meeting.corporation_id) and p_lot = public.my_strata_lot(v_meeting.corporation_id))) then
    raise exception 'Declare a conflict for yourself, or ask the person running the meeting to record it.' using errcode = '42501';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) e where e->>'id' = p_item_id) then
    raise exception 'That agenda item isn''t on the agenda.';
  end if;
  insert into public.meeting_conflicts (meeting_id, item_id, lot_number, note, declared_by)
  values (p_meeting_id, p_item_id, p_lot, left(coalesce(btrim(p_note), ''), 500), auth.uid())
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

-- A conflict recorded by mistake: the runner removes it. It doesn't reopen
-- a vote already held without them.
create or replace function public.withdraw_meeting_conflict(p_meeting_id uuid, p_item_id text, p_lot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can remove a conflict.' using errcode = '42501';
  end if;
  delete from public.meeting_conflicts where meeting_id = p_meeting_id and item_id = p_item_id and lot_number = p_lot;
end;
$$;

-- ── Following along ────────────────────────────────────────────────────

-- Everything a follower's screen needs, in one call: the agenda and where
-- the runner is, attendance, conflicts, the open vote (with the caller's
-- own ballot, and every ballot for the runner), and closed votes' counts.
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

-- ── When the meeting adjourns ──────────────────────────────────────────

-- A vote left open is cancelled: nothing can be cast after adjournment.
create or replace function public.cancel_votes_on_adjourn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meeting_votes set status = 'cancelled', closed_at = now()
  where meeting_id = new.id and status = 'open';
  return new;
end;
$$;
revoke all on function public.cancel_votes_on_adjourn() from public, anon, authenticated;

drop trigger if exists meetings_cancel_votes_on_adjourn on public.meetings;
create trigger meetings_cancel_votes_on_adjourn
  after update of status on public.meetings
  for each row when (new.status = 'ADJOURNED' and old.status is distinct from 'ADJOURNED')
  execute function public.cancel_votes_on_adjourn();

-- ── Function grants ────────────────────────────────────────────────────

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.my_strata_lot(text)', 'public.can_follow_meeting(uuid)', 'public.runs_meeting(uuid)',
    'public.open_meeting_vote(uuid, text, text, text)', 'public.cast_meeting_vote(uuid, text)',
    'public.record_meeting_vote(uuid, text, text)', 'public.close_meeting_vote(uuid)',
    'public.cancel_meeting_vote(uuid)', 'public.declare_meeting_conflict(uuid, text, text, text)',
    'public.withdraw_meeting_conflict(uuid, text, text)', 'public.live_meeting_state(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
