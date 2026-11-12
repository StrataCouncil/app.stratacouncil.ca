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

-- 0095: keyword search over a strata's own passages, alongside the meaning search.
insert into strata_corporations (strata_plan_number, legal_name, address, unit_count, jurisdiction) values ('EPS0002','Other','x',3,'BC');
create function pg_temp.vec() returns extensions.vector language sql as $$ select array_fill(0.1, array[1024])::extensions.vector $$;
insert into documents (id, corporation_id, title, category, file_name, storage_path, is_current)
values ('22222222-2222-2222-2222-222222222222', 'BCS-1234', 'Old quote', 'insurance', 'old.pdf', 'x/old.pdf', false);
insert into knowledge_chunks (scope, corporation_id, document_id, title, chunk_text, embedding, chunk_index) values
  ('corporation', 'BCS-1234', null, 'Council minutes', 'SL12 asked about the leaking skylight. Council approved Apex Roofing.', pg_temp.vec(), 0),
  ('corporation', 'BCS-1234', null, 'Council minutes', 'SL120 parking stall swap approved.', pg_temp.vec(), 1),
  ('corporation', 'BCS-1234', null, 'Bylaws', 'Bylaw 7.3: hallways are for ingress and egress only.', pg_temp.vec(), 2),
  ('corporation', 'BCS-1234', null, 'Invoices', 'Invoice INV-20931 paid to the plumber.', pg_temp.vec(), 3),
  ('corporation', 'BCS-1234', '22222222-2222-2222-2222-222222222222', 'Old minutes', 'Apex Roofing quote superseded.', pg_temp.vec(), 0),
  ('corporation', 'EPS0002', null, 'Other strata', 'SL12 Apex Roofing at another strata.', pg_temp.vec(), 0);
insert into knowledge_chunks (scope, source_corporation_id, chunk_text, embedding, chunk_index) values
  ('global_precedent', 'EPS0002', 'Apex Roofing precedent elsewhere.', pg_temp.vec(), 0);
insert into knowledge_chunks (scope, chunk_text, embedding, chunk_index) values
  ('legislation', 'Roofing under the Building Code.', pg_temp.vec(), 0);

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';  -- Cara, member, not subscribed
select pg_temp.expect_error($q$select * from keyword_knowledge_chunks('BCS-1234', array['roofing'])$q$, 'not allowed');
reset role;
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active')
  on conflict (corporation_id) do update set status = 'active';
set role authenticated;
select pg_temp.expect_error($q$select * from keyword_knowledge_chunks('BCS-1234', array['roofing'])$q$, 'not allowed');  -- off council
reset role;
insert into corporation_role_assignments (corporation_id, user_id, role) values ('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'secretary')
  on conflict do nothing;
set role authenticated;

select pg_temp.expect('words: the strata''s own current passage, never another strata''s, precedent, legislation, or a superseded document',
  (select array_agg(chunk_text) = array['SL12 asked about the leaking skylight. Council approved Apex Roofing.']
   from keyword_knowledge_chunks('BCS-1234', array['roofing', 'apex'])));
select pg_temp.expect('words are stemmed and any of them matches',
  (select count(*) = 1 from keyword_knowledge_chunks('BCS-1234', array['skylights', 'zebra'])));
select pg_temp.expect('an exact string is found as written, and ranked first',
  (select bool_and(exact) and count(*) = 1 from keyword_knowledge_chunks('BCS-1234', '{}', array['INV-20931'])));
select pg_temp.expect('exact matching ignores case',
  (select count(*) = 1 from keyword_knowledge_chunks('BCS-1234', '{}', array['bylaw 7.3'])));
-- "SL12" is also inside "SL120": the database returns both, the app keeps whole words.
select pg_temp.expect('a lot number finds its passages',
  (select count(*) = 2 from keyword_knowledge_chunks('BCS-1234', '{}', array['SL12'])));
select pg_temp.expect('a passage found exactly isn''t returned twice',
  (select count(*) = count(distinct id) from keyword_knowledge_chunks('BCS-1234', array['roofing', 'skylight'], array['SL12'])));
select pg_temp.expect('query syntax in a word is just text',
  (select count(*) = 0 from keyword_knowledge_chunks('BCS-1234', array['!(&|', ':*'])));
select pg_temp.expect('nothing asked, nothing found',
  (select count(*) = 0 from keyword_knowledge_chunks('BCS-1234', '{}', '{}')));
select pg_temp.expect('the count is capped',
  (select count(*) <= 1 from keyword_knowledge_chunks('BCS-1234', array['approved', 'bylaw', 'invoice', 'roofing'], '{}', 1)));
select pg_temp.expect_error($q$select * from keyword_knowledge_chunks('EPS0002', array['roofing'])$q$, 'not allowed');
set test.uid = '00000000-0000-0000-0000-00000000000a';  -- removed member
select pg_temp.expect_error($q$select * from keyword_knowledge_chunks('BCS-1234', array['roofing'])$q$, 'not allowed');
reset role;
select pg_temp.expect('signed-out visitors can''t call it at all',
  not has_function_privilege('anon', 'public.keyword_knowledge_chunks(text, text[], text[], int)', 'execute')
  and has_function_privilege('authenticated', 'public.keyword_knowledge_chunks(text, text[], text[], int)', 'execute'));
