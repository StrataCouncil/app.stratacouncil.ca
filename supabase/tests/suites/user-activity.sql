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

-- 0069: the Users tab's activity log is server-only, keeps 24 months, and
-- goes with the person (it mustn't block deleting an account).
insert into user_activity (user_id, kind, strata, ref, label) values
  ('00000000-0000-0000-0000-00000000000a', 'guide_opened', 'BCS-1234', 'g1', 'Bylaw fines'),
  ('00000000-0000-0000-0000-00000000000e', 'template_downloaded', 'BCS-1234', 'g2', 'EV charging policy');
select pg_temp.expect('the server can log', (select count(*) = 2 from user_activity));
select pg_temp.expect_error($q$insert into user_activity (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'chat_read')$q$, 'user_activity_kind_check');
select pg_temp.expect_error($q$insert into user_activity (user_id, kind, label) values ('00000000-0000-0000-0000-00000000000a', 'guide_opened', repeat('x', 201))$q$, 'user_activity_label_check');

-- Nobody signed in can read or write it, Super Admins included.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_error($q$select count(*) from user_activity$q$, 'permission denied');
select pg_temp.expect_error($q$insert into user_activity (user_id, kind) values ('00000000-0000-0000-0000-00000000000a', 'guide_opened')$q$, 'permission denied');
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
set test.aal = 'aal2';
select pg_temp.expect_error($q$select count(*) from user_activity$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from user_activity$q$, 'permission denied');
reset role;
select pg_temp.expect('the prune function isn''t callable by visitors',
  not has_function_privilege('authenticated', 'public.user_activity_prune()', 'execute')
  and not has_function_privilege('anon', 'public.user_activity_prune()', 'execute'));

-- Older than 24 months goes on the next insert; newer stays.
insert into user_activity (user_id, kind, created_at) values
  ('00000000-0000-0000-0000-00000000000a', 'guide_opened', now() - interval '25 months'),
  ('00000000-0000-0000-0000-00000000000a', 'guide_opened', now() - interval '23 months');
select pg_temp.expect('rows older than 24 months are deleted, newer ones kept',
  (select count(*) = 0 from user_activity where created_at < now() - interval '24 months')
  and (select count(*) = 1 from user_activity where created_at < now() - interval '22 months'));

-- Deleting an account outside any strata takes its activity with it, even
-- activity in a strata (the column isn't corporation_id on purpose).
select * from platform_delete_person('00000000-0000-0000-0000-00000000000e', false);
select pg_temp.expect('the person''s activity went with them',
  (select count(*) = 0 from user_activity where user_id = '00000000-0000-0000-0000-00000000000e'));
select pg_temp.expect('other people''s activity stayed',
  (select count(*) > 0 from user_activity where user_id = '00000000-0000-0000-0000-00000000000a'));

-- Deleting the strata keeps the person's history, without the strata.
delete from subscriptions where corporation_id = 'BCS-1234';
select * from platform_delete_strata('BCS-1234', false);
select pg_temp.expect('the strata is cleared from activity, the rows stay',
  (select count(*) > 0 and bool_and(strata is null) from user_activity where user_id = '00000000-0000-0000-0000-00000000000a'));
