\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
create function pg_temp.denied(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when insufficient_privilege then return true; end $$;
grant execute on function pg_temp.denied(text) to authenticated;
insert into stratasphere_usage (corporation_id, user_id, surface, input_tokens, output_tokens, cost_usd)
values ('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'assistant', 1000, 200, 0.008);

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
insert into strata_management (corporation_id, company_name, managers) values ('BCS-1234', 'Alpine Strata', '[{"name":"Pat"}]');
select pg_temp.expect('admin saves management details', (select company_name from strata_management where corporation_id = 'BCS-1234') = 'Alpine Strata');
select pg_temp.expect('admin can''t read usage', (select count(*) = 0 from stratasphere_usage));

set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, plain member
select pg_temp.expect('member reads management details', (select count(*) = 1 from strata_management where corporation_id = 'BCS-1234'));
update strata_management set company_name = 'Hijacked' where corporation_id = 'BCS-1234';
select pg_temp.expect('member can''t edit them', (select company_name from strata_management where corporation_id = 'BCS-1234') = 'Alpine Strata');
select pg_temp.expect('member can''t write them', pg_temp.denied($$insert into strata_management (corporation_id) values ('BCS-1234') on conflict (corporation_id) do update set company_name = 'X'$$));
select pg_temp.expect('member can''t read usage, even her own', (select count(*) = 0 from stratasphere_usage));
select pg_temp.expect('nobody can write usage from the browser', pg_temp.denied($$insert into stratasphere_usage (corporation_id, surface) values ('BCS-1234', 'assistant')$$));

reset role;
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'manager', '00000000-0000-0000-0000-00000000000c');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, now Manager
update strata_management set company_name = 'Alpine Strata Ltd.' where corporation_id = 'BCS-1234';
select pg_temp.expect('manager edits management details', (select company_name from strata_management where corporation_id = 'BCS-1234') = 'Alpine Strata Ltd.');

set test.uid = '00000000-0000-0000-0000-00000000000e';  -- outsider
select pg_temp.expect('outsider can''t read them', (select count(*) = 0 from strata_management));

set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
select pg_temp.expect('super admin reads usage', (select count(*) = 1 from stratasphere_usage));
select pg_temp.expect('super admin reads management details', (select count(*) = 1 from strata_management));
reset role;
do $$ begin
  begin update strata_management set managers = '{}'::jsonb; raise exception 'FAILED: managers object accepted';
  exception when check_violation then raise notice 'OK: managers must be a list'; end;
end $$;
