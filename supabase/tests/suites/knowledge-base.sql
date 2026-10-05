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
grant select on all tables in schema public to authenticated;
set search_path = public, extensions;
-- a second corporation for the global pool
insert into strata_corporations (strata_plan_number, legal_name, address, unit_count, jurisdiction) values ('EPS0002','Other','x',3,'BC');
create function pg_temp.vec(i int) returns extensions.vector language sql as $$
  select ('[' || array_to_string(array(select case when g = i then 1 else 0.01 end from generate_series(1,1024) g), ',') || ']')::extensions.vector $$;
grant execute on function pg_temp.vec(int) to authenticated;
insert into knowledge_chunks (scope, corporation_id, document_id, title, chunk_text, embedding, chunk_index) values
  ('corporation', 'BCS-1234', '11111111-1111-1111-1111-111111111111', 'plan', 'own chunk', pg_temp.vec(1), 0),
  ('corporation', 'EPS0002', null, 'other', 'other corp chunk', pg_temp.vec(1), 0);
insert into knowledge_chunks (scope, source_corporation_id, chunk_text, embedding, chunk_index) values
  ('global_precedent', 'EPS0002', 'precedent from elsewhere', pg_temp.vec(1), 0),
  ('global_precedent', 'BCS-1234', 'own precedent copy', pg_temp.vec(1), 0),
  ('legislation', null, 'SPA s.45', pg_temp.vec(2), 0);
select pg_temp.expect_error($q$insert into knowledge_chunks (scope, chunk_text, embedding, chunk_index) values ('corporation', 'x', pg_temp.vec(1), 0)$q$, 'scope_shape');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, member, not subscribed
select pg_temp.expect('no direct reads of chunks', (select count(*) = 0 from knowledge_chunks));
select pg_temp.expect_error($q$select * from match_knowledge_chunks('BCS-1234', pg_temp.vec(1))$q$, 'not allowed');
reset role;
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active')
  on conflict (corporation_id) do update set status = 'active';
set role authenticated;
select pg_temp.expect('subscribed member matches own + others precedent + legislation, not other corp or own precedent copy',
  (select array_agg(chunk_text order by chunk_text) = array['own chunk','precedent from elsewhere']::text[] from match_knowledge_chunks('BCS-1234', pg_temp.vec(1), 12, 0.9)));
select pg_temp.expect('legislation comes back at a lower threshold',
  (select bool_or(chunk_text = 'SPA s.45') from match_knowledge_chunks('BCS-1234', pg_temp.vec(1), 12, 0.0)));
select pg_temp.expect('never another corporation''s private chunk',
  (select not bool_or(chunk_text = 'other corp chunk') from match_knowledge_chunks('BCS-1234', pg_temp.vec(1), 50, 0.0)));
select pg_temp.expect_error($q$select * from match_knowledge_chunks('EPS0002', pg_temp.vec(1))$q$, 'not allowed');
set test.uid = '00000000-0000-0000-0000-00000000000a';  -- removed member
select pg_temp.expect_error($q$select * from match_knowledge_chunks('BCS-1234', pg_temp.vec(1))$q$, 'not allowed');
