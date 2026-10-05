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
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob admin
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL002');
select pg_temp.expect('treasurer lot is a council lot', (select is_council_member and role = 'treasurer' from owners_and_council where corporation_id='BCS-1234' and lot_number='SL002'));
select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL003');
select pg_temp.expect('old lot cleared, new lot council', (select not is_council_member from owners_and_council where corporation_id='BCS-1234' and lot_number='SL002') and (select is_council_member from owners_and_council where corporation_id='BCS-1234' and lot_number='SL003'));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['member_at_large']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
select pg_temp.expect('member at large has many holders', (select count(*) = 2 from corporation_role_assignments where corporation_id='BCS-1234' and role='member_at_large'));
select pg_temp.expect('member at large lot stays council', (select is_council_member and role='member_at_large' from owners_and_council where corporation_id='BCS-1234' and lot_number='SL003'));
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array[]::text[]);
select pg_temp.expect('no council role: lot not council', (select not is_council_member from owners_and_council where corporation_id='BCS-1234' and lot_number='SL003'));
select pg_temp.expect_error($q$select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL999')$q$, 'isn''t on this');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select set_member_lot('BCS-1234', '00000000-0000-0000-0000-00000000000c', 'SL001')$q$, 'Only this strata');
reset role;
select pg_temp.expect_error($q$update owners_and_council set owner_type = 'owner' where lot_number='SL001'$q$, 'owner_type_check');
update owners_and_council set owner_type = 'owner_absentee' where corporation_id='BCS-1234' and lot_number='SL001';
insert into corporation_invites (corporation_id, invited_email, invited_by, expires_at) values ('BCS-1234','late@x.ca','00000000-0000-0000-0000-00000000000b', now() - interval '1 day');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000099','late@x.ca');
insert into profiles (id, full_name, email) values ('00000000-0000-0000-0000-000000000099','Late','late@x.ca') on conflict do nothing;
create temp table late as select id from corporation_invites where invited_email='late@x.ca';
grant select on late to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000099';
select pg_temp.expect_error($q$select accept_corporation_invite((select id from late))$q$, 'expired');
