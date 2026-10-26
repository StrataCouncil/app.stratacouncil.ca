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

-- 0067: demo requests are server-only; Super Admins can read them.
insert into demo_requests (full_name, email, source, campaign) values ('JJ Mc', 'jjmc@example.com', 'home', '{"utm_source":"facebook"}');
select pg_temp.expect_error($q$insert into demo_requests (full_name, email) values ('X', 'Upper@Example.com')$q$, 'demo_requests_email_check');
select pg_temp.expect_error($q$insert into demo_requests (full_name, email, source) values ('X', 'x@example.com', 'elsewhere')$q$, 'demo_requests_source_check');
select pg_temp.expect_error($q$update demo_requests set outcome = 'sent'$q$, 'demo_requests_handled');
select pg_temp.expect_error($q$update demo_requests set handled_at = now()$q$, 'demo_requests_handled');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, an ordinary member
select pg_temp.expect('members see no demo requests', (select count(*) = 0 from demo_requests));
select pg_temp.expect_error($q$insert into demo_requests (full_name, email) values ('X', 'x@example.com')$q$, 'permission denied');

set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
set test.aal = 'aal2';
select pg_temp.expect('a Super Admin reads demo requests', (select count(*) = 1 from demo_requests));
select pg_temp.expect_error($q$update demo_requests set outcome = 'dismissed', handled_at = now()$q$, 'permission denied');
select pg_temp.expect_error($q$delete from demo_requests$q$, 'permission denied');
set test.aal = 'aal1';
select pg_temp.expect('but not without two-step verification', (select count(*) = 0 from demo_requests));

reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from demo_requests$q$, 'permission denied');
select pg_temp.expect_error($q$insert into demo_requests (full_name, email) values ('X', 'x@example.com')$q$, 'permission denied');

reset role;
update demo_requests set handled_at = now(), outcome = 'sent', handled_by_name = 'Sam';
select pg_temp.expect('the server marks a request handled', (select outcome = 'sent' from demo_requests));
