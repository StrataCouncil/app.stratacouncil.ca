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

-- 0097: directives. On BCS-1234: Pat president, Tess treasurer who runs
-- meetings, Max member at large, Manny the manager, Owen an owner.
insert into auth.users (id, email, raw_user_meta_data) values
  ('97000000-0000-0000-0000-000000000001', 'pat@x.ca', '{"full_name":"Pat President"}'),
  ('97000000-0000-0000-0000-000000000002', 'tess@x.ca', '{"full_name":"Tess Treasurer"}'),
  ('97000000-0000-0000-0000-000000000003', 'max@x.ca', '{"full_name":"Max Member"}'),
  ('97000000-0000-0000-0000-000000000005', 'manny@x.ca', '{"full_name":"Manny Manager"}'),
  ('97000000-0000-0000-0000-000000000006', 'owen@x.ca', '{"full_name":"Owen Owner"}');
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
  select id, 'BCS-1234', 'active', now() from auth.users where id::text like '97000000-%';
delete from corporation_role_assignments where corporation_id = 'BCS-1234' and role = 'president';
insert into corporation_role_assignments (corporation_id, role, user_id) values
  ('BCS-1234', 'president', '97000000-0000-0000-0000-000000000001'),
  ('BCS-1234', 'treasurer', '97000000-0000-0000-0000-000000000002'),
  ('BCS-1234', 'member_at_large', '97000000-0000-0000-0000-000000000003'),
  ('BCS-1234', 'manager', '97000000-0000-0000-0000-000000000005');
update corporation_memberships set can_run_meetings = true where corporation_id = 'BCS-1234' and user_id = '97000000-0000-0000-0000-000000000002';

-- Tess runs meetings: she adds one, assigned to the manager.
set role authenticated;
set test.uid = '97000000-0000-0000-0000-000000000002';
create temp table d1 as select create_directive('BCS-1234', '  Get three quotes for the roof membrane ', 'Report back in March.', 'manager', null, '2026-03-01') id;
grant select on d1 to authenticated;
select pg_temp.expect('a runner adds a directive', (select title = 'Get three quotes for the roof membrane' and source = 'manual' and drafted_by = 'person'
  and assignee_kind = 'manager' and assignee_user_id is null and due_date = '2026-03-01' and status = 'open' and created_by_name = 'Tess Treasurer'
  from directives where id = (select id from d1)));
select pg_temp.expect('its creation is logged', (select count(*) = 1 from directive_changes where directive_id = (select id from d1) and kind = 'created'));
select pg_temp.expect_error($q$select create_directive('BCS-1234', '   ', '', 'none', null, null)$q$, 'Say what needs to be done');
select pg_temp.expect_error($q$select create_directive('BCS-1234', 'X', '', 'everyone', null, null)$q$, 'Choose who');
select pg_temp.expect_error($q$select create_directive('BCS-1234', 'X', '', 'person', '97000000-0000-0000-0000-000000000006', null)$q$, 'can''t be assigned');
select pg_temp.expect_error($q$select create_directive('BCS-1234', 'X', '', 'person', null, null)$q$, 'can''t be assigned');

-- Assigned to a council member, then edited.
create temp table d2 as select create_directive('BCS-1234', 'Send the bylaw warning letter', '', 'person', '97000000-0000-0000-0000-000000000003', null) id;
grant select on d2 to authenticated;
select pg_temp.expect('assigned to a council member, by name', (select assignee_kind = 'person' and assignee_name = 'Max Member' from directives where id = (select id from d2)));
select update_directive((select id from d2), 'Send the bylaw warning letter to SL7', 'Use the template.', 'person', '97000000-0000-0000-0000-000000000005', '2026-02-15');
select pg_temp.expect('an edit changes it and is logged with what changed',
  (select title = 'Send the bylaw warning letter to SL7' and assignee_name = 'Manny Manager' and due_date = '2026-02-15' from directives where id = (select id from d2))
  and (select detail ? 'title' and detail ? 'assignee' and detail ? 'due_date' and detail ? 'detail' from directive_changes where directive_id = (select id from d2) and kind = 'edited'));
select update_directive((select id from d2), 'Send the bylaw warning letter to SL7', 'Use the template.', 'person', '97000000-0000-0000-0000-000000000005', '2026-02-15');
select pg_temp.expect('saving it unchanged logs nothing', (select count(*) = 1 from directive_changes where directive_id = (select id from d2) and kind = 'edited'));

