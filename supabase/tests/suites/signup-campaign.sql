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

-- 0066: the campaign tags a sign-up came with are saved on the profile.
insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-0000-0000-0000-000000000001', 'tagged@x.ca',
   '{"full_name":"Tagged","campaign":{"utm_source":"facebook","utm_medium":"social","utm_campaign":"council-duties","utm_content":"2026-10-27"}}'),
  ('66666666-0000-0000-0000-000000000002', 'plain@x.ca', '{"full_name":"Plain"}'),
  ('66666666-0000-0000-0000-000000000003', 'odd@x.ca',
   ('{"full_name":"Odd","campaign":{"utm_source":"  linkedin  ","utm_term":"","evil":"x","utm_medium":42,"utm_campaign":"' || repeat('c', 300) || '"}}')::jsonb),
  ('66666666-0000-0000-0000-000000000004', 'notobj@x.ca', '{"full_name":"NotObj","campaign":"facebook"}');

select pg_temp.expect('the tags are saved',
  (select signup_campaign = '{"utm_source":"facebook","utm_medium":"social","utm_campaign":"council-duties","utm_content":"2026-10-27"}'::jsonb
   from profiles where id = '66666666-0000-0000-0000-000000000001'));
select pg_temp.expect('no tags, no campaign',
  (select signup_campaign is null from profiles where id = '66666666-0000-0000-0000-000000000002'));
select pg_temp.expect('only the five utm keys, only non-empty strings, trimmed',
  (select signup_campaign ?& array['utm_source','utm_campaign'] and not signup_campaign ? 'evil'
     and not signup_campaign ? 'utm_term' and not signup_campaign ? 'utm_medium'
     and signup_campaign ->> 'utm_source' = 'linkedin'
   from profiles where id = '66666666-0000-0000-0000-000000000003'));
select pg_temp.expect('each tag is cut to 100 characters',
  (select length(signup_campaign ->> 'utm_campaign') = 100 from profiles where id = '66666666-0000-0000-0000-000000000003'));
select pg_temp.expect('a campaign that is not an object is ignored',
  (select signup_campaign is null from profiles where id = '66666666-0000-0000-0000-000000000004'));
select pg_temp.expect('name and opt-in still saved as before',
  (select full_name = 'Tagged' and marketing_opt_in = false from profiles where id = '66666666-0000-0000-0000-000000000001'));

set role authenticated;
set test.uid = '66666666-0000-0000-0000-000000000001';
select pg_temp.expect('the user can read their own tags',
  (select signup_campaign ->> 'utm_source' = 'facebook' from profiles where id = '66666666-0000-0000-0000-000000000001'));
select pg_temp.expect_error($q$update profiles set signup_campaign = '{"utm_source":"x"}' where id = '66666666-0000-0000-0000-000000000001'$q$, 'permission denied');
select pg_temp.expect_error($q$select signup_campaign_from('{}'::jsonb)$q$, 'permission denied');
reset role;
