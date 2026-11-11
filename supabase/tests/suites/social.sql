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
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated, anon;

-- 0068: social posts are server-only, even for Super Admins.
insert into social_posts (title, campaign) values ('First meeting', 'first-meeting');
select pg_temp.expect_error($q$insert into social_posts (campaign) values ('Not A Slug')$q$, 'social_posts_campaign_check');
select pg_temp.expect_error($q$insert into social_posts (campaign, template) values ('ok', 'poster')$q$, 'social_posts_template_check');
select pg_temp.expect_error($q$insert into social_posts (campaign, slides) values ('ok', '{}'::jsonb)$q$, 'social_posts_slides_check');
select pg_temp.expect('the bucket is private', (select not public from storage.buckets where id = 'social-media'));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
set test.aal = 'aal2';
select pg_temp.expect_error($q$select count(*) from social_posts$q$, 'permission denied');
select pg_temp.expect_error($q$delete from social_posts$q$, 'permission denied');

reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from social_posts$q$, 'permission denied');

reset role;
delete from social_posts;
select pg_temp.expect('the server can delete a post', (select count(*) = 0 from social_posts));

-- 0087: saved layouts are server-only too.
reset role;
insert into social_layouts (name, design) values ('Big quote', '{"bg":"ink","layers":[],"tall":{}}');
select pg_temp.expect_error($q$insert into social_layouts (name, design) values ('', '{}')$q$, 'social_layouts_name_check');
select pg_temp.expect_error($q$insert into social_layouts (name, design) values ('x', '[]')$q$, 'social_layouts_design_check');
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select count(*) from social_layouts$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from social_layouts$q$, 'permission denied');
reset role;

-- 0088: post templates are server-only; the bucket takes video up to 200 MB.
insert into social_templates (name, slides) values ('Tips carousel', '[]');
select pg_temp.expect_error($q$insert into social_templates (name, slides) values ('', '[]')$q$, 'social_templates_name_check');
select pg_temp.expect_error($q$insert into social_templates (name, slides) values ('x', '{}')$q$, 'social_templates_slides_check');
select pg_temp.expect_error($q$insert into social_templates (name, slides, description) values ('x', '[]', repeat('a', 201))$q$, 'social_templates_description_check');
select pg_temp.expect('the bucket takes 200 MB files', (select file_size_limit = 209715200 from storage.buckets where id = 'social-media'));
select pg_temp.expect('the bucket takes MP4 and MOV', (select allowed_mime_types @> array['video/mp4', 'video/quicktime'] from storage.buckets where id = 'social-media'));
select pg_temp.expect('the bucket still takes pictures', (select allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp'] from storage.buckets where id = 'social-media'));
select pg_temp.expect('the bucket is still private', (select not public from storage.buckets where id = 'social-media'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.expect_error($q$select count(*) from social_templates$q$, 'permission denied');
select pg_temp.expect_error($q$insert into social_templates (name, slides) values ('x', '[]')$q$, 'permission denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select count(*) from social_templates$q$, 'permission denied');
reset role;
