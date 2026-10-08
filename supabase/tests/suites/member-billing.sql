\set ON_ERROR_STOP 1
-- Billing access (0046): the admin, and anyone the admin switches on.
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text, needle text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text,text) to authenticated;
create function pg_temp.switch(who uuid, on_ boolean) returns int language sql as $$
  with u as (
    update corporation_memberships set can_manage_billing = on_
    where corporation_id = 'BCS-1234' and user_id = who and status = 'active' returning 1
  ) select count(*)::int from u $$;
grant execute on function pg_temp.switch(uuid, boolean) to authenticated;

-- After setup: Bob (b) is the admin of BCS-1234; Cara (c) and member f are active.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the admin can use billing', can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('a member can''t, to begin with', not can_manage_billing('BCS-1234'));
select pg_temp.expect('and can''t switch themselves on', pg_temp.switch('00000000-0000-0000-0000-00000000000c', true) = 0);
select pg_temp.expect('still off', not can_manage_billing('BCS-1234'));

set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the admin switches Cara on', pg_temp.switch('00000000-0000-0000-0000-00000000000c', true) = 1);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('Cara can use billing now', can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('another member still can''t', not can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider can''t', not can_manage_billing('BCS-1234'));
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('a Super Admin can (admin of every strata)', can_manage_billing('BCS-1234'));

set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.switch('00000000-0000-0000-0000-00000000000c', false);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('switched off again, Cara loses access', not can_manage_billing('BCS-1234'));
reset role;

-- Removed from the strata: the switch no longer counts.
update corporation_memberships set can_manage_billing = true, status = 'removed'
where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('a removed member can''t use billing', not can_manage_billing('BCS-1234'));
reset role;

-- 0045's Manager switch carries over when this migration runs (and only once).
update corporation_memberships set status = 'active', can_manage_billing = false
where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f';
insert into corporation_role_assignments (corporation_id, role, user_id)
values ('BCS-1234', 'manager', '00000000-0000-0000-0000-00000000000f') on conflict do nothing;
-- (0047 removed the old setting; put it back to replay the carry-over.)
alter table strata_corporations add column if not exists managers_can_bill boolean not null default false;
update strata_corporations set managers_can_bill = true where strata_plan_number = 'BCS-1234';
\i supabase/migrations/0046_member_billing.sql
select pg_temp.expect('the Manager keeps billing access',
  (select can_manage_billing from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f'));
select pg_temp.expect('and only the Manager', not (select can_manage_billing from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000c'));
update corporation_memberships set can_manage_billing = false where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f';
\i supabase/migrations/0046_member_billing.sql
select pg_temp.expect('running it again doesn''t switch them back on',
  not (select can_manage_billing from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f'));
select pg_temp.expect('the old switch is gone', to_regprocedure('public.set_managers_can_bill(text, boolean)') is null);
