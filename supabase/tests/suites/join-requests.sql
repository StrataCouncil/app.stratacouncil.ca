\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
insert into corporation_join_requests (id, corporation_id, requested_by, status, resolved_at) values
 ('aaaaaaaa-0000-0000-0000-000000000001', 'BCS-1234', '00000000-0000-0000-0000-00000000000e', 'denied', now()),
 ('aaaaaaaa-0000-0000-0000-000000000002', 'BCS-1234', '00000000-0000-0000-0000-00000000000e', 'pending', null);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';  -- Alice, not the requester
select dismiss_my_request('join', 'aaaaaaaa-0000-0000-0000-000000000001');
reset role;
select pg_temp.expect('someone else can''t dismiss it', (select dismissed_at is null from corporation_join_requests where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- Xavier, the requester
select dismiss_my_request('join', 'aaaaaaaa-0000-0000-0000-000000000002');
select dismiss_my_request('join', 'aaaaaaaa-0000-0000-0000-000000000001');
reset role;
select pg_temp.expect('a pending request can''t be dismissed', (select dismissed_at is null from corporation_join_requests where id = 'aaaaaaaa-0000-0000-0000-000000000002'));
select pg_temp.expect('the requester dismisses a turned-down one', (select dismissed_at is not null from corporation_join_requests where id = 'aaaaaaaa-0000-0000-0000-000000000001'));
select pg_temp.expect('the row is kept', (select count(*) = 2 from corporation_join_requests where requested_by = '00000000-0000-0000-0000-00000000000e'));
