\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
-- Cara is a plain member; give her Member at Large, then make her Treasurer.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, admin
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['member_at_large']);
select pg_temp.expect('member at large on its own is kept',
  exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000c' and role = 'member_at_large'));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['member_at_large', 'treasurer']);
select pg_temp.expect('treasurer drops member at large',
  (select array_agg(role order by role) from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000c') = array['treasurer']);
select pg_temp.expect('the lot shows Treasurer',
  (select role from owners_and_council o join corporation_memberships m on m.corporation_id = o.corporation_id and m.lot_number = o.lot_number
   where m.user_id = '00000000-0000-0000-0000-00000000000c' and o.corporation_id = 'BCS-1234') is distinct from 'member_at_large');
reset role;
-- Old data with both is cleaned by the migration's cleanup block.
insert into corporation_role_assignments (corporation_id, role, user_id) values ('BCS-1234', 'member_at_large', '00000000-0000-0000-0000-00000000000c');
\ir ../../migrations/0022_stratasphere_memory_and_roles.sql
select pg_temp.expect('cleanup removes member at large from executives',
  not exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000c' and role = 'member_at_large'));
