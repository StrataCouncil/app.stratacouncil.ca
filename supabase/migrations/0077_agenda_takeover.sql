-- 0077: taking over the agenda. Someone who can run meetings can ask to
-- take the agenda from whoever is editing it: the editor's screen saves
-- their changes and hands it over. If that screen has gone (closed, offline),
-- the request goes through after a minute. Editors now renew their hold
-- often, so an abandoned one is free after 2 minutes rather than 15.
-- Safe to re-run.

alter table public.meetings add column if not exists agenda_takeover_by uuid references public.profiles(id) on delete set null;
alter table public.meetings add column if not exists agenda_takeover_at timestamptz;
grant select (agenda_takeover_by, agenda_takeover_at) on public.meetings to authenticated;

-- Takes (or keeps) the agenda. Returns who has it, and whether someone has
-- asked to take it over (so the editor's screen saves and hands over).
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

  -- The editor renewing: still theirs, but say if someone has asked for it.
  if v_meeting.agenda_editor = auth.uid() then
    update public.meetings set agenda_editor_at = now() where id = p_meeting_id;
    if v_meeting.agenda_takeover_by is not null and v_meeting.agenda_takeover_by <> auth.uid() then
      select full_name into v_name from public.profiles where id = v_meeting.agenda_takeover_by;
      return jsonb_build_object('mine', true, 'since', now(), 'takeover', coalesce(v_name, 'Someone'));
    end if;
    return jsonb_build_object('mine', true, 'since', now());
  end if;

  -- Free, abandoned (no renewal for 2 minutes), or a takeover this caller
  -- asked for that the editor's screen hasn't answered within a minute.
  if v_meeting.agenda_editor is null
     or v_meeting.agenda_editor_at < now() - interval '2 minutes'
     or (v_meeting.agenda_takeover_by = auth.uid() and v_meeting.agenda_takeover_at < now() - interval '1 minute') then
    update public.meetings
      set agenda_editor = auth.uid(), agenda_editor_at = now(), agenda_takeover_by = null, agenda_takeover_at = null
      where id = p_meeting_id;
    return jsonb_build_object('mine', true, 'since', now());
  end if;

  select full_name into v_name from public.profiles where id = v_meeting.agenda_editor;
  return jsonb_build_object(
    'mine', false,
    'editor', coalesce(v_name, 'Someone'),
    'since', v_meeting.agenda_editor_at,
    'requested', v_meeting.agenda_takeover_by = auth.uid()
  );
end;
$$;

-- Asks to take the agenda from whoever is editing it.
create or replace function public.request_agenda_takeover(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'Only someone who can run meetings can edit the agenda.' using errcode = '42501';
  end if;
  if v_meeting.status <> 'DRAFT' or v_meeting.launched_by is not null then
    raise exception 'This meeting has been launched, so its agenda can''t be changed here any more.';
  end if;
  if v_meeting.agenda_editor is null or v_meeting.agenda_editor = auth.uid() then
    return;
  end if;
  update public.meetings set agenda_takeover_by = auth.uid(), agenda_takeover_at = now() where id = p_meeting_id;
end;
$$;

-- Done editing. A takeover asked for stays, so whoever asked gets it next.
create or replace function public.release_agenda(p_meeting_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.meetings set agenda_editor = null, agenda_editor_at = null
  where id = p_meeting_id and agenda_editor = auth.uid();
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.claim_agenda(uuid)', 'public.request_agenda_takeover(uuid)', 'public.release_agenda(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
