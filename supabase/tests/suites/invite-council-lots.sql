\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
-- Council members typed on the Owners page: no accounts.
update owners_and_council set is_council_member = true, role = 'treasurer', council_member_name = 'Xavier Typed', council_email = 'x@x.ca'
  where corporation_id = 'BCS-1234' and lot_number = 'SL002';
update owners_and_council set is_council_member = true, role = null, council_member_name = 'Tess Typed'
  where corporation_id = 'BCS-1234' and lot_number = 'SL003';
-- Invited from SL002's row: the invite, and the invited membership holding the lot.
insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234', 'x@x.ca', '00000000-0000-0000-0000-00000000000b');
insert into corporation_memberships (user_id, corporation_id, status, invited_by, lot_number)
  values ('00000000-0000-0000-0000-00000000000e', 'BCS-1234', 'invited', '00000000-0000-0000-0000-00000000000b', 'SL002');
-- Anything that syncs lot flags meanwhile (here, another member's role change) leaves SL002 alone.
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000b',
  (select array_agg(role) from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000b'));
select pg_temp.expect('a pending invite keeps the typed council lot',
  (select is_council_member and role = 'treasurer' and council_member_name = 'Xavier Typed' from owners_and_council where corporation_id = 'BCS-1234' and lot_number = 'SL002'));
-- Xavier accepts (the invite's id comes from the admin's side, as in the emailed link).
select id as invite_id from corporation_invites where invited_email = 'x@x.ca' and corporation_id = 'BCS-1234' \gset
set test.uid = '00000000-0000-0000-0000-00000000000e';
select accept_corporation_invite(:'invite_id');
reset role;
select pg_temp.expect('accepting ties the member to the lot',
  (select status = 'active' and lot_number = 'SL002' from corporation_memberships where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000e'));
select pg_temp.expect('and gives them the lot''s council role (or Member at Large if it''s held)',
  exists (select 1 from corporation_role_assignments where corporation_id = 'BCS-1234' and user_id = '00000000-0000-0000-0000-00000000000e' and role in ('treasurer', 'member_at_large')));
select pg_temp.expect('the lot stays a council lot, under the member''s own name',
  (select is_council_member and council_member_name = 'Xavier Outsider' from owners_and_council where corporation_id = 'BCS-1234' and lot_number = 'SL002'));
select pg_temp.expect('other typed council lots are untouched',
  (select is_council_member and role is null and council_member_name = 'Tess Typed' from owners_and_council where corporation_id = 'BCS-1234' and lot_number = 'SL003'));
