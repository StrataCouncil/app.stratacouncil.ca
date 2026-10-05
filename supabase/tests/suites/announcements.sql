\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text) to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin
insert into announcements (title, body) values ('For everyone', 'Hello');
insert into announcements (title, body, audience) values ('For admins', 'Admins only', 'admins');
insert into announcements (title, body, expires_at) values ('Ended', 'Gone', now() - interval '1 day');
insert into announcements (title, body, published_at) values ('Scheduled', 'Later', now() + interval '1 day');
select pg_temp.expect('super admin sees what is current for them, plus manages all', (select count(*) from announcements) = 4);
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
select pg_temp.expect('a strata admin sees everyone + admins, nothing ended or scheduled',
  (select array_agg(title order by title) from announcements) = array['For admins', 'For everyone']);
select pg_temp.expect('a strata admin can''t post', pg_temp.fails($$insert into announcements (title, body) values ('x', 'y')$$));
set test.uid = '00000000-0000-0000-0000-00000000000e';  -- outsider, no strata
select pg_temp.expect('anyone else sees only the everyone one', (select array_agg(title) from announcements) = array['For everyone']);
update announcements set title = 'Hijacked';
select pg_temp.expect('and can''t edit it', not exists (select 1 from announcements where title = 'Hijacked'));
reset role;
select pg_temp.expect('links must be https', pg_temp.fails($$insert into announcements (title, body, link_url) values ('x', 'y', 'http://a.ca')$$));
