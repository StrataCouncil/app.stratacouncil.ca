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
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;
set role authenticated;
-- Cara (member) creates a project, a conversation in it, and messages.
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into conversation_projects (corporation_id, user_id, name) values ('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'Roof');
insert into conversations (corporation_id, user_id, title, project_id)
  select 'BCS-1234', '00000000-0000-0000-0000-00000000000c', 'Roof levy', id from conversation_projects;
insert into conversation_messages (conversation_id, role, content) select id, 'user', 'When is the levy due?' from conversations;
select pg_temp.expect('owner sees own conversation', (select count(*) = 1 from conversations));
select pg_temp.expect_error($q$insert into conversations (corporation_id, user_id, title) values ('BCS-1234', '00000000-0000-0000-0000-00000000000b', 'x')$q$, 'row-level security');
-- Bob (admin of the strata) and Sam (Super Admin) see nothing of Cara's.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('strata admin sees no one else''s conversations', (select count(*) = 0 from conversations));
select pg_temp.expect('strata admin sees no messages', (select count(*) = 0 from conversation_messages));
select pg_temp.expect('strata admin sees no projects', (select count(*) = 0 from conversation_projects));
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('super admin sees no conversations', (select count(*) = 0 from conversations));
-- An outsider can't start a conversation about a strata they're not in.
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect_error($q$insert into conversations (corporation_id, user_id, title) values ('BCS-1234', '00000000-0000-0000-0000-00000000000e', 'x')$q$, 'row-level security');
-- Removing Cara deletes her history for that strata.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select remove_corporation_member('BCS-1234', '00000000-0000-0000-0000-00000000000c');
reset role;
select pg_temp.expect('removal deletes conversations', (select count(*) = 0 from conversations where user_id = '00000000-0000-0000-0000-00000000000c'));
select pg_temp.expect('removal deletes messages', (select count(*) = 0 from conversation_messages));
select pg_temp.expect('removal deletes projects', (select count(*) = 0 from conversation_projects where user_id = '00000000-0000-0000-0000-00000000000c'));
