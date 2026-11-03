\set ON_ERROR_STOP 1
-- 0072: draft minutes for council only, backup codes server-only, no
-- functions for signed-out callers, the training lock token hidden.
-- No blanket table grant here: the column rules are what's under test.
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    raise notice 'OK refused: %', sqlerrm; return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;

-- Seeded BCS-1234: b is admin and manager, c can run meetings, f is a
-- member with no council role; d is a Super Admin, e an outsider.
set app.meeting_lifecycle = 'on';
insert into meetings (id, corporation_id, type, meeting_date, created_by, status, adjourned_at, minutes_state, minutes_content)
values ('dddddddd-0000-0000-0000-000000000001', 'BCS-1234', 'council', '2026-11-01', '00000000-0000-0000-0000-00000000000b', 'ADJOURNED', now(), 'DRAFT', '{"draft":"hearing for SL004"}');
reset app.meeting_lifecycle;

set role authenticated;

-- Draft minutes
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('a member still sees the meeting', (select count(*) from meetings where id = 'dddddddd-0000-0000-0000-000000000001') = 1);
select pg_temp.expect_error($q$select minutes_content from meetings$q$, 'permission denied');
select pg_temp.expect_error($q$select * from meetings$q$, 'permission denied');
select pg_temp.expect('a member off council gets no draft minutes', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is null);
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('whoever can run meetings gets the draft', meeting_minutes('dddddddd-0000-0000-0000-000000000001') ->> 'draft' = 'hearing for SL004');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('the admin gets the draft (runs meetings)', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is not null);
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider gets nothing', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is null);
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('a two-step-verified Super Admin gets the draft', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is not null);
set test.aal = 'aal1';
select pg_temp.expect('a Super Admin without two-step gets nothing', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is null);
reset test.aal;

reset role;
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'member_at_large', '00000000-0000-0000-0000-00000000000f');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('a council member gets the draft', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is not null);
reset role;
delete from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f';
set app.meeting_lifecycle = 'on';
update meetings set minutes_state = 'FINAL', minutes_finalized_at = now() where id = 'dddddddd-0000-0000-0000-000000000001';
reset app.meeting_lifecycle;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('final minutes reach every member', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is not null);
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('final minutes still not for outsiders', meeting_minutes('dddddddd-0000-0000-0000-000000000001') is null);

-- Backup codes
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error($q$insert into mfa_backup_codes (user_id, code_hash) values ('00000000-0000-0000-0000-00000000000b', 'x')$q$, 'permission denied');
select pg_temp.expect_error($q$select id from mfa_backup_codes$q$, 'permission denied');
select pg_temp.expect_error($q$update mfa_backup_codes set used_at = null$q$, 'permission denied');

-- Training lock token
select pg_temp.expect_error($q$select checkout_token from training_modules$q$, 'permission denied');
select pg_temp.expect('who has a module checked out stays readable', (select count(*) >= 0 from (select checked_out_by, checked_out_at from training_modules) t));
reset role;

-- Every other column stays readable: a column added later without a grant fails here.
select pg_temp.expect('meetings: every column but minutes_content readable',
  not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'meetings'
    and c.column_name <> 'minutes_content' and not has_column_privilege('authenticated', 'public.meetings', c.column_name, 'SELECT')));
select pg_temp.expect('training_modules: every column but checkout_token readable',
  not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'training_modules'
    and c.column_name <> 'checkout_token' and not has_column_privilege('authenticated', 'public.training_modules', c.column_name, 'SELECT')));

-- Functions
select pg_temp.expect('no function in public is callable signed out',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));
create function public.zz_security_review_probe() returns int language sql as 'select 1';
select pg_temp.expect('a new function is not callable signed out', not has_function_privilege('anon', 'public.zz_security_review_probe()', 'EXECUTE'));
select pg_temp.expect('a new function is callable signed in', has_function_privilege('authenticated', 'public.zz_security_review_probe()', 'EXECUTE'));
drop function public.zz_security_review_probe();
select pg_temp.expect('signed-in users keep the functions the app calls',
  has_function_privilege('authenticated', 'public.is_corporation_member(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.lookup_strata_corporation(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.meeting_minutes(uuid)', 'EXECUTE'));
