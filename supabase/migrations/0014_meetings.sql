-- doc01 §4, doc03 Stage 5a — meetings, private item notes, the decision
-- ledger, and who may run a meeting.
--
-- Who runs meetings (decided 2026-10-01): whoever holds the secretary or
-- admin role, plus any member the admin switches "Can run meetings" on for
-- (small councils). One switch replaces the earlier pair
-- (can_create_meetings / can_chair_meetings). Anyone who can run meetings
-- can create, edit, launch, run and finalize any of the corporation's
-- meetings; the creator gets nothing special. The chair is a label on the
-- meeting (default: the president), not a permission.
--
-- One launch: launching a meeting records who launched it, and from then
-- until the minutes are final only that person can change it or see its
-- private notes. The free trial meeting is consumed at launch.
--
-- Lifecycle fields (status, launch, trial, timestamps, minutes state) only
-- change through the functions below — a trigger refuses direct writes to
-- them, so the trial can't be side-stepped by setting status by hand.

-- ── Permission ──────────────────────────────────────────────────────────
alter table public.corporation_memberships add column can_run_meetings boolean not null default false;
update public.corporation_memberships set can_run_meetings = can_create_meetings or can_chair_meetings;

create or replace function public.can_run_meetings(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_corporation_member(target_corporation_id) and (
    public.has_corporation_role(target_corporation_id, array['admin', 'secretary'])
    or exists (
      select 1 from public.corporation_memberships
      where corporation_id = target_corporation_id and user_id = auth.uid()
        and status = 'active' and can_run_meetings
    )
  );
$$;

drop function public.corporation_member_directory(text);
create function public.corporation_member_directory(p_corporation_id text)
returns table (
  user_id uuid,
  full_name text,
  email text,
  status text,
  joined_at timestamptz,
  can_run_meetings boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select m.user_id, p.full_name, p.email, m.status, m.joined_at, m.can_run_meetings
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id
    and m.status in ('active', 'invited')
    and (public.is_corporation_member(p_corporation_id) or public.is_super_admin())
  order by m.status, p.full_name;
$$;

create or replace function public.remove_corporation_member(p_corporation_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_corporation_role(p_corporation_id, array['admin']) then
    raise exception 'Only this strata''s admin can remove members.';
  end if;

  if exists (
    select 1 from public.corporation_role_assignments
    where corporation_id = p_corporation_id and user_id = p_user_id and role = 'admin'
  ) then
    raise exception 'The admin can''t be removed. Assign Admin to another member first.';
  end if;

  delete from public.corporation_role_assignments
  where corporation_id = p_corporation_id and user_id = p_user_id;

  update public.corporation_memberships
    set status = 'removed', can_run_meetings = false
    where corporation_id = p_corporation_id and user_id = p_user_id;

  update public.corporation_invites i
    set status = 'revoked'
    from public.profiles p
    where p.id = p_user_id
      and i.corporation_id = p_corporation_id
      and i.status = 'pending'
      and lower(i.invited_email) = lower(p.email);
end;
$$;

alter table public.corporation_memberships
  drop column can_create_meetings,
  drop column can_chair_meetings;

-- ── Meetings ────────────────────────────────────────────────────────────
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  type text not null check (type in ('council', 'agm', 'sgm', 'committee')),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'LIVE', 'ADJOURNED')),
  meeting_date date not null,
  start_time time,
  timezone text not null default 'America/Vancouver',
  format text not null default 'in_person' check (format in ('in_person', 'virtual', 'hybrid')),
  location text,
  chair_name text,
  agenda jsonb not null default '[]'::jsonb,
  attendance jsonb not null default '{}'::jsonb,   -- { "SL004": "present" | "proxy" | "absent" }
  attendees jsonb not null default '[]'::jsonb,    -- flattened present lots, post Call to Order
  agenda_approved boolean not null default false,
  launched_by uuid references public.profiles(id),
  launched_at timestamptz,
  actual_start_at timestamptz,
  adjourned_at timestamptz,
  is_trial boolean not null default false,
  minutes_state text check (minutes_state in ('DRAFT', 'FINAL')),
  minutes_content jsonb,
  minutes_finalized_at timestamptz,
  minutes_finalized_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_agenda_is_array check (jsonb_typeof(agenda) = 'array'),
  constraint meetings_attendance_is_object check (jsonb_typeof(attendance) = 'object')
);

