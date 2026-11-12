\set ON_ERROR_STOP 1
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    raise notice 'OK refused: %', sqlerrm; return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated, anon;

-- 0091: Enterprise requests and prices are server-only.
insert into enterprise_requests (corporation_id, user_id, reason, message)
  values ('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'large', 'We have 140 lots.');
insert into enterprise_prices (corporation_id, billing_interval, amount, note)
  values ('BCS-1234', 'annual', 3800, 'Agreed on the phone');
select pg_temp.expect('the server writes both', (select count(*) = 1 from enterprise_requests) and (select amount = 3800 from enterprise_prices));

select pg_temp.expect_error($q$insert into enterprise_requests (corporation_id, reason) values ('BCS-1234', 'curious')$q$, 'enterprise_requests_reason_check');
select pg_temp.expect_error($q$insert into enterprise_prices (corporation_id, billing_interval, amount) values ('BCS-1234', 'weekly', 10) on conflict (corporation_id) do update set billing_interval = excluded.billing_interval$q$, 'enterprise_prices_billing_interval_check');
select pg_temp.expect_error($q$update enterprise_prices set amount = 0$q$, 'enterprise_prices_amount_check');
select pg_temp.expect_error($q$insert into enterprise_prices (corporation_id, billing_interval, amount) values ('NOPE-1', 'monthly', 10)$q$, 'foreign key');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, the strata's admin
select pg_temp.expect_error($q$select count(*) from enterprise_prices$q$, 'permission denied');
select pg_temp.expect_error($q$insert into enterprise_requests (corporation_id, reason) values ('BCS-1234', 'large')$q$, 'permission denied');
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin: through the console only
set test.aal = 'aal2';
select pg_temp.expect_error($q$select count(*) from enterprise_requests$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from enterprise_prices$q$, 'permission denied');
reset role;
select pg_temp.expect('they go with the strata (on delete cascade)',
  (select bool_and(confdeltype = 'c') and count(*) = 2 from pg_constraint
   where contype = 'f' and confrelid = 'public.strata_corporations'::regclass
     and conrelid in ('public.enterprise_prices'::regclass, 'public.enterprise_requests'::regclass)));
