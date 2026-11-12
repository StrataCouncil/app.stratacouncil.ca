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

-- 0089: recall cases and runs are server-only.
insert into stratasphere_recall_cases (id, corporation_id, question, expect_phrases)
  values ('99999999-0000-0000-0000-000000000001', 'BCS-1234', 'Can we have pets?', array['pets']);
insert into stratasphere_recall_runs (case_id, kind, passed, details)
  values ('99999999-0000-0000-0000-000000000001', 'find', true, '{"missing":[]}');
select pg_temp.expect('the server writes cases and runs', (select count(*) = 1 from stratasphere_recall_runs));

select pg_temp.expect_error($q$insert into stratasphere_recall_cases (corporation_id, question) values ('BCS-1234', '')$q$, 'stratasphere_recall_cases_question_check');
select pg_temp.expect_error($q$insert into stratasphere_recall_cases (corporation_id, question) values ('NOPE-1', 'x')$q$, 'foreign key');
select pg_temp.expect_error($q$insert into stratasphere_recall_cases (corporation_id, question, item_id) values ('BCS-1234', 'x', 'i1')$q$, 'item_needs_meeting');
select pg_temp.expect_error($q$insert into stratasphere_recall_runs (case_id, kind, passed) values ('99999999-0000-0000-0000-000000000001', 'guess', true)$q$, 'stratasphere_recall_runs_kind_check');
select pg_temp.expect_error($q$insert into stratasphere_recall_runs (case_id, kind, passed, cost_usd) values ('99999999-0000-0000-0000-000000000001', 'answer', true, -1)$q$, 'stratasphere_recall_runs_cost_usd_check');

-- Not even a Super Admin reads them directly: the console goes through the server.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
set test.aal = 'aal2';
select pg_temp.expect_error($q$select count(*) from stratasphere_recall_cases$q$, 'permission denied');
select pg_temp.expect_error($q$select count(*) from stratasphere_recall_runs$q$, 'permission denied');
set test.uid = '00000000-0000-0000-0000-00000000000a';  -- Alice, the strata's admin
select pg_temp.expect_error($q$select count(*) from stratasphere_recall_cases$q$, 'permission denied');
select pg_temp.expect_error($q$insert into stratasphere_recall_runs (case_id, kind, passed) values ('99999999-0000-0000-0000-000000000001', 'find', true)$q$, 'permission denied');

reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from stratasphere_recall_cases$q$, 'permission denied');

-- Deleting a case deletes its runs.
reset role;
delete from stratasphere_recall_cases where id = '99999999-0000-0000-0000-000000000001';
select pg_temp.expect('runs go with their case', (select count(*) = 0 from stratasphere_recall_runs));