create index meetings_corporation_idx on public.meetings (corporation_id, meeting_date desc);
create unique index meetings_one_trial_per_corporation on public.meetings (corporation_id) where is_trial;

alter table public.documents
  add constraint documents_meeting_id_fkey foreign key (meeting_id) references public.meetings(id) on delete set null;

-- Lifecycle columns are function-only. The functions below set
-- app.meeting_lifecycle for the length of their transaction.
create or replace function public.meetings_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.meeting_lifecycle', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if (new.status, new.launched_by, new.launched_at, new.actual_start_at, new.adjourned_at, new.is_trial,
      new.minutes_state, new.minutes_finalized_at, new.minutes_finalized_by, new.corporation_id, new.created_by)
     is distinct from
     (old.status, old.launched_by, old.launched_at, old.actual_start_at, old.adjourned_at, old.is_trial,
      old.minutes_state, old.minutes_finalized_at, old.minutes_finalized_by, old.corporation_id, old.created_by) then
    raise exception 'meeting lifecycle fields change only through launch, call to order, adjourn and finalize'
      using errcode = '42501';
  end if;
  -- After adjournment the record of what happened is fixed; only the
  -- draft minutes text can still be edited, until finalized.
  if old.status = 'ADJOURNED'
     and (new.agenda, new.attendance, new.attendees, new.agenda_approved, new.type, new.meeting_date)
         is distinct from (old.agenda, old.attendance, old.attendees, old.agenda_approved, old.type, old.meeting_date) then
    raise exception 'an adjourned meeting''s agenda and attendance can''t be changed' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger meetings_guard before update on public.meetings
  for each row execute function public.meetings_guard();

alter table public.meetings enable row level security;

-- Members see their corporation's meetings: agendas circulate to council
-- anyway, and finalized minutes are a permanent governance record that is
-- never hidden behind billing (doc01 §4a principle).
create policy "members read meetings" on public.meetings
  for select using (public.is_corporation_member(corporation_id) or public.is_super_admin());

create policy "meeting runners create drafts" on public.meetings
  for insert with check (
    public.can_run_meetings(corporation_id)
    and created_by = auth.uid()
    and status = 'DRAFT' and launched_by is null and launched_at is null and not is_trial
    and minutes_state is null and actual_start_at is null and adjourned_at is null
  );

create policy "meeting runners edit; a launched meeting only by its launcher" on public.meetings
  for update
  using (
    public.can_run_meetings(corporation_id)
    and minutes_state is distinct from 'FINAL'
    and (launched_by is null or launched_by = auth.uid())
  )
  with check (public.can_run_meetings(corporation_id));

create policy "meeting runners delete unlaunched drafts" on public.meetings
  for delete using (public.can_run_meetings(corporation_id) and status = 'DRAFT' and launched_by is null);

-- ── Private item notes ──────────────────────────────────────────────────
-- A reference for whoever runs the meeting ("third noise complaint
-- against this lot"). Never part of the agenda, the minutes, or anything
-- sent to the AI; deleted for good when the minutes are finalized.
create table public.meeting_item_notes (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  item_id text not null,
  body text not null default '',
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, item_id)
);

alter table public.meeting_item_notes enable row level security;

create or replace function public.can_see_meeting_notes(p_meeting_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.meetings m
    where m.id = p_meeting_id
      and public.can_run_meetings(m.corporation_id)
      and (m.launched_by is null or m.launched_by = auth.uid())
      and m.minutes_state is distinct from 'FINAL'
  );
