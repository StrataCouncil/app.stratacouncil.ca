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
-- 0041: objectives come across to the module itself, each with a Bloom level from its verb.
select pg_temp.expect('0041: every curriculum module has its objectives, each with a Bloom level',
  not exists (select 1 from training_modules where curriculum_key is not null
              and (jsonb_array_length(objectives) not between 1 and 3
                   or exists (select 1 from jsonb_array_elements(objectives) o
                              where o ->> 'bloom' not in ('remember','understand','apply','analyze','evaluate','create')))));
select pg_temp.expect('0041: "Explain ..." is Understand, "Apply ..." is Apply',
  (select objectives -> 0 ->> 'bloom' from training_modules where curriculum_key = 'sb3') = 'understand'
  and exists (select 1 from training_modules, jsonb_array_elements(objectives) o
              where curriculum_key = 'cr1' and o ->> 'text' like 'Apply%' and o ->> 'bloom' = 'apply'));
select pg_temp.expect('0041: further reading comes across',
  (select jsonb_array_length(further_reading) from training_modules where curriculum_key = 'sb2') >= 2);
-- The checks below build their own modules from scratch.
delete from training_modules;
select pg_temp.expect('tracks in curriculum order',
  (select array_agg(code order by order_index) from training_tracks) = array['strata_basics','council_ready','treasurer','secretary']);
select pg_temp.expect('Council Ready needs Strata Basics; the specialty tracks need Council Ready',
  (select count(*) from training_tracks t join training_tracks r on r.id = t.requires_track_id
   where (t.code = 'council_ready' and r.code = 'strata_basics')
      or (t.code in ('treasurer','secretary') and r.code = 'council_ready' and t.stage = 'specialty')) = 3);

-- Super Admin builds a module with two topics in the Council Ready track, and a second, empty one.
-- Slides are written by the server (service role) after its checkout check.
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000001', id, 1, 'What council does' from training_tracks where code = 'council_ready';
insert into training_modules (id, track_id, order_index, title)
  select '10000000-0000-0000-0000-000000000002', id, 2, 'Meetings' from training_tracks where code = 'council_ready';
insert into training_slides (id, module_id, position, topic, title, body) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'One', 'First', 'Text'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'Two', 'Second', 'Text');
insert into training_media (slide_id, module_id, role, kind, source, path, url) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'visual', 'image', 'upload',
   'trk/10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/picture-1.jpg', 'https://example.test/p.jpg');
select pg_temp.expect('a slide has one picture or video',
  pg_temp.fails($$insert into training_media (slide_id, module_id, role, kind, source, url) values
    ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'visual', 'image', 'unsplash', 'https://example.test/q.jpg')$$));
select pg_temp.expect('a slide''s layout is one of four',
  pg_temp.fails($$update training_slides set layout = 'sideways' where id = '30000000-0000-0000-0000-000000000001'$$));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
select pg_temp.expect('Super Admin reads slides and media', (select count(*) from training_slides) = 2 and (select count(*) from training_media) = 1);
select pg_temp.expect('no one writes slides directly, not even a Super Admin',
  pg_temp.fails($$update training_slides set title = 'x' where id = '30000000-0000-0000-0000-000000000001'$$)
  and pg_temp.fails($$delete from training_media$$));
