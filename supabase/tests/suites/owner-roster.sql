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
grant execute on all functions in schema public to authenticated;
create temp table t0 as select lot_number, updated_at from owners_and_council;
grant select on t0 to authenticated;
set role authenticated;

-- Bob is admin of BCS-1234 (after flow.sql); Cara is a plain member
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('first upload: 2 lots, 3 fields',
  (select (lots_changed, fields_changed) = (2, 3) from apply_owner_roster_upload('BCS-1234',
    '[{"lot_number":"SL001","full_name":"Ann Owner","strata_fees":350},{"lot_number":"SL002","email":"b@x.ca"}]')));
select pg_temp.expect('SL003 untouched, updated_at unchanged',
  (select o.updated_at = t0.updated_at from owners_and_council o join t0 using (lot_number) where lot_number='SL003'));
create temp table t1 as select lot_number, updated_at from owners_and_council;
select pg_temp.expect('re-uploading the same file changes nothing (350.00 = 350)',
  (select (lots_changed, fields_changed) = (0, 0) from apply_owner_roster_upload('BCS-1234',
    '[{"lot_number":"SL001","full_name":"Ann Owner","strata_fees":"350.00"},{"lot_number":"SL002","email":"b@x.ca"}]')));
select pg_temp.expect('no-op upload leaves updated_at alone',
  (select bool_and(o.updated_at = t1.updated_at) from owners_and_council o join t1 using (lot_number)));
select pg_temp.expect('blank cells never clear',
  (select (lots_changed, fields_changed) = (1, 1) from apply_owner_roster_upload('BCS-1234',
    '[{"lot_number":"SL001","full_name":null,"strata_fees":null,"unit_number":"101"}]')));
select pg_temp.expect('name and fee kept, unit set',
  (select full_name = 'Ann Owner' and strata_fees = 350 and unit_number = '101' from owners_and_council where lot_number='SL001'));

-- whole-file rejection
select pg_temp.expect_error($$select apply_owner_roster_upload('BCS-1234','[{"lot_number":"SL003","full_name":"Should Not Land"},{"lot_number":"SL009","full_name":"X"}]')$$, 'SL009');
select pg_temp.expect('rejected file changed nothing', (select full_name is null from owners_and_council where lot_number='SL003'));
select pg_temp.expect_error($$select apply_owner_roster_upload('BCS-1234','[{"lot_number":"SL001","full_name":"A"},{"lot_number":"SL001","full_name":"B"}]')$$, 'more than once');
select pg_temp.expect_error($$select apply_owner_roster_upload('BCS-1234','[{"lot_number":"SL001","owner_type":"landlord"}]')$$, 'owner_type');

-- governance fields are out of an upload's reach
update owners_and_council set is_council_member = true, role = 'treasurer' where corporation_id='BCS-1234' and lot_number='SL002';
select apply_owner_roster_upload('BCS-1234','[{"lot_number":"SL002","is_council_member":false,"role":null,"council_member_name":"Hacker","full_name":"Bo Owner"}]');
select pg_temp.expect('council flag/role/delegate untouched by upload',
  (select is_council_member and role = 'treasurer' and council_member_name is null and full_name = 'Bo Owner' from owners_and_council where lot_number='SL002'));

-- non-admin member
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('member can read the roster', (select count(*) from owners_and_council where corporation_id='BCS-1234') = 3);
select pg_temp.expect_error($$select apply_owner_roster_upload('BCS-1234','[{"lot_number":"SL001","full_name":"Mallory"}]')$$, 'Only this strata''s admin');
update owners_and_council set full_name = 'Mallory' where lot_number='SL001';
select pg_temp.expect('member direct edit blocked by RLS', (select full_name = 'Ann Owner' from owners_and_council where lot_number='SL001'));

-- outsider
set test.uid = '00000000-0000-0000-0000-00000000000e';
select pg_temp.expect('outsider cannot read the roster', (select count(*) from owners_and_council) = 0);
