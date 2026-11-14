-- 0096: editing a strata's details, its fiscal year, and recall cases that
-- check the answer (2026-11-14).
--
-- 1. Fiscal year. strata_corporations.fiscal_year_start_month (1-12), blank
--    until someone sets it. Stratasphere reads it to work out "this fiscal
--    year", prorating, and the like, and asks for it when it's blank.
--
-- 2. Editing the strata's details (the Overview's "Strata details" card).
--    update_strata_details(corporation, changes) takes only the fields being
--    changed, as JSON:
--      Admin of the strata, or Super Admin: building_name (blank clears it),
--        address, fiscal_year_start_month (null clears it).
--      Super Admin only: legal_name, jurisdiction, unit_count.
--    Anything else is refused. The plan number isn't editable: it is the key
--    every record of the strata hangs on.
--    Every change is logged in strata_detail_changes (who, when, the field,
--    and the old and new values). The strata's Admins and Super Admins can
--    read the log; nobody writes to it directly.
--
-- 3. Recall cases that check the answer (Super Admin console). A case can
--    now hold the expected answer, the key figures the answer must state
--    (checked automatically), and the Knowledge Base entries or sections
--    that should be found. Each answering run can be marked Right, Partly,
--    or Wrong, with a note.
--
-- Grants:
--   strata_corporations.fiscal_year_start_month: select to authenticated
--     (the table's existing member policy decides which rows); no direct
--     update by anyone but the service role.
--   strata_detail_changes: select to authenticated through its policy;
--     no insert, update, or delete for anon or authenticated.
--   update_strata_details: execute to authenticated only.
--   Recall columns: the recall tables stay service-role only (0089).
--
-- Safe to re-run.

-- 1. Fiscal year ------------------------------------------------------------

alter table public.strata_corporations
  add column if not exists fiscal_year_start_month smallint;
alter table public.strata_corporations drop constraint if exists strata_corporations_fiscal_year_start_month_check;
alter table public.strata_corporations add constraint strata_corporations_fiscal_year_start_month_check
  check (fiscal_year_start_month is null or fiscal_year_start_month between 1 and 12);
grant select (fiscal_year_start_month) on public.strata_corporations to authenticated;

-- 2. Change log and the edit function ---------------------------------------

create table if not exists public.strata_detail_changes (
  id uuid primary key default gen_random_uuid(),
  corporation_id text not null references public.strata_corporations(strata_plan_number) on delete cascade,
  field text not null check (field in ('building_name', 'address', 'fiscal_year_start_month', 'legal_name', 'jurisdiction', 'unit_count')),
  old_value text,
  new_value text,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists strata_detail_changes_corp_idx on public.strata_detail_changes (corporation_id, changed_at desc);

alter table public.strata_detail_changes enable row level security;
revoke all on public.strata_detail_changes from anon, authenticated;
grant select on public.strata_detail_changes to authenticated;
grant all on public.strata_detail_changes to service_role;
drop policy if exists "admins read their strata's changes" on public.strata_detail_changes;
create policy "admins read their strata's changes" on public.strata_detail_changes
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.corporation_role_assignments r
      join public.corporation_memberships m on m.corporation_id = r.corporation_id and m.user_id = r.user_id and m.status = 'active'
      where r.corporation_id = strata_detail_changes.corporation_id and r.user_id = auth.uid() and r.role = 'admin'
    )
  );

