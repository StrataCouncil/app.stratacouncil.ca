\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text) to authenticated;

select pg_temp.expect('four tracks', (select count(*) from training_tracks) = 4);
select pg_temp.expect('the curriculum: 17 unpublished modules, each with a draft, objectives and further reading',
  (select count(*) from training_modules where curriculum_key is not null and published_version = 0) = 17
  and (select count(*) from training_module_drafts d join training_modules m on m.id = d.module_id
       where jsonb_array_length(d.content -> 'objectives') >= 3 and jsonb_array_length(d.content -> 'furtherReading') >= 2) = 17);
select pg_temp.expect('3 + 6 + 4 + 4 modules by track',
  (select array_agg(n order by o) from (select t.order_index o, count(*) n from training_modules m join training_tracks t on t.id = m.track_id group by t.order_index) x)
  = array[3, 6, 4, 4]::bigint[]);
select pg_temp.expect('every further reading link is https',
  not exists (select 1 from training_module_drafts d, jsonb_array_elements(d.content -> 'furtherReading') r where r ->> 'url' not like 'https://%'));
select pg_temp.expect('0039: every curriculum module has one to three objectives',
  not exists (select 1 from training_module_drafts d join training_modules m on m.id = d.module_id
              where m.curriculum_key is not null and jsonb_array_length(d.content -> 'objectives') not between 1 and 3));
select pg_temp.expect('0039: Strata Basics 2 is the rules a strata lives by',
  (select title from training_modules where curriculum_key = 'sb2') = 'The rules a strata lives by');
-- An author's own objectives survive a re-run of 0039.
update training_module_drafts set content = jsonb_set(content, '{objectives}', '["My own objective"]')
  where module_id = (select id from training_modules where curriculum_key = 'cr1');
\i supabase/migrations/0039_training_objectives.sql
select pg_temp.expect('0039 leaves edited objectives alone',
  (select content -> 'objectives' from training_module_drafts where module_id = (select id from training_modules where curriculum_key = 'cr1')) = '["My own objective"]'::jsonb);
-- The checks below build their own modules from scratch.
delete from training_modules;
select pg_temp.expect('tracks in curriculum order',
  (select array_agg(code order by order_index) from training_tracks) = array['strata_basics','council_ready','treasurer','secretary']);
select pg_temp.expect('Council Ready needs Strata Basics; the specialty tracks need Council Ready',
  (select count(*) from training_tracks t join training_tracks r on r.id = t.requires_track_id
   where (t.code = 'council_ready' and r.code = 'strata_basics')
      or (t.code in ('treasurer','secretary') and r.code = 'council_ready' and t.stage = 'specialty')) = 3);

-- Super Admin builds a two-section module in the Council Ready track, and a second, empty one.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000001', id, 1, 'What council does' from training_tracks where code = 'council_ready';
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000002', id, 2, 'Meetings' from training_tracks where code = 'council_ready';
insert into training_module_drafts (module_id, content) values
  ('10000000-0000-0000-0000-000000000001', '{"sections":[{"id":"l1","title":"One","screens":[]},{"id":"l2","title":"Two","screens":[]}]}'),
  ('10000000-0000-0000-0000-000000000002', '{"sections":[]}');
