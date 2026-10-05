\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.fails(sql text, needle text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return position(needle in sqlerrm) > 0; end $$;
grant execute on function pg_temp.expect(text,boolean), pg_temp.fails(text,text) to authenticated;
create temp view admins as select string_agg(right(user_id::text, 1), ',' order by user_id) a from corporation_role_assignments where corporation_id = 'BCS-1234' and role = 'admin';
grant select on admins to authenticated;
-- After setup: Bob (b) is the only admin; Cara (c) and member f are active.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['admin']);
select pg_temp.expect('a second admin is added, not moved', (select a from admins) = 'b,c');
select pg_temp.expect('a third admin is refused',
  pg_temp.fails($$select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['admin'])$$, 'at most two admins'));
set test.uid = '00000000-0000-0000-0000-00000000000c';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b', array['manager']);
select pg_temp.expect('an admin can take Admin off the other admin', (select a from admins) = 'c');
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['admin', 'treasurer', 'president']);
select pg_temp.expect('two admins again', (select a from admins) = 'c,f');
select pg_temp.expect('one person holds two offices', (select count(*) = 2 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f' and role in ('treasurer', 'president')));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['admin', 'president']);
select pg_temp.expect('an office still moves from its holder', not exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000f' and role = 'president'));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['president']);
select pg_temp.expect('an admin can step down while another remains', (select a from admins) = 'f');
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect('the last admin can''t step down',
  pg_temp.fails($$select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['treasurer'])$$, 'always needs an admin'));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['secretary', 'member_at_large']);
select pg_temp.expect('an office still ends Member at Large', not exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000c' and role = 'member_at_large'));
reset role;
select pg_temp.expect('a direct third admin row is refused too',
  pg_temp.fails($$insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'admin', '00000000-0000-0000-0000-00000000000b'), ('BCS-1234', 'admin', '00000000-0000-0000-0000-00000000000c')$$, 'at most two admins'));
