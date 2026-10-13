\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
select pg_temp.expect('no strata starts complimentary', not exists (select 1 from subscriptions where complimentary_at is not null));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
update subscriptions set status = 'active', complimentary_at = now() where corporation_id = 'BCS-1234';
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin, through the browser
update subscriptions set status = 'active', complimentary_at = now() where corporation_id = 'BCS-1234';
reset role;
select pg_temp.expect('nobody can switch it on from the browser, Super Admins included',
  not exists (select 1 from subscriptions where corporation_id = 'BCS-1234' and complimentary_at is not null));
