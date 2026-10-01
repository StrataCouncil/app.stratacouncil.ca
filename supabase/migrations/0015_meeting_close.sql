-- doc01 §4/§4b, doc02 §4b — the end of a meeting, and the trial's AI cap.
--
-- adjourn_meeting: the launcher closes the meeting with its final agenda
-- (unresolved items already deferred by the app — nothing is left
-- silently undecided) and the draft minutes. Carried motions are written
-- to the decision ledger here, once, from the final agenda. Allowed from
-- a launched DRAFT too: a meeting that never reaches quorum is adjourned
-- without being called to order.
--
-- finalize_minutes: irreversible. Minutes become FINAL and the meeting's
-- private notes are deleted for good. Once a meeting is adjourned, its
-- draft minutes can be edited and finalized by anyone who can run
-- meetings — not only whoever ran it, who may since have left council.
--
-- consume_stratasphere_request: every assistant call goes through this.
-- Subscribed: always allowed. Free trial meeting: 10 calls, counted on the
-- corporation (doc01 §4b). Otherwise refused.

drop policy "meeting runners edit; a launched meeting only by its launcher" on public.meetings;
create policy "meeting runners edit; a running meeting only by its launcher" on public.meetings
  for update
  using (
    public.can_run_meetings(corporation_id)
    and minutes_state is distinct from 'FINAL'
    and (launched_by is null or launched_by = auth.uid() or status = 'ADJOURNED')
  )
  with check (public.can_run_meetings(corporation_id));

create or replace function public.consume_stratasphere_request(p_corporation_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used int;
begin
  if not public.is_corporation_member(p_corporation_id) then
    return false;
  end if;
  if exists (select 1 from public.subscriptions where corporation_id = p_corporation_id and status = 'active') then
    return true;
  end if;
  if not exists (
    select 1 from public.meetings
    where corporation_id = p_corporation_id and is_trial and minutes_state is distinct from 'FINAL'
  ) then
    return false;
  end if;
  update public.strata_corporations
    set free_meeting_ai_requests_used = free_meeting_ai_requests_used + 1
    where strata_plan_number = p_corporation_id and free_meeting_ai_requests_used < 10
    returning free_meeting_ai_requests_used into v_used;
  return v_used is not null;
end;
$$;

create or replace function public.adjourn_meeting(p_meeting_id uuid, p_agenda jsonb, p_minutes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meeting public.meetings;
  v_item jsonb;
begin
  select * into v_meeting from public.meetings where id = p_meeting_id for update;
  if v_meeting.id is null or v_meeting.launched_by is distinct from auth.uid()
     or not public.can_run_meetings(v_meeting.corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_meeting.status = 'ADJOURNED' then
    raise exception 'This meeting has already been adjourned.';
  end if;
  if jsonb_typeof(p_agenda) <> 'array' then
    raise exception 'agenda must be an array';
  end if;
  -- Nothing undecided: every item is done or explicitly deferred.
  if exists (
    select 1 from jsonb_array_elements(p_agenda) i
    where not coalesce((i->>'done')::boolean, false) and not coalesce((i->>'deferred')::boolean, false)
  ) then
    raise exception 'Every agenda item must be decided or deferred before adjourning.';
  end if;

  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings
    set status = 'ADJOURNED', adjourned_at = now(), agenda = p_agenda,
        minutes_state = 'DRAFT', minutes_content = p_minutes
    where id = p_meeting_id;

  for v_item in select * from jsonb_array_elements(p_agenda) loop
    if v_item->'motion'->>'outcome' = 'CARRIED' and lower(coalesce(v_item->>'text', '')) not like '%adjourn%' then
      insert into public.decisions (
        corporation_id, meeting_id, meeting_type, agenda_item_id, title, description, category,
        motion_text, mover, seconder, decision_type, votes_for, votes_against, votes_abstain, decided_at
      ) values (
        v_meeting.corporation_id, p_meeting_id, v_meeting.type, v_item->>'id',
        left(v_item->>'text', 300), nullif(v_item->>'background', ''), v_item->>'cat',
        v_item->'motion'->>'text', v_item->'motion'->>'mover', v_item->'motion'->>'sec',
        v_item->'motion'->>'dt',
        coalesce((v_item->'motion'->>'for')::int, 0),
        coalesce((v_item->'motion'->>'against')::int, 0),
        coalesce((v_item->'motion'->>'abstain')::int, 0),
        now()
      );
    end if;
  end loop;
end;
$$;

create or replace function public.finalize_minutes(p_meeting_id uuid, p_minutes jsonb)
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
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_meeting.status <> 'ADJOURNED' then
    raise exception 'Adjourn the meeting before finalizing its minutes.';
  end if;
  if v_meeting.minutes_state = 'FINAL' then
    raise exception 'These minutes are already final.';
  end if;

  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings
    set minutes_state = 'FINAL',
        minutes_content = coalesce(p_minutes, minutes_content),
        minutes_finalized_at = now(),
        minutes_finalized_by = auth.uid()
    where id = p_meeting_id;

  -- Private notes are gone for good once the record is final.
  delete from public.meeting_item_notes where meeting_id = p_meeting_id;
end;
$$;

-- Historic minutes: decisions extracted from uploaded past minutes, after
-- the uploader has reviewed them. Same ledger, marked by source.
create or replace function public.record_historic_decisions(p_corporation_id text, p_document_id uuid, p_decisions jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_d jsonb;
begin
  if not public.can_run_meetings(p_corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.documents
    where id = p_document_id and corporation_id = p_corporation_id and source_type = 'historic_minutes'
  ) then
    raise exception 'unknown minutes document';
  end if;
  -- Re-recording a document replaces what it contributed.
  delete from public.decisions where source_document_id = p_document_id and source = 'historic_minutes';
  for v_d in select * from jsonb_array_elements(p_decisions) loop
    insert into public.decisions (
      corporation_id, meeting_type, title, motion_text, mover, seconder, decision_type,
      votes_for, votes_against, votes_abstain, decided_at, source, source_document_id
    ) values (
      p_corporation_id, nullif(v_d->>'meeting_type', ''), left(v_d->>'title', 300), v_d->>'motion_text',
      nullif(v_d->>'mover', ''), nullif(v_d->>'seconder', ''), nullif(v_d->>'decision_type', ''),
      nullif(v_d->>'votes_for', '')::int, nullif(v_d->>'votes_against', '')::int, nullif(v_d->>'votes_abstain', '')::int,
      coalesce(nullif(v_d->>'decided_on', '')::date, now()::date), 'historic_minutes', p_document_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.consume_stratasphere_request(text) from public;
revoke all on function public.adjourn_meeting(uuid, jsonb, jsonb) from public;
revoke all on function public.finalize_minutes(uuid, jsonb) from public;
revoke all on function public.record_historic_decisions(text, uuid, jsonb) from public;
grant execute on function public.consume_stratasphere_request(text) to authenticated;
grant execute on function public.adjourn_meeting(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.finalize_minutes(uuid, jsonb) to authenticated;
grant execute on function public.record_historic_decisions(text, uuid, jsonb) to authenticated;
