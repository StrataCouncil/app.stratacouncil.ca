-- 0076: two Meeting Mode additions.
-- 1. Show to everyone: the person running a meeting puts one of the current
--    agenda's attachments on every member's screen (meetings.presenting).
--    What's shown is read from the saved agenda, never taken from the caller.
-- 2. All in favour: during an open vote, the runner sets For for everyone
--    who hasn't voted and for the votes they entered (their own included).
--    Not while anyone has voted Against themselves; a member's own ballot is
--    never changed.
-- Safe to re-run.

alter table public.meetings add column if not exists presenting jsonb;
grant select (presenting) on public.meetings to authenticated;

-- Runners can update their meeting's row (the agenda autosaves), so the
-- column is guarded: it only changes through set_meeting_presenting.
create or replace function public.meetings_presenting_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.presenting is distinct from old.presenting and coalesce(current_setting('app.meeting_presenting', true), '') <> 'on' then
    raise exception 'What''s shown to everyone changes only through Show to everyone.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists meetings_presenting_guard on public.meetings;
create trigger meetings_presenting_guard before update of presenting on public.meetings
  for each row execute function public.meetings_presenting_guard();

create or replace function public.set_meeting_presenting(p_meeting_id uuid, p_item_id text, p_att_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_att jsonb;
  v_show jsonb;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or not public.runs_meeting(p_meeting_id) then
    raise exception 'Only the person running this meeting can show something to everyone.' using errcode = '42501';
  end if;
  perform set_config('app.meeting_presenting', 'on', true);
  if p_item_id is null or p_att_id is null then
    update public.meetings set presenting = null where id = p_meeting_id;
    perform set_config('app.meeting_presenting', '', true);
    return null;
  end if;
  select a into v_att
  from jsonb_array_elements(coalesce(v_meeting.agenda, '[]'::jsonb)) i,
       jsonb_array_elements(coalesce(i -> 'atts', '[]'::jsonb)) a
  where i ->> 'id' = p_item_id and a ->> 'id' = p_att_id
  limit 1;
  if v_att is null then
    raise exception 'That attachment isn''t on the saved agenda yet. Try again in a moment.';
  end if;
  v_show := jsonb_build_object(
    'itemId', p_item_id,
    'attId', p_att_id,
    'title', left(coalesce(v_att ->> 'title', ''), 300),
    'documentId', v_att ->> 'documentId',
    'url', case when v_att ->> 'kind' = 'link' and (v_att ->> 'url') ~* '^https?://' then left(v_att ->> 'url', 2000) end,
    'at', now()
  );
  update public.meetings set presenting = v_show where id = p_meeting_id;
  perform set_config('app.meeting_presenting', '', true);
  return v_show;
end;
$$;

create or replace function public.record_all_in_favour(p_vote_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vote public.meeting_votes;
  v_corp text;
  v_mine text;
  v_lot text;
  v_n int := 0;
begin
  select * into v_vote from public.meeting_votes where id = p_vote_id for update;
  if v_vote.id is null or v_vote.status <> 'open' then
    raise exception 'This vote is closed.';
  end if;
  if not public.runs_meeting(v_vote.meeting_id) then
    raise exception 'Only the person running this meeting can enter votes for others.' using errcode = '42501';
  end if;
  select corporation_id into v_corp from public.meetings where id = v_vote.meeting_id;
  v_mine := case when public.is_on_council(v_corp) then public.my_strata_lot(v_corp) end;
  if exists (
    select 1 from public.meeting_ballots b
    where b.vote_id = p_vote_id and b.choice = 'against' and not b.cast_for_other and b.lot_number is distinct from v_mine
  ) then
    raise exception 'That member voted Against themselves, so this can''t be recorded as all in favour.';
  end if;
  foreach v_lot in array v_vote.eligible_lots loop
    -- Members' own ballots stand; everything else becomes For.
    if not exists (
      select 1 from public.meeting_ballots b
      where b.vote_id = p_vote_id and b.lot_number = v_lot and not b.cast_for_other and v_lot is distinct from v_mine
    ) then
      perform public.record_meeting_vote(p_vote_id, v_lot, 'for');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.set_meeting_presenting(uuid, text, text)', 'public.record_all_in_favour(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
