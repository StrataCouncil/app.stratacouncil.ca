\set ON_ERROR_STOP 1
-- Deleting a strata or an account from the Super Admin console (0047):
-- a dry run first that deletes nothing, then the delete, which leaves
-- every other strata alone. Visitors can't call either.
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text, needle text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;

select pg_temp.expect('visitors can''t delete stratas or accounts',
  not has_function_privilege('authenticated', 'public.platform_delete_strata(text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.platform_delete_person(uuid, boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.platform_delete_rows(regclass, text, boolean, regclass[])', 'execute'));
select pg_temp.expect('the old training demo tables are gone',
  to_regclass('public.training_demo_links') is null and to_regclass('public.training_feedback') is null);

-- A second strata, EPS-9048, made by Xavier (e) through the real flow.
insert into documents (id, category, title, storage_path, uploaded_by)
  values ('22222222-2222-2222-2222-222222222222', 'legal_governance', 'plan', 'strata-plans/e/p.pdf', '00000000-0000-0000-0000-00000000000e');
insert into corporation_creation_requests (strata_plan_document_id, parsed_strata_plan_number, parsed_legal_name, parsed_address, parsed_unit_count, parsed_jurisdiction, requested_by, attestation_full_name, attestation_confirmed)
  values ('22222222-2222-2222-2222-222222222222', 'EPS-9048', 'The Owners, SP EPS9048', '9 Test St', 4, 'BC', '00000000-0000-0000-0000-00000000000e', 'Xavier', true);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select approve_corporation_creation_request((select id from corporation_creation_requests where parsed_strata_plan_number = 'EPS-9048'), 'EPS-9048', 'The Owners, Strata Plan EPS9048', '9 Test St', 4, 'BC');
reset role;

create temp table before_other as
  select (select count(*) from strata_corporations where strata_plan_number = 'BCS-1234') corps,
         (select count(*) from corporation_memberships where corporation_id = 'BCS-1234') members,
         (select count(*) from owners_and_council where corporation_id = 'BCS-1234') lots,
         (select count(*) from documents where corporation_id = 'BCS-1234') docs;

create temp table plan as select * from platform_delete_strata('EPS-9048', true);
select pg_temp.expect('the dry run lists the strata and its rows',
  (select n from plan where tbl = 'strata_corporations') = 1
  and (select n from plan where tbl = 'owners_and_council') = 4
  and (select n from plan where tbl = 'documents') >= 1);
select pg_temp.expect('and deletes nothing', exists (select 1 from strata_corporations where strata_plan_number = 'EPS-9048'));

select pg_temp.expect('Xavier can''t be deleted while he''s in a strata',
  pg_temp.fails($$select * from platform_delete_person('00000000-0000-0000-0000-00000000000e', true)$$, 'still belongs to EPS-9048'));

insert into subscriptions (corporation_id, status, stripe_subscription_id) values ('EPS-9048', 'active', 'sub_test')
  on conflict (corporation_id) do update set status = 'active', stripe_subscription_id = 'sub_test';
select pg_temp.expect('a strata paying through Stripe can''t be deleted',
  pg_temp.fails($$select * from platform_delete_strata('EPS-9048', false)$$, 'Cancel it in Stripe first'));
update subscriptions set status = 'deactivated' where corporation_id = 'EPS-9048';

select * from platform_delete_strata('EPS-9048', false);
select pg_temp.expect('the strata is gone, with its rows',
  not exists (select 1 from strata_corporations where strata_plan_number = 'EPS-9048')
  and not exists (select 1 from corporation_memberships where corporation_id = 'EPS-9048')
  and not exists (select 1 from documents where id = '22222222-2222-2222-2222-222222222222')
  and not exists (select 1 from corporation_creation_requests where parsed_strata_plan_number = 'EPS-9048'));
select pg_temp.expect('the other strata is untouched',
  (select row(corps, members, lots, docs) from before_other) =
  (select row((select count(*) from strata_corporations where strata_plan_number = 'BCS-1234'),
              (select count(*) from corporation_memberships where corporation_id = 'BCS-1234'),
              (select count(*) from owners_and_council where corporation_id = 'BCS-1234'),
              (select count(*) from documents where corporation_id = 'BCS-1234'))));

create temp table person_plan as select * from platform_delete_person('00000000-0000-0000-0000-00000000000e', true);
select pg_temp.expect('Xavier''s dry run lists his profile', (select n from person_plan where tbl = 'profiles') = 1);
select * from platform_delete_person('00000000-0000-0000-0000-00000000000e', false);
select pg_temp.expect('then he''s gone', not exists (select 1 from profiles where id = '00000000-0000-0000-0000-00000000000e'));

select pg_temp.expect('a Super Admin can''t be deleted',
  pg_temp.fails($$select * from platform_delete_person('00000000-0000-0000-0000-00000000000d', true)$$, 'Super Admin'));
select pg_temp.expect('nor someone still in a strata',
  pg_temp.fails($$select * from platform_delete_person('00000000-0000-0000-0000-00000000000b', true)$$, 'still belongs to BCS-1234'));
select pg_temp.expect('nor someone who left a strata but has records in it (invites they sent)',
  pg_temp.fails($$select * from platform_delete_person('00000000-0000-0000-0000-00000000000a', true)$$, 'has records in BCS-1234'));
select pg_temp.expect('a strata that isn''t there says so',
  pg_temp.fails($$select * from platform_delete_strata('EPS-0000', true)$$, 'no strata EPS-0000'));
