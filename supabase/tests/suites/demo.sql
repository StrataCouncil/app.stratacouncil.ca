-- The demo site's tables and functions (supabase/demo/demo.sql), applied
-- twice (it runs on every deploy), on top of every migration: a visitor's
-- strata is created subscribed with them as admin, and deleting it leaves
-- every table exactly as it was, while other stratas, the fictional
-- people and the legislation library are untouched.
\set ON_ERROR_STOP 1
\i supabase/demo/demo.sql
\i supabase/demo/demo.sql
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text, needle text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text,text) to authenticated;

create function pg_temp.vec(n int) returns extensions.vector language sql as $$
  select (array_fill(0::real, array[n - 1]) || array[1::real] || array_fill(0::real, array[1024 - n]))::extensions.vector
$$;

-- Row counts of every table, before the visitor arrives.
create temp table before_counts (tbl text primary key, n bigint);
do $$
declare t record; c bigint;
begin
  for t in select format('%I.%I', schemaname, tablename) as name from pg_tables where schemaname = 'public' and tablename <> 'demo_visitors' loop
    execute format('select count(*) from %s', t.name) into c;
    insert into before_counts values (t.name, c);
  end loop;
end $$;

-- The visitor, a fictional council member, and someone the visitor invites.
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000f1','visitor@x.ca','{"full_name":"Vera Visitor"}'),
 ('00000000-0000-0000-0000-0000000000f2','cast@demo.test','{"full_name":"Casey Cast"}'),
 ('00000000-0000-0000-0000-0000000000f3','friend@x.ca','{"full_name":"Fran Friend"}');
insert into demo_cast (user_id, part) values ('00000000-0000-0000-0000-0000000000f2', 'council');
insert into demo_visitors (id, token, full_name, email, expires_at) values
 ('dddddddd-0000-0000-0000-000000000001', repeat('a', 43), 'Vera Visitor', 'visitor@x.ca', now() + interval '1 hour');

select pg_temp.expect('a link opens on the Stratasphere unless asked otherwise', (select landing from demo_visitors) = 'strata');
select pg_temp.expect('or Council Training, and nowhere else',
  pg_temp.fails($q$update demo_visitors set landing = 'billing'$q$, 'demo_visitors_landing_check'));
select pg_temp.expect('visitors can''t read the visitor list',
  not has_table_privilege('authenticated', 'public.demo_visitors', 'select'));
select pg_temp.expect('visitors can''t run the clean-up',
  not has_function_privilege('authenticated', 'public.demo_delete_strata(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.demo_delete_person(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.demo_create_strata(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.demo_delete_rows(regclass, text, regclass[])', 'execute'));

select pg_temp.expect('the first request claims the setup', demo_claim_setup('dddddddd-0000-0000-0000-000000000001'));
select pg_temp.expect('a second one at the same moment waits', not demo_claim_setup('dddddddd-0000-0000-0000-000000000001'));
update demo_visitors set setup_started_at = now() - interval '3 minutes';
select pg_temp.expect('an abandoned claim can be taken over', demo_claim_setup('dddddddd-0000-0000-0000-000000000001'));
select pg_temp.expect('visitors can''t claim', not has_function_privilege('authenticated', 'public.demo_claim_setup(uuid, boolean)', 'execute'));

create temp table v (corp text);
insert into v select demo_create_strata('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1');
grant select on v to authenticated;
select pg_temp.expect('a DEMO- Strata Plan', (select corp from v) ~ '^DEMO-\d{6}$');
select pg_temp.expect('opening the link twice makes one strata',
  demo_create_strata('dddddddd-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f1') = (select corp from v)
  and (select count(*) from strata_corporations where strata_plan_number like 'DEMO-%') = 1);
select pg_temp.expect('the visitor row records it',
  (select corporation_id = (select corp from v) and user_id = '00000000-0000-0000-0000-0000000000f1' from demo_visitors));
select pg_temp.expect('once set up, no one claims it again', not demo_claim_setup('dddddddd-0000-0000-0000-000000000001'));
select pg_temp.expect('one lot per unit', (select count(*) = 24 from owners_and_council where corporation_id = (select corp from v)));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.expect('the visitor is its admin', has_corporation_role((select corp from v), array['admin']));
select pg_temp.expect('and it''s subscribed', has_stratasphere_access((select corp from v)));
select pg_temp.expect('the visitor doesn''t see other stratas', (select count(*) = 1 from strata_corporations));
reset role;

