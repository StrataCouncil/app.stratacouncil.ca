\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
revoke all on owners_and_council, documents, conversations from authenticated;
grant select, insert, update, delete on owners_and_council, documents, conversations to authenticated;
insert into conversations (corporation_id, user_id, title) values ('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'Cara private');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin, not a member
select pg_temp.expect('super admin counts as admin', has_corporation_role('BCS-1234', array['admin']));
select pg_temp.expect('and can run meetings', can_run_meetings('BCS-1234'));
select pg_temp.expect('reads the owner roster', (select count(*) > 0 from owners_and_council where corporation_id = 'BCS-1234'));
update owners_and_council set unit_number = 'SA-edit' where corporation_id = 'BCS-1234' and lot_number = (select min(lot_number) from owners_and_council where corporation_id = 'BCS-1234');
select pg_temp.expect('edits the owner roster', (select count(*) = 1 from owners_and_council where corporation_id = 'BCS-1234' and unit_number = 'SA-edit'));
select pg_temp.expect('never sees members'' conversations', (select count(*) = 0 from conversations));
select pg_temp.expect('isn''t in the member directory', (select not bool_or(user_id = '00000000-0000-0000-0000-00000000000d') from corporation_member_directory('BCS-1234')));
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- outsider
select pg_temp.expect('an outsider still isn''t', not has_corporation_role('BCS-1234', array['admin']) and not is_corporation_member('BCS-1234'));
