-- Editing a strata's details (0096): Admins change the building name,
-- address, and fiscal year; only Super Admins change the legal name,
-- jurisdiction, and number of lots; nobody changes the plan number; every
-- change is logged; nobody writes to the table or the log directly.
\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
create function pg_temp.refused(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.refused(text) to authenticated;

select pg_temp.expect('the fiscal year starts blank', (select bool_and(fiscal_year_start_month is null) from strata_corporations));

-- Bob, the strata's Admin.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select update_strata_details('BCS-1234', '{"building_name":"  The Larches ","address":"12 Elm Street, Vancouver, BC","fiscal_year_start_month":2}');
reset role;
select pg_temp.expect('an Admin changes the building name, address, and fiscal year',
  (select building_name = 'The Larches' and address = '12 Elm Street, Vancouver, BC' and fiscal_year_start_month = 2
   from strata_corporations where strata_plan_number = 'BCS-1234'));
select pg_temp.expect('each change is logged, with who made it',
  (select count(*) = 3 and bool_and(changed_by = '00000000-0000-0000-0000-00000000000b') from strata_detail_changes where corporation_id = 'BCS-1234')
  and exists (select 1 from strata_detail_changes where field = 'fiscal_year_start_month' and old_value is null and new_value = '2'));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select update_strata_details('BCS-1234', '{"fiscal_year_start_month":2,"building_name":"The Larches"}');
reset role;
select pg_temp.expect('an unchanged value isn''t logged again', (select count(*) = 3 from strata_detail_changes where corporation_id = 'BCS-1234'));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('an Admin can''t change the legal name', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"legal_name":"Something Else"}')$q$));
select pg_temp.expect('nor the number of lots', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"unit_count":99}')$q$));
select pg_temp.expect('nor the jurisdiction', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"jurisdiction":"AB"}')$q$));
select pg_temp.expect('nobody changes the plan number', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"strata_plan_number":"BCS-9999"}')$q$));
select pg_temp.expect('a month outside 1 to 12 is refused', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"fiscal_year_start_month":13}')$q$));
select pg_temp.expect('a month as text is refused', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"fiscal_year_start_month":"2"}')$q$));
select pg_temp.expect('a blank address is refused', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"address":"   "}')$q$));
select pg_temp.expect('a refused change leaves everything as it was, even the allowed part',
  pg_temp.refused($q$select update_strata_details('BCS-1234', '{"address":"New","unit_count":5}')$q$));
reset role;
select pg_temp.expect('(still the old address)', (select address = '12 Elm Street, Vancouver, BC' from strata_corporations where strata_plan_number = 'BCS-1234'));

-- Cara, a member who isn't an Admin.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('a member who isn''t the Admin can''t change anything', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"building_name":"Mine"}')$q$));
select pg_temp.expect('and can''t read the change log', (select count(*) = 0 from strata_detail_changes));
select pg_temp.expect('nobody writes to the strata directly', pg_temp.refused($q$update strata_corporations set fiscal_year_start_month = 5 where strata_plan_number = 'BCS-1234' returning 1$q$)
  or (select fiscal_year_start_month = 2 from strata_corporations where strata_plan_number = 'BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the Admin reads the change log', (select count(*) = 3 from strata_detail_changes));
select pg_temp.expect('nobody writes to the log', pg_temp.refused($q$insert into strata_detail_changes (corporation_id, field) values ('BCS-1234', 'address')$q$));
reset role;

-- Sam, Super Admin, two-step verified.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select update_strata_details('BCS-1234', '{"legal_name":"The Owners, Strata Plan BCS1234","jurisdiction":"bc","unit_count":24,"fiscal_year_start_month":null}');
reset role;
select pg_temp.expect('a Super Admin changes the legal name, jurisdiction, and number of lots, and clears the fiscal year',
  (select legal_name = 'The Owners, Strata Plan BCS1234' and jurisdiction = 'BC' and unit_count = 24 and fiscal_year_start_month is null
   from strata_corporations where strata_plan_number = 'BCS-1234'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
set test.aal = 'aal1';
select pg_temp.expect('but not without two-step verification', pg_temp.refused($q$select update_strata_details('BCS-1234', '{"unit_count":30}')$q$));
reset test.aal;
reset role;

select pg_temp.expect('anon can''t call it', not has_function_privilege('anon', 'public.update_strata_details(text, jsonb)', 'execute'));
