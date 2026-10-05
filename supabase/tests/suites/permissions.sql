\set ON_ERROR_STOP 1
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select 'member sees memberships: ' || count(*) from corporation_memberships;
select 'member sees own corp: ' || count(*) from strata_corporations;
do $$ begin
  update profiles set is_super_admin = true where id = auth.uid();
  raise exception 'FAILED: could set is_super_admin';
exception when insufficient_privilege then raise notice 'OK refused is_super_admin self-grant'; end $$;
update profiles set full_name = 'Bob B' where id = auth.uid();
select 'name update ok: ' || full_name from profiles where id = auth.uid();
