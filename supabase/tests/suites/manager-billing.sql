\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text, needle text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text,text) to authenticated;
-- After setup: Bob (b) is the admin of BCS-1234; Cara (c) and member f are active.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['manager']);
select pg_temp.expect('the admin can use billing', can_manage_billing('BCS-1234'));
select pg_temp.expect('billing access for the Manager is off to begin with',
  not (select managers_can_bill from strata_corporations where strata_plan_number = 'BCS-1234'));

set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('the Manager can''t use billing until the admin allows it', not can_manage_billing('BCS-1234'));
select pg_temp.expect('and can''t turn it on themselves',
  pg_temp.fails($$select set_managers_can_bill('BCS-1234', true)$$, 'Only this strata''s admin'));

set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_managers_can_bill('BCS-1234', true);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('once allowed, the Manager can use billing', can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('another council member still can''t', not can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider can''t', not can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('a Super Admin can (admin of every strata)', can_manage_billing('BCS-1234'));

set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_managers_can_bill('BCS-1234', false);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('turned off again, the Manager loses access', not can_manage_billing('BCS-1234'));
reset role;
