-- 0097: Directives (2026-11-17).
--
-- A directive is something council has decided should be done: get three
-- roofing quotes, send the bylaw warning letter, book the dryer-vent
-- cleaning. The list lives in the Discussions tab, beside Discussions. It is
-- not part of the agenda, Meeting Mode, or the minutes.
--
-- Where they come from (source):
--   'meeting'     A motion carried at a meeting. When the meeting adjourns,
--                 the server turns each carried motion that calls for
--                 follow-up into one or more directives (with Stratasphere
--                 on a subscription; the motion's own words otherwise).
--   'discussion'  A Discussion that closed with council in favour. If a
--                 later meeting doesn't ratify it, its open directives are
--                 cancelled.
--   'manual'      Added by hand by someone who runs meetings.
-- The automatic ones are written by the service role, each with a
-- source_key (for example 'decision:<id>:1'), unique per strata, so running
-- the generation twice can't make duplicates.
--
-- Who:
--   Sees all of the strata's directives: council (is_on_council), anyone
--     who runs meetings (can_run_meetings), and the strata's managers (an
--     active member holding the manager role). Never owners.
--   Adds, edits, closes as done, cancels, reopens: anyone who runs meetings.
--   Closes as done: managers too.
-- Assigned to: nobody yet, "the manager" (the strata's manager, whether or
-- not they use the app), or one person who can see directives.
--
-- Every change is logged in directive_changes (who, when, what), readable by
-- the same people as the directives. Names are kept beside each change, so
-- the record survives an account being deleted.
--
-- Grants:
--   directives, directive_changes: select to authenticated (RLS decides
--     which rows); no insert, update, or delete for anon or authenticated,
--     who write only through the functions below. All to service_role.
--   sees_directives, is_strata_manager, create_directive, update_directive,
--     set_directive_status: execute to authenticated and service_role only.
--
-- Safe to re-run. Run the whole file in one go.

-- ── Who ────────────────────────────────────────────────────────────────
create or replace function public.is_strata_manager(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.corporation_memberships m
    join public.corporation_role_assignments r
      on r.corporation_id = m.corporation_id and r.user_id = m.user_id
    where m.corporation_id = target_corporation_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and r.role = 'manager'
  );
$$;
revoke all on function public.is_strata_manager(text) from public, anon;
grant execute on function public.is_strata_manager(text) to authenticated, service_role;