select pg_temp.expect('an empty module can''t be published',
  pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000002', '{"topics":[]}')$$));
select pg_temp.expect('publishing gives version 1',
  publish_training_module('10000000-0000-0000-0000-000000000001', '{"format":"slides","topics":[{"id":"t1","title":"One","slides":[]},{"id":"t2","title":"Two","slides":[]}]}') = 1);

-- Authors: Cara is assigned to module 1 only.
insert into training_module_authors (module_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('an author sees only their module''s slides',
  (select array_agg(distinct module_id) from training_slides) = array['10000000-0000-0000-0000-000000000001'::uuid]);
select pg_temp.expect('an author can''t publish',
  pg_temp.fails($$select publish_training_module('10000000-0000-0000-0000-000000000001', '{"topics":[{"id":"t1"}]}')$$));
select pg_temp.expect('an author can''t add modules', pg_temp.fails($$insert into training_modules (track_id, title) select id, 'x' from training_tracks limit 1$$));
select pg_temp.expect('an author can''t check a module out by writing to it directly',
  pg_temp.fails($$update training_modules set checked_out_by = '00000000-0000-0000-0000-00000000000c' where id = '10000000-0000-0000-0000-000000000001'$$)
  or (select checked_out_by from training_modules where id = '10000000-0000-0000-0000-000000000001') is null);

-- Xavier (no strata) sees no slides, can read published content.
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('a learner sees no slides or media', (select count(*) from training_slides) = 0 and (select count(*) from training_media) = 0);
select pg_temp.expect('a learner sees published versions', (select count(*) from training_module_versions) = 1);
select pg_temp.expect('a learner can''t write progress directly',
  pg_temp.fails($$insert into training_progress (user_id, module_id, version) values ('00000000-0000-0000-0000-00000000000e', '10000000-0000-0000-0000-000000000001', 1)$$));
select pg_temp.expect('a topic outside the module is refused',
  pg_temp.fails($$select complete_training_section('10000000-0000-0000-0000-000000000001', 1, 'nope')$$));

-- Bob (admin of BCS-1234) works through module 1. Module 2 is unpublished, so no credential yet.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('first topic: module not complete',
  (complete_training_section('10000000-0000-0000-0000-000000000001', 1, 't1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('repeating a topic is harmless',
  (select completed_sections from training_progress where user_id = '00000000-0000-0000-0000-00000000000b') = array['t1']
  and (complete_training_section('10000000-0000-0000-0000-000000000001', 1, 't1') ->> 'moduleComplete')::boolean = false);
select pg_temp.expect('last topic completes the module, no credential while a module is unpublished',
  (select r ->> 'moduleComplete' = 'true' and r ->> 'credentialEarned' = 'false'
   from complete_training_section('10000000-0000-0000-0000-000000000001', 1, 't2') r));

-- Module 2 published: one topic to go, then the credential.
set test.uid = '00000000-0000-0000-0000-00000000000d';
select publish_training_module('10000000-0000-0000-0000-000000000002', '{"format":"slides","topics":[{"id":"t1","title":"Only","slides":[]}]}');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('finishing every module earns the track credential',
  (complete_training_section('10000000-0000-0000-0000-000000000002', 1, 't1') ->> 'credentialEarned')::boolean);
select pg_temp.expect('the learner sees their credential', (select count(*) from training_credentials) = 1);

-- Republishing never takes the credential back or reopens a finished module.
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('republishing gives version 2',
  publish_training_module('10000000-0000-0000-0000-000000000002', '{"format":"slides","topics":[{"id":"t1","title":"Only","slides":[]},{"id":"t2","title":"New","slides":[]}]}') = 2);
reset role;
select pg_temp.expect('the credential stays after a revision', exists (select 1 from training_credentials where user_id = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.expect('the finished module stays finished',
  (select completed_at is not null from training_progress where user_id = '00000000-0000-0000-0000-00000000000b' and module_id = '10000000-0000-0000-0000-000000000002'));

-- Deleting a module takes its slides and media rows with it.
delete from training_modules where id = '10000000-0000-0000-0000-000000000001';
select pg_temp.expect('slides and media go with their module',
  not exists (select 1 from training_slides where module_id = '10000000-0000-0000-0000-000000000001')
  and not exists (select 1 from training_media where module_id = '10000000-0000-0000-0000-000000000001'));
-- An old-format publication comes down when 0041 runs (the new player only reads slides).
insert into training_module_versions (module_id, version, content) values ('10000000-0000-0000-0000-000000000002', 3, '{"sections":[{"id":"x"}]}');
update training_modules set published_version = 3 where id = '10000000-0000-0000-0000-000000000002';
\i supabase/migrations/0041_training_slides.sql
select pg_temp.expect('0041 takes down an old-format publication, and the next version number still goes up',
  (select published_version from training_modules where id = '10000000-0000-0000-0000-000000000002') = 0);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('the next publish is version 4',
  publish_training_module('10000000-0000-0000-0000-000000000002', '{"format":"slides","topics":[{"id":"t1","title":"Only","slides":[]}]}') = 4);
reset role;

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

-- Demo links and feedback (0040): Super Admins only.
reset role;
insert into training_demo_links (token, label) values ('abcdefghijklmnopqrstuvwxyz', 'BCREA');
insert into training_feedback (link_label, message) values ('BCREA', 'Screen 3 is too long');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('learners see no demo links or feedback',
  (select count(*) from training_demo_links) = 0 and (select count(*) from training_feedback) = 0);
select pg_temp.expect('and can''t make a demo link', pg_temp.fails($$insert into training_demo_links (token, label) values ('zyxwvutsrqponmlkjihgfedcba', 'x')$$));
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect('a Super Admin sees them',
  (select count(*) from training_demo_links) = 1 and (select count(*) from training_feedback) = 1);
reset role;
