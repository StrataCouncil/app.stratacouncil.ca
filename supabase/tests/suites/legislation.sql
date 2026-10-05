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
set search_path = public, extensions;
create function pg_temp.vec(i int) returns extensions.vector language sql as $$
  select ('[' || array_to_string(array(select case when g = i then 1 else 0.01 end from generate_series(1,1024) g), ',') || ']')::extensions.vector $$;
grant execute on function pg_temp.vec(int) to authenticated;
-- Revoke the flow's blanket grants so the migration's own grants are what's tested.
revoke all on legislation_documents from authenticated;
grant select, insert, update, delete on legislation_documents to authenticated;
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active')
  on conflict (corporation_id) do update set status = 'active';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin, not platform staff
select pg_temp.expect_error($q$insert into legislation_documents (title) values ('Nope Act')$q$, 'row-level security');
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
insert into legislation_documents (id, title, kind) values ('aaaaaaaa-0000-0000-0000-00000000000a', 'Strata Property Act', 'act');
select pg_temp.expect('super admin sees the library', (select count(*) = 1 from legislation_documents));
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('strata admin sees none of it', (select count(*) = 0 from legislation_documents));
update legislation_documents set title = 'x';
reset role;
select pg_temp.expect('and can''t change it', (select title = 'Strata Property Act' from legislation_documents));

insert into knowledge_chunks (scope, legislation_document_id, source_act, title, chunk_text, embedding, chunk_index) values
  ('legislation', 'aaaaaaaa-0000-0000-0000-00000000000a', 'Strata Property Act', 's. 45 Notice', 'SPA 45 text', pg_temp.vec(5), 0);
insert into knowledge_chunks (scope, corporation_id, title, chunk_text, embedding, chunk_index) values
  ('corporation', 'BCS-1234', 'bylaws', 'own bylaw text', pg_temp.vec(5), 0);

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, member of a subscribed strata
select pg_temp.expect('legislation-only search returns only legislation',
  (select bool_and(scope = 'legislation') and count(*) >= 1 from match_knowledge_chunks('BCS-1234', pg_temp.vec(5), 12, 0.0, array['legislation'])));
select pg_temp.expect('records search excludes legislation',
  (select not bool_or(scope = 'legislation') and bool_or(chunk_text = 'own bylaw text') from match_knowledge_chunks('BCS-1234', pg_temp.vec(5), 50, 0.0, array['corporation','global_precedent'])));
select pg_temp.expect('no scopes means everything, as before',
  (select bool_or(scope = 'legislation') and bool_or(scope = 'corporation') from match_knowledge_chunks('BCS-1234', pg_temp.vec(5), 50, 0.0)));
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- outsider
select pg_temp.expect_error($q$select * from match_knowledge_chunks('BCS-1234', pg_temp.vec(5), 12, 0.0, array['legislation'])$q$, 'not allowed');

set test.uid = '00000000-0000-0000-0000-00000000000d';
delete from legislation_documents where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
reset role;
select pg_temp.expect('deleting an entry deletes its chunks',
  (select count(*) = 0 from knowledge_chunks where legislation_document_id = 'aaaaaaaa-0000-0000-0000-00000000000a'));