-- The visitor uses the strata: documents (one replacing another, one the
-- strata's plan), the knowledge index, meetings with notes and decisions,
-- the Stratasphere, the roster, a fictional council member, an invite.
insert into documents (id, corporation_id, category, title, uploaded_by) values
 ('eeeeeeee-0000-0000-0000-000000000001', (select corp from v), 'legal_governance', 'Bylaws 2019', '00000000-0000-0000-0000-0000000000f1'),
 ('eeeeeeee-0000-0000-0000-000000000002', (select corp from v), 'legal_governance', 'Bylaws 2024', '00000000-0000-0000-0000-0000000000f1');
update documents set supersedes_document_id = 'eeeeeeee-0000-0000-0000-000000000001' where id = 'eeeeeeee-0000-0000-0000-000000000002';
update strata_corporations set source_document_id = 'eeeeeeee-0000-0000-0000-000000000002' where strata_plan_number = (select corp from v);
insert into knowledge_chunks (scope, corporation_id, document_id, title, chunk_text, embedding, chunk_index) values
  ('corporation', (select corp from v), 'eeeeeeee-0000-0000-0000-000000000002', 'Bylaws', 'pets', pg_temp.vec(2), 0);
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda) values
  ('eeeeeeee-0000-0000-0000-0000000000a1', (select corp from v), 'council', '2026-11-01', '00000000-0000-0000-0000-0000000000f1', '[{"id":"i1","text":"Call to Order"}]');
insert into meeting_item_notes (meeting_id, item_id, body) values ('eeeeeeee-0000-0000-0000-0000000000a1', 'i1', 'note');
insert into documents (id, corporation_id, category, title, source_type) values
 ('eeeeeeee-0000-0000-0000-000000000003', (select corp from v), 'meetings_records', '2019 minutes', 'historic_minutes');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.expect('historic decisions recorded',
  record_historic_decisions((select corp from v), 'eeeeeeee-0000-0000-0000-000000000003', '[{"title":"Paint hallways"}]') = 1);
reset role;
insert into conversation_projects (corporation_id, user_id, name) values ((select corp from v), '00000000-0000-0000-0000-0000000000f1', 'Roof');
insert into conversations (corporation_id, user_id, title, project_id)
  select (select corp from v), '00000000-0000-0000-0000-0000000000f1', 'Roof levy', id from conversation_projects where name = 'Roof';
insert into conversation_messages (conversation_id, role, content) select id, 'user', 'When?' from conversations where title = 'Roof levy';
insert into stratasphere_usage (corporation_id, user_id, surface, input_tokens, output_tokens, cost_usd)
  values ((select corp from v), '00000000-0000-0000-0000-0000000000f1', 'assistant', 10, 2, 0.001);
insert into strata_management (corporation_id, company_name, managers) values ((select corp from v), 'Fictional Strata Co.', '[]');
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
  values ('00000000-0000-0000-0000-0000000000f2', (select corp from v), 'active', now()),
         ('00000000-0000-0000-0000-0000000000f3', (select corp from v), 'invited', null);
insert into corporation_role_assignments (corporation_id, role, user_id) values ((select corp from v), 'treasurer', '00000000-0000-0000-0000-0000000000f2');
insert into corporation_invites (corporation_id, invited_email, invited_by) values ((select corp from v), 'friend@x.ca', '00000000-0000-0000-0000-0000000000f1');
insert into corporation_join_requests (corporation_id, requested_by) values ((select corp from v), '00000000-0000-0000-0000-0000000000f2');
update owners_and_council set full_name = 'Vera Visitor' where corporation_id = (select corp from v) and lot_number = 'SL001';

select pg_temp.expect('the accounts to delete with it are the visitor and their invitee',
  (select array_agg(u order by u) from demo_strata_people((select corp from v)) u)
    = array['00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f3']::uuid[]);

-- Midnight.
select demo_delete_strata((select corp from v));
select demo_delete_person('00000000-0000-0000-0000-0000000000f1');
select demo_delete_person('00000000-0000-0000-0000-0000000000f3');

do $$
declare t record; c bigint;
begin
  for t in select tbl, n from before_counts loop
    execute format('select count(*) from %s', t.tbl) into c;
    if t.tbl in ('public.profiles') then
      -- The fictional person stays; the visitor and invitee are gone.
      if c <> t.n + 1 then raise exception 'FAILED: profiles has % rows, expected %', c, t.n + 1; end if;
    elsif t.tbl = 'public.demo_cast' then
      if c <> t.n + 1 then raise exception 'FAILED: the fictional person was deleted'; end if;
    elsif c <> t.n then
      raise exception 'FAILED: % has % rows after the clean-up, % before the visitor', t.tbl, c, t.n;
    end if;
  end loop;
  raise notice 'OK: every table is back to how it was';
end $$;
select pg_temp.expect('the other strata is untouched', exists (select 1 from strata_corporations where strata_plan_number = 'BCS-1234'));
select pg_temp.expect('the visitor row stays (for a week)', exists (select 1 from demo_visitors));

select pg_temp.expect('a real strata can''t be deleted here', pg_temp.fails($q$select demo_delete_strata('BCS-1234')$q$, 'Only a demo strata'));
select pg_temp.expect('nor a Super Admin', pg_temp.fails($q$select demo_delete_person('00000000-0000-0000-0000-00000000000d')$q$, 'Only a visitor'));
select pg_temp.expect('nor a fictional person', pg_temp.fails($q$select demo_delete_person('00000000-0000-0000-0000-0000000000f2')$q$, 'Only a visitor'));
