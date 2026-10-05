\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
select pg_temp.expect('stratas start live', (select bool_and(not stripe_sandbox) from strata_corporations));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
update strata_corporations set stripe_sandbox = true where strata_plan_number = 'BCS-1234';
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin, through the browser
update strata_corporations set stripe_sandbox = true where strata_plan_number = 'BCS-1234';
reset role;
select pg_temp.expect('nobody can flip it from the browser, Super Admins included', not (select stripe_sandbox from strata_corporations where strata_plan_number = 'BCS-1234'));