create or replace function public.update_strata_details(p_corporation_id text, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super boolean := public.is_super_admin();
  v_admin boolean;
  v_corp public.strata_corporations%rowtype;
  v_key text;
  v_text text;
  v_int int;
begin
  if auth.uid() is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_admin := v_super or exists (
    select 1 from public.corporation_role_assignments r
    join public.corporation_memberships m on m.corporation_id = r.corporation_id and m.user_id = r.user_id and m.status = 'active'
    where r.corporation_id = p_corporation_id and r.user_id = auth.uid() and r.role = 'admin'
  );
  if not v_admin then
    raise exception 'Only the strata''s Admin can change its details.' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Nothing to change.' using errcode = '22023';
  end if;

  select * into v_corp from public.strata_corporations where strata_plan_number = p_corporation_id for update;
  if not found then
    raise exception 'That strata isn''t on StrataCouncil.ca.' using errcode = 'P0002';
  end if;

  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key in ('legal_name', 'jurisdiction', 'unit_count') and not v_super then
      raise exception 'Only a Super Admin can change the %.', replace(v_key, '_', ' ') using errcode = '42501';
    end if;

    if v_key = 'building_name' then
      v_text := nullif(btrim(coalesce(p_changes ->> v_key, '')), '');
      if v_text is not null and char_length(v_text) > 120 then
        raise exception 'The building name can be up to 120 characters.' using errcode = '22023';
      end if;
      if v_text is distinct from v_corp.building_name then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.building_name, v_text, auth.uid());
        update public.strata_corporations set building_name = v_text where strata_plan_number = p_corporation_id;
      end if;

    elsif v_key = 'address' then
      v_text := btrim(coalesce(p_changes ->> v_key, ''));
      if char_length(v_text) not between 1 and 300 then
        raise exception 'Enter the address (up to 300 characters).' using errcode = '22023';
      end if;
      if v_text is distinct from v_corp.address then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.address, v_text, auth.uid());
        update public.strata_corporations set address = v_text where strata_plan_number = p_corporation_id;
      end if;

    elsif v_key = 'fiscal_year_start_month' then
      if jsonb_typeof(p_changes -> v_key) = 'null' then
        v_int := null;
      elsif jsonb_typeof(p_changes -> v_key) = 'number' and (p_changes ->> v_key) ~ '^\d{1,2}$' then
        v_int := (p_changes ->> v_key)::int;
        if v_int not between 1 and 12 then
          raise exception 'Choose the month the fiscal year starts.' using errcode = '22023';
        end if;
      else
        raise exception 'Choose the month the fiscal year starts.' using errcode = '22023';
      end if;
      if v_int is distinct from v_corp.fiscal_year_start_month then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.fiscal_year_start_month::text, v_int::text, auth.uid());
        update public.strata_corporations set fiscal_year_start_month = v_int where strata_plan_number = p_corporation_id;
      end if;

    elsif v_key = 'legal_name' then
      v_text := btrim(coalesce(p_changes ->> v_key, ''));
      if char_length(v_text) not between 1 and 200 then
        raise exception 'Enter the legal name (up to 200 characters).' using errcode = '22023';
      end if;
      if v_text is distinct from v_corp.legal_name then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.legal_name, v_text, auth.uid());
        update public.strata_corporations set legal_name = v_text where strata_plan_number = p_corporation_id;
      end if;

    elsif v_key = 'jurisdiction' then
      v_text := upper(btrim(coalesce(p_changes ->> v_key, '')));
      if v_text not in ('BC', 'AB', 'SK', 'MB', 'ON', 'QC', 'NB', 'NS', 'PE', 'NL', 'YT', 'NT', 'NU') then
        raise exception 'Choose a jurisdiction.' using errcode = '22023';
      end if;
      if v_text is distinct from v_corp.jurisdiction then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.jurisdiction, v_text, auth.uid());
        update public.strata_corporations set jurisdiction = v_text where strata_plan_number = p_corporation_id;
      end if;

    elsif v_key = 'unit_count' then
      if jsonb_typeof(p_changes -> v_key) <> 'number' or (p_changes ->> v_key) !~ '^\d{1,5}$' then
        raise exception 'Enter the number of strata lots.' using errcode = '22023';
      end if;
      v_int := (p_changes ->> v_key)::int;
      if v_int not between 1 and 10000 then
        raise exception 'Enter the number of strata lots.' using errcode = '22023';
      end if;
      if v_int is distinct from v_corp.unit_count then
        insert into public.strata_detail_changes (corporation_id, field, old_value, new_value, changed_by)
        values (p_corporation_id, v_key, v_corp.unit_count::text, v_int::text, auth.uid());
        update public.strata_corporations set unit_count = v_int where strata_plan_number = p_corporation_id;
      end if;

    else
      raise exception 'That detail can''t be changed here.' using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function public.update_strata_details(text, jsonb) from public, anon;
grant execute on function public.update_strata_details(text, jsonb) to authenticated;

-- 3. Recall cases that check the answer -------------------------------------

alter table public.stratasphere_recall_cases add column if not exists expected_answer text not null default '';
alter table public.stratasphere_recall_cases add column if not exists key_figures text[] not null default '{}';
alter table public.stratasphere_recall_cases add column if not exists expect_legislation_documents uuid[] not null default '{}';
alter table public.stratasphere_recall_cases add column if not exists expect_legislation_sections uuid[] not null default '{}';
alter table public.stratasphere_recall_cases drop constraint if exists stratasphere_recall_cases_expected_answer_check;
alter table public.stratasphere_recall_cases add constraint stratasphere_recall_cases_expected_answer_check
  check (char_length(expected_answer) <= 8000);
alter table public.stratasphere_recall_cases drop constraint if exists stratasphere_recall_cases_key_figures_check;
alter table public.stratasphere_recall_cases add constraint stratasphere_recall_cases_key_figures_check
  check (cardinality(key_figures) <= 100);

alter table public.stratasphere_recall_runs add column if not exists verdict text;
alter table public.stratasphere_recall_runs add column if not exists verdict_note text not null default '';
alter table public.stratasphere_recall_runs add column if not exists verdict_by uuid references public.profiles(id) on delete set null;
alter table public.stratasphere_recall_runs add column if not exists verdict_at timestamptz;
alter table public.stratasphere_recall_runs drop constraint if exists stratasphere_recall_runs_verdict_check;
alter table public.stratasphere_recall_runs add constraint stratasphere_recall_runs_verdict_check
  check ((verdict is null or verdict in ('right', 'partly', 'wrong')) and char_length(verdict_note) <= 4000);