select pg_temp.expect('an empty module can''t be published', pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000002')$$));
select pg_temp.expect('publishing gives version 1', publish_training_module('10000000-0000-0000-0000-000000000001') = 1);

-- Authors: Cara is assigned to module 1 only.
insert into training_module_authors (module_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('an author sees only their module''s draft', (select array_agg(module_id) from training_module_drafts) = array['10000000-0000-0000-0000-000000000001'::uuid]);
update training_module_drafts set content = '{"sections":[{"id":"l1","title":"One edited","screens":[]},{"id":"l2","title":"Two","screens":[]}]}' where module_id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect('an author can edit their draft', (select content -> 'sections' -> 0 ->> 'title' from training_module_drafts) = 'One edited');
select pg_temp.expect('an author can''t publish', pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000001')$$));
select pg_temp.expect('an author can''t add modules', pg_temp.fails($$insert into training_modules (track_id, title) select id, 'x' from training_tracks limit 1$$));

-- Xavier (no strata) sees no drafts, can read published content.
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('a learner sees no drafts', (select count(*) from training_module_drafts) = 0);
select pg_temp.expect('a learner sees published versions', (select count(*) from training_module_versions) = 1);
select pg_temp.expect('a learner can''t write progress directly',
  pg_temp.fails($$insert into training_progress (user_id, module_id, version) values ('00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001', 1)$$));
select pg_temp.expect('a section outside the module is refused',
  pg_temp.fails($$select complete_training_section('10000000-0000-0000-0000-000000000001', 1, 'nope')$$));

-- Bob (admin of BCS-1234) works through module 1. Module 2 is unpublished, so no credential yet.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('first section: module not complete',
  (complete_training_section('10000000-0000-0000-0000-000000000001', 1, 'l1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('repeating a section is harmless',
  (select completed_sections from training_progress where user_id = '00000000-0000-0000-0000-00000000000b') = array['l1']
  and (complete_training_section('10000000-0000-0000-0000-000000000001', 1, 'l1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('last section completes the module, no credential while a module is unpublished',
  (select r ->> 'moduleComplete' = 'true' and r ->> 'credentialEarned' = 'false'
   from complete_training_section('10000000-0000-0000-0000-000000000001', 1, 'l2') r));

-- Module 2 published: one section to go, then the credential.
set test.uid = '00000000-0000-0000-0000-00000000000d';
update training_module_drafts set content = '{"sections":[{"id":"m1","title":"Only","screens":[]}]}' where module_id = '10000000-0000-0000-0000-000000000002';
select publish_training_module('10000000-0000-0000-0000-000000000002');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('finishing every module earns the track credential',
  (complete_training_section('10000000-0000-0000-0000-000000000002', 1, 'm1') ->> 'credentialEarned')::boolean);
select pg_temp.expect('the learner sees their credential', (select count(*) from training_credentials) = 1);

-- Republishing never takes the credential back or reopens a finished module.
set test.uid = '00000000-0000-0000-0000-00000000000d';
update training_module_drafts set content = '{"sections":[{"id":"m1","title":"Only","screens":[]},{"id":"m2","title":"New","screens":[]}]}' where module_id = '10000000-0000-0000-0000-000000000002';
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
select pg_temp.expect('learners can''t edit tracks', pg_temp.fails($$delete from training_tracks$$) or (select count(*) from training_tracks) = 4);
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('Super Admin sees every credential', (select count(*) from training_credentials) = 1);

-- AI imports are Super Admin only.
reset role;
insert into training_imports (id, title) values ('20000000-0000-0000-0000-000000000001', 'Guide');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('Super Admin sees imports', (select count(*) from training_imports) = 1);
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('a strata admin sees no imports', (select count(*) from training_imports) = 0);
select pg_temp.expect('and can''t start one', pg_temp.fails($$insert into training_imports (title) values ('x')$$));
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('an author sees no imports', (select count(*) from training_imports) = 0);

-- The library search for the AI builder (0037) is server only.
select pg_temp.expect('learners can''t search the library for training',
  pg_temp.fails($$select * from match_library_for_training(array_fill(0.1, array[1024])::text::extensions.vector, 5, 0.1)$$));
reset role;
select pg_temp.expect('the server can',
  has_function_privilege('service_role', 'public.match_library_for_training(extensions.vector, integer, double precision)', 'execute')
  and not has_function_privilege('authenticated', 'public.match_library_for_training(extensions.vector, integer, double precision)', 'execute'));
select pg_temp.expect('fact checks live on the draft, where only staff and authors can read them',
  exists (select 1 from information_schema.columns where table_name = 'training_module_drafts' and column_name = 'fact_check')
  and not exists (select 1 from information_schema.columns where table_name = 'training_modules' and column_name = 'fact_check'));

-- One narration voice for every module (0038).
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('anyone signed in reads the default voice', (select count(*) from training_settings) = 1);
update training_settings set narration_voice = '{"id":"x","name":"X"}';
reset role;
select pg_temp.expect('learners can''t change it', (select narration_voice from training_settings) is null);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
update training_settings set narration_voice = '{"id":"x","name":"X"}';
reset role;
select pg_temp.expect('a Super Admin can', (select narration_voice ->> 'id' from training_settings) = 'x');
reset role;
