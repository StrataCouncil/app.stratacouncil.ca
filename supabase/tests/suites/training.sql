\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text) to authenticated;

select pg_temp.expect('five tracks seeded, no modules', (select count(*) from training_tracks) = 5 and (select count(*) from training_modules) = 0);

-- Super Admin builds a two-lesson module in the General Council track, and a second, empty one.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000001', id, 1, 'What council does' from training_tracks where code = 'mal';
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000002', id, 2, 'Meetings' from training_tracks where code = 'mal';
insert into training_module_drafts (module_id, content) values
  ('10000000-0000-0000-0000-000000000001', '{"lessons":[{"id":"l1","title":"One","blocks":[]},{"id":"l2","title":"Two","blocks":[]}]}'),
  ('10000000-0000-0000-0000-000000000002', '{"lessons":[]}');
select pg_temp.expect('an empty module can''t be published', pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000002')$$));
select pg_temp.expect('publishing gives version 1', publish_training_module('10000000-0000-0000-0000-000000000001') = 1);

-- Authors: Cara is assigned to module 1 only.
insert into training_module_authors (module_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('an author sees only their module''s draft', (select array_agg(module_id) from training_module_drafts) = array['10000000-0000-0000-0000-000000000001'::uuid]);
update training_module_drafts set content = '{"lessons":[{"id":"l1","title":"One edited","blocks":[]},{"id":"l2","title":"Two","blocks":[]}]}' where module_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect('an author can edit their draft', (select content -> 'lessons' -> 0 ->> 'title' from training_module_drafts) = 'One edited');
select pg_temp.expect('an author can''t publish', pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000001')$$));
select pg_temp.expect('an author can''t add modules', pg_temp.fails($$insert into training_modules (track_id, title) select id, 'x' from training_tracks limit 1$$));

-- Xavier (no strata) sees no drafts, can read published content.
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('a learner sees no drafts', (select count(*) from training_module_drafts) = 0);
select pg_temp.expect('a learner sees published versions', (select count(*) from training_module_versions) = 1);
select pg_temp.expect('a learner can''t write progress directly',
  pg_temp.fails($$insert into training_progress (user_id, module_id, version) values ('00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001', 1)$$));
select pg_temp.expect('a lesson outside the module is refused',
  pg_temp.fails($$select complete_training_lesson('10000000-0000-0000-0000-000000000001', 1, 'nope')$$));

-- Bob (admin of BCS-1234) works through module 1. Module 2 is unpublished, so no credential yet.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('first lesson: module not complete',
  (complete_training_lesson('10000000-0000-0000-0000-000000000001', 1, 'l1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('repeating a lesson is harmless',
  (select completed_lessons from training_progress where user_id = '00000000-0000-0000-0000-00000000000b') = array['l1']
  and (complete_training_lesson('10000000-0000-0000-0000-000000000001', 1, 'l1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('last lesson completes the module, no credential while a module is unpublished',
  (select r ->> 'moduleComplete' = 'true' and r ->> 'credentialEarned' = 'false'
   from complete_training_lesson('10000000-0000-0000-0000-000000000001', 1, 'l2') r));

-- Module 2 published: one lesson to go, then the credential.
set test.uid = '00000000-0000-0000-0000-00000000000d';
update training_module_drafts set content = '{"lessons":[{"id":"m1","title":"Only","blocks":[]}]}' where module_id = '10000000-0000-0000-0000-000000000002';
select publish_training_module('10000000-0000-0000-0000-000000000002');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('finishing every module earns the track credential',
  (complete_training_lesson('10000000-0000-0000-0000-000000000002', 1, 'm1') ->> 'credentialEarned')::boolean);
select pg_temp.expect('the learner sees their credential', (select count(*) from training_credentials) = 1);

-- Republishing never takes the credential back or reopens a finished module.
set test.uid = '00000000-0000-0000-0000-00000000000d';
update training_module_drafts set content = '{"lessons":[{"id":"m1","title":"Only","blocks":[]},{"id":"m2","title":"New","blocks":[]}]}' where module_id = '10000000-0000-0000-0000-000000000002';
select pg_temp.expect('republishing gives version 2', publish_training_module('10000000-0000-0000-0000-000000000002') = 2);
reset role;
select pg_temp.expect('the credential stays after a revision', exists (select 1 from training_credentials where user_id = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.expect('the finished module stays finished',
  (select completed_at is not null from training_progress where user_id = '00000000-0000-0000-0000-00000000000b' and module_id = '10000000-0000-0000-0000-000000000002'));

-- Who can see Bob's credential and progress.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';  -- active member of BCS-1234
select pg_temp.expect('a strata-mate sees the credential', (select count(*) from training_credentials) = 1);
select pg_temp.expect('a strata-mate never sees progress', (select count(*) from training_progress) = 0);
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('an outsider sees no one''s credential', (select count(*) from training_credentials) = 0);
select pg_temp.expect('learners can''t edit tracks', pg_temp.fails($$delete from training_tracks$$) or (select count(*) from training_tracks) = 5);
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('Super Admin sees every credential', (select count(*) from training_credentials) = 1);
