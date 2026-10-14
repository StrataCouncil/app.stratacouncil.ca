\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000d';  -- Sam, Super Admin, not a member of BCS-1234
set test.aal = 'aal1';                                  -- signed in by link only
select pg_temp.expect('a Super Admin without two-step verification has no Super Admin powers', not is_super_admin());
select pg_temp.expect('and can''t read a strata they don''t belong to', (select count(*) from strata_corporations where strata_plan_number = 'BCS-1234') = 0);
set test.aal = 'aal2';                                  -- after the authenticator code
select pg_temp.expect('with two-step verification, Super Admin powers apply', is_super_admin());
select pg_temp.expect('and the strata can be read for support', (select count(*) from strata_corporations where strata_plan_number = 'BCS-1234') = 1);
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, an ordinary member
set test.aal = 'aal1';
select pg_temp.expect('ordinary members are unchanged without two-step verification', (select count(*) from strata_corporations where strata_plan_number = 'BCS-1234') = 1);
