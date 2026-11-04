-- 0079: a launched meeting is never left without someone running it.
--
-- * The Runner's screen checks in every 20 seconds (meetings.runner_seen_at).
-- * hand_over_meeting: the Runner hands the meeting to someone in it who can
--   run meetings. They become the Runner; the old one stays as a member.
-- * take_over_meeting: if the Runner's screen hasn't checked in for 2
--   minutes, anyone in the meeting who can run meetings can take over.
-- * meeting_handovers records each change, for the minutes.
-- The agenda, attendance and any open vote are in the database already, so
-- nothing is lost in a handover.
-- Safe to re-run.

alter table public.meetings add column if not exists runner_seen_at timestamptz;
grant select (runner_seen_at) on public.meetings to authenticated;

create table if not exists public.meeting_handovers (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  from_user uuid references public.profiles(id) on delete set null,
  to_user uuid references public.profiles(id) on delete set null,
  -- Names kept, so the record survives an account being deleted.
  from_name text not null default '',
  to_name text not null default '',
  kind text not null check (kind in ('handed_over', 'took_over')),
  at timestamptz not null default now()
);
create index if not exists meeting_handovers_meeting_idx on public.meeting_handovers (meeting_id, id);
alter table public.meeting_handovers enable row level security;
revoke all on public.meeting_handovers from anon, authenticated;
grant select on public.meeting_handovers to authenticated;
grant all on public.meeting_handovers to service_role;
drop policy if exists "followers read handovers" on public.meeting_handovers;
create policy "followers read handovers" on public.meeting_handovers
  for select using (public.can_follow_meeting(meeting_id));

-- Whether a person (not just the caller) can run this strata's meetings:
-- an active member who is its admin or secretary, or has been allowed to.
create or replace function public.user_can_run_meetings(p_corporation_id text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.corporation_memberships m
    where m.corporation_id = p_corporation_id and m.user_id = p_user and m.status = 'active'
      and (m.can_run_meetings or exists (
        select 1 from public.corporation_role_assignments r
        where r.corporation_id = p_corporation_id and r.user_id = p_user and r.role in ('admin', 'secretary')))
  ) or coalesce((select is_super_admin from public.profiles where id = p_user), false);
$$;
revoke all on function public.user_can_run_meetings(text, uuid) from public, anon, authenticated;

-- In the meeting now: their latest join or leave is a join.
create or replace function public.in_meeting(p_meeting_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.event in ('joined', 'marked_joined') from public.meeting_presence p
    where p.meeting_id = p_meeting_id and p.user_id = p_user
    order by p.id desc limit 1
  ), false);
$$;
revoke all on function public.in_meeting(uuid, uuid) from public, anon, authenticated;

create or replace function public.runner_check_in(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting checks in.' using errcode = '42501';
  end if;
  update public.meetings set runner_seen_at = now() where id = p_meeting_id;
end;
$$;

create or replace function public.hand_over_meeting(p_meeting_id uuid, p_to uuid)
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
    raise exception 'Only the person running this meeting can hand it over.' using errcode = '42501';
  end if;
  if p_to is null or p_to = auth.uid() then
    raise exception 'Choose who takes over.';
  end if;
  if not public.user_can_run_meetings(v_meeting.corporation_id, p_to) then
    raise exception 'That person can''t run meetings.';
  end if;
  if not public.in_meeting(p_meeting_id, p_to) then
    raise exception 'That person isn''t in the meeting. They need to join first.';
  end if;
  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings set launched_by = p_to, runner_seen_at = now() where id = p_meeting_id;
  perform set_config('app.meeting_lifecycle', '', true);
  insert into public.meeting_handovers (meeting_id, from_user, to_user, from_name, to_name, kind)
  values (p_meeting_id, auth.uid(), p_to,
    coalesce((select full_name from public.profiles where id = auth.uid()), ''),
    coalesce((select full_name from public.profiles where id = p_to), ''), 'handed_over');
end;
$$;

create or replace function public.take_over_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or v_meeting.launched_by is null or v_meeting.status = 'ADJOURNED' then
    raise exception 'This meeting isn''t running.';
  end if;
  if v_meeting.launched_by = auth.uid() then
    return;
  end if;
  if not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'Only someone who can run meetings can take this one over.' using errcode = '42501';
  end if;
  if not public.in_meeting(p_meeting_id, auth.uid()) then
    raise exception 'Join the meeting first.';
  end if;
  if coalesce(v_meeting.runner_seen_at, v_meeting.launched_at) > now() - interval '2 minutes' then
    raise exception 'The person running the meeting is still connected. Ask them to hand it over.';
  end if;
  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings set launched_by = auth.uid(), runner_seen_at = now() where id = p_meeting_id;
  perform set_config('app.meeting_lifecycle', '', true);
  insert into public.meeting_handovers (meeting_id, from_user, to_user, from_name, to_name, kind)
  values (p_meeting_id, v_meeting.launched_by, auth.uid(),
    coalesce((select full_name from public.profiles where id = v_meeting.launched_by), ''),
    coalesce((select full_name from public.profiles where id = auth.uid()), ''), 'took_over');
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.runner_check_in(uuid)', 'public.hand_over_meeting(uuid, uuid)', 'public.take_over_meeting(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
