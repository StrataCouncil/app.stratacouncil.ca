-- Two changes (2026-10-20). Safe to run more than once. Run the whole
-- file in one go.
--
-- 1. Library: a "Form" category. Forms are fill-in documents a subscriber
--    downloads as Word, filled in with the strata's name and plan number,
--    like policy templates, and behind the subscription the same way (that
--    rule lives in the app, lib/library/catalogue.ts).
--
-- 2. Minutes live in the Meetings & Records folder now (the Minutes tab is
--    gone). Finalized minutes, and historic minutes uploaded from before
--    the strata used the platform, stay in that folder: they can't be
--    moved to another one.

alter table public.library_resources drop constraint if exists library_resources_kind_check;
alter table public.library_resources add constraint library_resources_kind_check
  check (kind in ('playbook', 'emergency_playbook', 'policy_template', 'form', 'operational_guide', 'financial_insight', 'legislation_update'));

create or replace function public.move_document(p_document_id uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corp text;
  v_source text;
begin
  if p_category not in (
    'building_construction', 'contracts_service_agreements', 'correspondence',
    'financial_accounting', 'insurance', 'legal_governance', 'meetings_records', 'operations'
  ) then
    raise exception 'invalid folder' using errcode = '22023';
  end if;

  select corporation_id, source_type into v_corp, v_source from public.documents where id = p_document_id;
  if v_corp is null or not public.is_corporation_member(v_corp) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_source in ('minutes', 'historic_minutes') then
    raise exception 'minutes stay in Meetings & Records' using errcode = '22023';
  end if;

  update public.documents set category = p_category where id = p_document_id;
end;
$$;

revoke all on function public.move_document(uuid, text) from public;
grant execute on function public.move_document(uuid, text) to authenticated;