$$;

create policy "agenda editors and the launcher manage notes" on public.meeting_item_notes
  for all using (public.can_see_meeting_notes(meeting_id))
  with check (public.can_see_meeting_notes(meeting_id));

-- ── Decision ledger ─────────────────────────────────────────────────────
-- Written only at adjournment, from the carried motions (0015). No browse
-- surface (doc01 §4a); read only to feed Stratasphere.
create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number),
  meeting_id uuid references public.meetings(id),
  meeting_type text,
  agenda_item_id text,
  title text,
  description text,
  category text,
  motion_text text,
  mover text,
  seconder text,
  outcome text not null default 'CARRIED' check (outcome = 'CARRIED'),
  decision_type text,
  votes_for int,
  votes_against int,
  votes_abstain int,
  decided_at timestamptz not null default now(),
  source text not null default 'meeting' check (source in ('meeting', 'historic_minutes')),
  source_document_id uuid references public.documents(id)
);

create index decisions_corporation_idx on public.decisions (corporation_id, decided_at desc);
alter table public.decisions enable row level security;

-- ── Stratasphere access, now including the live trial ──────────────────
create or replace function public.has_stratasphere_access(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_corporation_member(target_corporation_id) and (
    exists (
      select 1 from public.subscriptions
      where corporation_id = target_corporation_id and status = 'active'
    )
    or exists (
      select 1 from public.meetings
      where corporation_id = target_corporation_id and is_trial
        and minutes_state is distinct from 'FINAL'
    )
  );
$$;

create policy "stratasphere members read decisions" on public.decisions
  for select using (public.has_stratasphere_access(corporation_id));

-- ── Lifecycle ───────────────────────────────────────────────────────────
create or replace function public.launch_meeting(p_meeting_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_subscribed boolean;
  v_trial_used boolean;
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

  perform set_config('app.meeting_lifecycle', 'on', true);

  select exists (
    select 1 from public.subscriptions where corporation_id = v_meeting.corporation_id and status = 'active'
  ) into v_subscribed;

  if not v_subscribed then
    select free_meeting_used into v_trial_used
      from public.strata_corporations where strata_plan_number = v_meeting.corporation_id for update;
    if v_trial_used then
      raise exception 'Your free meeting has been used. Subscribe to Stratasphere to run more meetings.'
        using errcode = 'P0001', hint = 'subscription_required';
    end if;
    update public.strata_corporations
      set free_meeting_used = true, free_meeting_used_at = now()
      where strata_plan_number = v_meeting.corporation_id;
    update public.meetings set is_trial = true where id = p_meeting_id;
  end if;

  update public.meetings
    set launched_by = auth.uid(), launched_at = now()
    where id = p_meeting_id;
  return case when v_subscribed then 'launched' else 'launched_trial' end;
end;
$$;

create or replace function public.call_meeting_to_order(p_meeting_id uuid, p_attendance jsonb, p_attendees jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or v_meeting.launched_by is distinct from auth.uid()
     or not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_meeting.status <> 'DRAFT' then
    raise exception 'This meeting has already been called to order.';
  end if;
  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings
    set status = 'LIVE', actual_start_at = now(),
        attendance = coalesce(p_attendance, attendance),
        attendees = coalesce(p_attendees, attendees)
    where id = p_meeting_id;
end;
$$;

revoke all on function public.launch_meeting(uuid) from public;
revoke all on function public.call_meeting_to_order(uuid, jsonb, jsonb) from public;
revoke all on function public.can_run_meetings(text) from public;
revoke all on function public.can_see_meeting_notes(uuid) from public;
grant execute on function public.launch_meeting(uuid) to authenticated;
grant execute on function public.call_meeting_to_order(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.can_run_meetings(text) to authenticated;
grant execute on function public.can_see_meeting_notes(uuid) to authenticated;
grant execute on function public.corporation_member_directory(text) to authenticated;