-- Council sees them; Max can't add, edit, or close.
set test.uid = '97000000-0000-0000-0000-000000000003';
select pg_temp.expect('council sees every directive', (select count(*) = 2 from directives));
select pg_temp.expect('and their history', (select count(*) >= 3 from directive_changes));
select pg_temp.expect_error($q$select create_directive('BCS-1234', 'Mine', '', 'none', null, null)$q$, 'Only those who run meetings');
select pg_temp.expect_error($q$select update_directive((select id from d1), 'Changed', '', 'none', null, null)$q$, 'Only those who run meetings');
select pg_temp.expect_error($q$select set_directive_status((select id from d1), 'done')$q$, 'Only those who run meetings');
select pg_temp.expect_error($q$update directives set status = 'cancelled' returning 1$q$, 'permission denied');
select pg_temp.expect_error($q$insert into directive_changes (directive_id, corporation_id, kind) values ((select id from d1), 'BCS-1234', 'done')$q$, 'permission denied');

-- The manager sees them all and marks one done, but can't cancel or reopen.
set test.uid = '97000000-0000-0000-0000-000000000005';
select pg_temp.expect('the manager sees every directive', (select count(*) = 2 from directives));
select set_directive_status((select id from d1), 'done', '  Quotes are in the shared folder. ');
select pg_temp.expect('the manager closes one as done, with a note',
  (select status = 'done' and closed_at is not null and closed_by_name = 'Manny Manager' and close_note = 'Quotes are in the shared folder.' from directives where id = (select id from d1)));
select pg_temp.expect_error($q$select set_directive_status((select id from d2), 'cancelled')$q$, 'The manager can mark a directive done');
select pg_temp.expect_error($q$select set_directive_status((select id from d1), 'open')$q$, 'The manager can mark a directive done');
select pg_temp.expect_error($q$select create_directive('BCS-1234', 'Mine', '', 'none', null, null)$q$, 'Only those who run meetings');

-- The owner sees nothing and can do nothing.
set test.uid = '97000000-0000-0000-0000-000000000006';
select pg_temp.expect('an owner sees no directives', (select count(*) = 0 from directives));
select pg_temp.expect('nor their history', (select count(*) = 0 from directive_changes));
select pg_temp.expect_error($q$select set_directive_status((select id from d1), 'done')$q$, 'isn''t available');

-- Tess reopens and cancels.
set test.uid = '97000000-0000-0000-0000-000000000002';
select set_directive_status((select id from d1), 'open');
select pg_temp.expect('a runner reopens one, clearing who closed it',
  (select status = 'open' and closed_at is null and closed_by is null and close_note = '' from directives where id = (select id from d1)));
select set_directive_status((select id from d2), 'cancelled', 'No longer needed.');
select pg_temp.expect('a runner cancels one', (select status = 'cancelled' from directives where id = (select id from d2)));
select pg_temp.expect('each status change is logged',
  (select array_agg(kind order by id) from directive_changes where directive_id = (select id from d1)) = array['created', 'done', 'reopened']);
select pg_temp.expect_error($q$select set_directive_status((select id from d1), 'finished')$q$, 'Choose done');
reset role;

-- Another strata's people see none of it.
insert into strata_corporations (strata_plan_number, legal_name, address, unit_count, jurisdiction) values ('BCS-9097', 'Other', 'x', 3, 'BC') on conflict do nothing;
insert into auth.users (id, email) values ('97000000-0000-0000-0000-000000000009', 'other@x.ca');
insert into corporation_memberships (user_id, corporation_id, status, joined_at) values ('97000000-0000-0000-0000-000000000009', 'BCS-9097', 'active', now());
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-9097', 'manager', '97000000-0000-0000-0000-000000000009');
set role authenticated;
set test.uid = '97000000-0000-0000-0000-000000000009';
select pg_temp.expect('another strata''s manager sees none', (select count(*) = 0 from directives));
select pg_temp.expect_error($q$select set_directive_status((select id from d1), 'done')$q$, 'isn''t available');
reset role;

-- Automatic ones (service role): the source key stops duplicates.
insert into directives (corporation_id, title, source, source_key, drafted_by) values ('BCS-1234', 'Book the dryer-vent cleaning', 'meeting', 'decision:x:1', 'motion');
select pg_temp.expect_error($q$insert into directives (corporation_id, title, source, source_key) values ('BCS-1234', 'Again', 'meeting', 'decision:x:1')$q$, 'duplicate');
select pg_temp.expect_error($q$insert into directives (corporation_id, title, status) values ('BCS-1234', 'Done without a date', 'done')$q$, 'directives_closed');

select pg_temp.expect('anon can''t call the functions',
  not has_function_privilege('anon', 'public.create_directive(text, text, text, text, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.set_directive_status(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.directive_assignee_name(text, uuid)', 'execute'));
select pg_temp.expect('anon reads nothing', not has_table_privilege('anon', 'public.directives', 'select'));
