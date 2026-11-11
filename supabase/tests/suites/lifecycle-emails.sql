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
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated, service_role;

-- 0086: lifecycle emails. Gina and Hal signed up on their own after the
-- journey was turned on; Old Olga signed up before; Ivy has a pending
-- invitation; Uma never confirmed her email.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
 ('86000000-0000-0000-0000-000000000001', 'gina@x.ca', '{"full_name":"Gina New"}', now() - interval '2 hours'),
 ('86000000-0000-0000-0000-000000000002', 'hal@x.ca', '{"full_name":"Hal New"}', now() - interval '3 days'),
 ('86000000-0000-0000-0000-000000000003', 'olga@x.ca', '{"full_name":"Old Olga"}', now() - interval '20 days'),
 ('86000000-0000-0000-0000-000000000004', 'ivy@x.ca', '{"full_name":"Ivy Invited"}', now() - interval '1 day'),
 ('86000000-0000-0000-0000-000000000005', 'uma@x.ca', '{"full_name":"Uma Unconfirmed"}', null);

select pg_temp.expect('every profile has its own unsubscribe token',
  (select count(distinct email_token) = count(*) from profiles));
select pg_temp.expect('the sign-up journey starts off', (select not enabled from email_journeys where journey = 'signup'));
select pg_temp.expect('off: nobody is in it', (select count(*) = 0 from lifecycle_signup_people()));

update email_journeys set enabled = true, turned_on_at = now() - interval '10 days' where journey = 'signup';
insert into corporation_invites (corporation_id, invited_email, invited_by)
values ('BCS-1234', 'IVY@x.ca', '00000000-0000-0000-0000-00000000000a');

select pg_temp.expect('on: only people who confirmed since it was turned on, with no strata or invitation',
  (select array_agg(email order by email) = array['gina@x.ca', 'hal@x.ca'] from lifecycle_signup_people()));
select pg_temp.expect('the seed''s members, Super Admin, and outsider never confirmed after it was turned on, so they''re out',
  (select count(*) = 0 from lifecycle_signup_people() where email like '%@x.ca' and email not in ('gina@x.ca', 'hal@x.ca')));

-- Where Hal stands: started a module, sent the welcome.
insert into email_sends (user_id, journey, step, subject, accepted)
values ('86000000-0000-0000-0000-000000000002', 'signup', 'welcome', 'Welcome to StrataCouncil.ca', true);
select pg_temp.expect_error($q$insert into email_sends (user_id, journey, step) values ('86000000-0000-0000-0000-000000000002', 'signup', 'welcome')$q$, 'duplicate key');
insert into corporation_join_requests (corporation_id, requested_by) values ('BCS-1234', '86000000-0000-0000-0000-000000000002');
select pg_temp.expect('Hal''s facts: welcome sent, join request waiting',
  (select steps_sent = array['welcome'] and pending_join and not pending_creation and last_sent_at is not null
     from lifecycle_signup_people() where email = 'hal@x.ca'));

-- Joining a strata takes him out.
insert into corporation_memberships (user_id, corporation_id, status, joined_at)
values ('86000000-0000-0000-0000-000000000002', 'BCS-1234', 'active', now());
select pg_temp.expect('a member of a strata is past setup tips', (select count(*) = 0 from lifecycle_signup_people() where email = 'hal@x.ca'));

-- Gina stops setup tips from the link in an email.
select email_token as gina_token from profiles where email = 'gina@x.ca' \gset
set role service_role;
select pg_temp.expect('a wrong token matches nobody', not unsubscribe_setup_tips(gen_random_uuid()));
select pg_temp.expect('her token stops setup tips',
  unsubscribe_setup_tips(:'gina_token'));
reset role;
select pg_temp.expect('and she''s out', (select count(*) = 0 from lifecycle_signup_people() where email = 'gina@x.ca'));

-- She turns them back on, and product news too, from the Account page.
set role authenticated;
set test.uid = '86000000-0000-0000-0000-000000000001';
select set_my_email_preferences(true, true);
reset role;
select pg_temp.expect('setup tips back on, product news on with the date',
  (select setup_emails_off_at is null and marketing_opt_in and marketing_opt_in_at is not null from profiles where email = 'gina@x.ca'));
set role authenticated;
select set_my_email_preferences(false, false);
reset role;
select pg_temp.expect('both off: the opt-in date is cleared',
  (select setup_emails_off_at is not null and not marketing_opt_in and marketing_opt_in_at is null from profiles where email = 'gina@x.ca'));
set role authenticated;
set test.uid = '';
select pg_temp.expect_error('select set_my_email_preferences(true, true)', 'Sign in first');
reset role;

select pg_temp.expect('server-only tables and functions',
  not has_table_privilege('authenticated', 'public.email_sends', 'select')
  and not has_table_privilege('anon', 'public.email_journeys', 'select')
  and not has_function_privilege('authenticated', 'public.lifecycle_signup_people()', 'execute')
  and not has_function_privilege('anon', 'public.unsubscribe_setup_tips(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.unsubscribe_setup_tips(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.set_my_email_preferences(boolean, boolean)', 'execute'));
select pg_temp.expect('deleting an account takes its sends with it',
  (select confdeltype = 'c' from pg_constraint where conrelid = 'public.email_sends'::regclass and contype = 'f'));

select pg_temp.expect('metrics count the new people: Hal joined a strata; Gina and Ivy haven''t; Uma never confirmed',
  (select signed_up = 4 and strata_connected = 1 and first_action = 1 from lifecycle_signup_metrics(30)));
select pg_temp.expect('metrics are server-only', not has_function_privilege('authenticated', 'public.lifecycle_signup_metrics(int)', 'execute'));