create or replace function public.sees_directives(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_on_council(target_corporation_id)
      or public.can_run_meetings(target_corporation_id)
      or public.is_strata_manager(target_corporation_id);
$$;
revoke all on function public.sees_directives(text) from public, anon;
grant execute on function public.sees_directives(text) to authenticated, service_role;

-- ── Tables ─────────────────────────────────────────────────────────────
create table if not exists public.directives (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  detail text not null default '' check (char_length(detail) <= 4000),
  source text not null default 'manual' check (source in ('meeting', 'discussion', 'manual')),
  source_key text check (source_key is null or char_length(source_key) <= 200),
  decision_id uuid references public.decisions(id) on delete set null,
  meeting_id uuid references public.meetings(id) on delete set null,
  discussion_id uuid references public.discussions(id) on delete set null,
  -- The motion it came from, as carried, so the link survives edits.
  source_text text not null default '' check (char_length(source_text) <= 4000),
  -- How the wording was written: by Stratasphere, the motion's own words, or a person.
  drafted_by text not null default 'person' check (drafted_by in ('ai', 'motion', 'person')),
  assignee_kind text not null default 'none' check (assignee_kind in ('none', 'manager', 'person')),
  assignee_user_id uuid references public.profiles(id) on delete set null,
  assignee_name text not null default '' check (char_length(assignee_name) <= 200),
  due_date date,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_by_name text not null default '',
  close_note text not null default '' check (char_length(close_note) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint directives_closed check ((status = 'open') = (closed_at is null)),
  constraint directives_person check (assignee_kind <> 'person' or char_length(btrim(assignee_name)) > 0)
);
create index if not exists directives_corporation_idx on public.directives (corporation_id, status, due_date);
create unique index if not exists directives_source_key_idx on public.directives (corporation_id, source_key) where source_key is not null;
create index if not exists directives_decision_idx on public.directives (decision_id);
create index if not exists directives_discussion_idx on public.directives (discussion_id);

create table if not exists public.directive_changes (
  id bigserial primary key,
  directive_id uuid not null references public.directives(id) on delete cascade,
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade on update cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_by_name text not null default '',
  kind text not null check (kind in ('created', 'edited', 'done', 'cancelled', 'reopened')),
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists directive_changes_idx on public.directive_changes (directive_id, at);

alter table public.directives enable row level security;
alter table public.directive_changes enable row level security;

revoke all on public.directives, public.directive_changes from anon, authenticated;
grant select on public.directives, public.directive_changes to authenticated;
grant all on public.directives, public.directive_changes to service_role;
grant usage, select on sequence public.directive_changes_id_seq to service_role;

drop policy if exists "directive readers" on public.directives;
create policy "directive readers" on public.directives
  for select to authenticated using (public.sees_directives(corporation_id));

drop policy if exists "directive change readers" on public.directive_changes;
create policy "directive change readers" on public.directive_changes
  for select to authenticated using (public.sees_directives(corporation_id));

-- ── Assignees ──────────────────────────────────────────────────────────
-- 'person' must be someone who can see this strata's directives: an active
-- member on council, running meetings, or managing. Returns their name.
create or replace function public.directive_assignee_name(p_corporation_id text, p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(btrim(p.full_name), ''), 'A member')
  from public.corporation_memberships m
  join public.profiles p on p.id = m.user_id
  where m.corporation_id = p_corporation_id and m.user_id = p_user_id and m.status = 'active'
    and (
      m.can_run_meetings
      or exists (
        select 1 from public.corporation_role_assignments r
        where r.corporation_id = m.corporation_id and r.user_id = m.user_id
          and r.role in ('admin', 'president', 'vice_president', 'treasurer', 'secretary', 'member_at_large', 'manager')
      )
    );
$$;
revoke all on function public.directive_assignee_name(text, uuid) from public, anon, authenticated;
grant execute on function public.directive_assignee_name(text, uuid) to service_role;

-- ── Adding, editing, closing ───────────────────────────────────────────
create or replace function public.create_directive(
  p_corporation_id text, p_title text, p_detail text, p_assignee_kind text, p_assignee_user_id uuid, p_due_date date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_kind text := coalesce(p_assignee_kind, 'none');
  v_name text := '';
  v_me text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
begin
  if not public.can_run_meetings(p_corporation_id) then
    raise exception 'Only those who run meetings can add a directive.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Say what needs to be done.';
  end if;
  if v_kind not in ('none', 'manager', 'person') then
    raise exception 'Choose who it''s assigned to.';
  end if;
  if v_kind = 'person' then
    v_name := public.directive_assignee_name(p_corporation_id, p_assignee_user_id);
    if v_name is null then
      raise exception 'That person can''t be assigned directives here.';
    end if;
  end if;
  insert into public.directives (
    corporation_id, title, detail, source, drafted_by, assignee_kind, assignee_user_id, assignee_name, due_date, created_by, created_by_name
  ) values (
    p_corporation_id, btrim(p_title), coalesce(btrim(p_detail), ''), 'manual', 'person', v_kind,
    case when v_kind = 'person' then p_assignee_user_id end, v_name, p_due_date, auth.uid(), v_me
  ) returning id into v_id;
  insert into public.directive_changes (directive_id, corporation_id, changed_by, changed_by_name, kind)
  values (v_id, p_corporation_id, auth.uid(), v_me, 'created');
  return v_id;
end;
$$;
revoke all on function public.create_directive(text, text, text, text, uuid, date) from public, anon;
grant execute on function public.create_directive(text, text, text, text, uuid, date) to authenticated, service_role;

create or replace function public.update_directive(
  p_directive_id uuid, p_title text, p_detail text, p_assignee_kind text, p_assignee_user_id uuid, p_due_date date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.directives;
  v_kind text := coalesce(p_assignee_kind, 'none');
  v_name text := '';
  v_me text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
  v_changed jsonb := '{}'::jsonb;
begin
  select * into d from public.directives where id = p_directive_id for update;
  if d.id is null or not public.can_run_meetings(d.corporation_id) then
    raise exception 'Only those who run meetings can change a directive.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'Say what needs to be done.';
  end if;
  if v_kind not in ('none', 'manager', 'person') then
    raise exception 'Choose who it''s assigned to.';
  end if;
  if v_kind = 'person' then
    if p_assignee_user_id is not distinct from d.assignee_user_id and d.assignee_kind = 'person' then
      v_name := d.assignee_name;
    else
      v_name := public.directive_assignee_name(d.corporation_id, p_assignee_user_id);
      if v_name is null then
        raise exception 'That person can''t be assigned directives here.';
      end if;
    end if;
  end if;
  if btrim(p_title) is distinct from d.title then v_changed := v_changed || jsonb_build_object('title', jsonb_build_array(d.title, btrim(p_title))); end if;
  if coalesce(btrim(p_detail), '') is distinct from d.detail then v_changed := v_changed || jsonb_build_object('detail', true); end if;
  if v_kind is distinct from d.assignee_kind or (v_kind = 'person' and p_assignee_user_id is distinct from d.assignee_user_id) then
    v_changed := v_changed || jsonb_build_object('assignee', jsonb_build_array(
      case d.assignee_kind when 'manager' then 'the manager' when 'person' then d.assignee_name else 'nobody' end,
      case v_kind when 'manager' then 'the manager' when 'person' then v_name else 'nobody' end));
  end if;
  if p_due_date is distinct from d.due_date then v_changed := v_changed || jsonb_build_object('due_date', jsonb_build_array(d.due_date, p_due_date)); end if;
  if v_changed = '{}'::jsonb then
    return;
  end if;
  update public.directives
    set title = btrim(p_title), detail = coalesce(btrim(p_detail), ''), assignee_kind = v_kind,
        assignee_user_id = case when v_kind = 'person' then p_assignee_user_id end, assignee_name = v_name,
        due_date = p_due_date, updated_at = now()
    where id = p_directive_id;
  insert into public.directive_changes (directive_id, corporation_id, changed_by, changed_by_name, kind, detail)
  values (d.id, d.corporation_id, auth.uid(), v_me, 'edited', v_changed);
end;
$$;
revoke all on function public.update_directive(uuid, text, text, text, uuid, date) from public, anon;
grant execute on function public.update_directive(uuid, text, text, text, uuid, date) to authenticated, service_role;

-- 'done' (those who run meetings, or a manager), 'cancelled' and 'open'
-- (reopen; those who run meetings).
create or replace function public.set_directive_status(p_directive_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.directives;
  v_me text := coalesce((select full_name from public.profiles where id = auth.uid()), '');
  v_runner boolean;
begin
  select * into d from public.directives where id = p_directive_id for update;
  if d.id is null or not public.sees_directives(d.corporation_id) then
    raise exception 'That directive isn''t available.';
  end if;
  v_runner := public.can_run_meetings(d.corporation_id);
  if p_status not in ('open', 'done', 'cancelled') then
    raise exception 'Choose done, cancelled, or open.';
  end if;
  if not (v_runner or (p_status = 'done' and public.is_strata_manager(d.corporation_id))) then
    raise exception 'Only those who run meetings can do that. The manager can mark a directive done.';
  end if;
  if p_status = d.status then
    return;
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'Keep the note under 2,000 characters.';
  end if;
  if p_status = 'open' then
    update public.directives
      set status = 'open', closed_at = null, closed_by = null, closed_by_name = '', close_note = '', updated_at = now()
      where id = d.id;
  else
    update public.directives
      set status = p_status, closed_at = now(), closed_by = auth.uid(), closed_by_name = v_me,
          close_note = coalesce(btrim(p_note), ''), updated_at = now()
      where id = d.id;
  end if;
  insert into public.directive_changes (directive_id, corporation_id, changed_by, changed_by_name, kind, detail)
  values (
    d.id, d.corporation_id, auth.uid(), v_me,
    case p_status when 'open' then 'reopened' else p_status end,
    case when coalesce(btrim(p_note), '') <> '' then jsonb_build_object('note', btrim(p_note)) else '{}'::jsonb end
  );
end;
$$;
revoke all on function public.set_directive_status(uuid, text, text) from public, anon;
grant execute on function public.set_directive_status(uuid, text, text) to authenticated, service_role;
