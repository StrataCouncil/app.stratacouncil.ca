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
grant execute on function pg_temp.expect_error(text,text), pg_temp.expect(text,boolean) to authenticated;

-- PR 3b (2026-11-12): someone the admin removes keeps their account (and
-- Council Training) but loses everything of the strata's at once; someone
-- never connected has none of it. Checked table by table across the whole
-- public schema, so a table added later is covered too: after removal, Cara
-- sees exactly what Xavier (never connected) sees, except her own
-- membership row, marked removed.
--
-- In the seed, Bob is BCS-1234's admin, Cara an active member, Xavier an
-- outsider. Cara goes on council here so she sees as much as anyone.

insert into owners_and_council (corporation_id, lot_number, full_name, is_council_member) values ('BCS-1234', 'SL099', 'Olive Owner', true) on conflict do nothing;
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda)
  values ('cccccccc-0000-0000-0000-0000000000b1', 'BCS-1234', 'council', '2026-12-02', '00000000-0000-0000-0000-00000000000b', '[{"id":"i1","text":"Call to Order"}]');
insert into decisions (corporation_id, title) values ('BCS-1234', 'Roof repairs approved');
insert into documents (corporation_id, category, title, storage_path, uploaded_by)
  values ('BCS-1234', 'legal_governance', 'Bylaws', 'BCS-1234/bylaws.pdf', '00000000-0000-0000-0000-00000000000b');
insert into subscriptions (corporation_id, status) values ('BCS-1234', 'active') on conflict (corporation_id) do update set status = 'active';
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000b' and corporation_id = 'BCS-1234';
insert into conversations (corporation_id, user_id) values ('BCS-1234', '00000000-0000-0000-0000-00000000000c');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['member_at_large']);
create temp table ids (name text primary key, id uuid);
grant select, insert on ids to authenticated;
insert into ids select 'd', create_discussion('BCS-1234', 'Fence', '', '', '', 'THAT council repair the fence.');
select launch_meeting('cccccccc-0000-0000-0000-0000000000b1');
reset role;

-- Every table: how many rows the signed-in person sees (-1: no access at all).
create temp table tabs as select table_name::text t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';
grant select on tabs to authenticated;
create function pg_temp.visible() returns table(t text, n bigint) language plpgsql as $$
declare r record; c bigint;
begin
  for r in select tabs.t from tabs order by 1 loop
    begin
      execute format('select count(*) from public.%I', r.t) into c;
    exception when insufficient_privilege then c := -1;
    end;
    t := r.t; n := c; return next;
  end loop;
end $$;
grant execute on function pg_temp.visible() to authenticated;
create temp table seen (who text, t text, n bigint);
grant select, insert on seen to authenticated;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000e';
insert into seen select 'outsider', * from pg_temp.visible();
set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into seen select 'before', * from pg_temp.visible();
select pg_temp.expect('on council, Cara sees the strata''s records',
  (select bool_and(n > 0) from seen where who = 'before' and t in ('meetings', 'decisions', 'documents', 'owners_and_council', 'discussions', 'conversations')));

-- The admin removes her.
set test.uid = '00000000-0000-0000-0000-00000000000b';
select remove_corporation_member('BCS-1234', '00000000-0000-0000-0000-00000000000c');

set test.uid = '00000000-0000-0000-0000-00000000000c';
insert into seen select 'after', * from pg_temp.visible();
select pg_temp.expect('removed: every table shows her what it shows someone never connected (but her membership row)',
  not exists (
    select 1 from seen a join seen o on o.t = a.t and o.who = 'outsider'
    where a.who = 'after' and a.n is distinct from o.n and a.t <> 'corporation_memberships'));
select pg_temp.expect('her own membership row stays, marked removed (the history of who sat on council)',
  (select count(*) = 1 and bool_and(status = 'removed') from corporation_memberships));
select pg_temp.expect('her Stratasphere conversations go with the strata', (select count(*) = 0 from conversations));
select pg_temp.expect('and her roles are gone', (select count(*) = 0 from corporation_role_assignments));
select pg_temp.expect('the checks say no',
  not is_corporation_member('BCS-1234') and not can_run_meetings('BCS-1234') and not is_on_council('BCS-1234')
  and not can_see_discussions('BCS-1234') and not can_manage_billing('BCS-1234')
  and stratasphere_allowed('BCS-1234') = 'subscription' and not consume_stratasphere_request('BCS-1234'));
select pg_temp.expect_error($q$select launch_meeting('cccccccc-0000-0000-0000-0000000000b1')$q$, 'not allowed');
select pg_temp.expect_error($q$select create_discussion('BCS-1234', 'X', '', '', '', 'THAT x.')$q$, 'Only those who run meetings');
select pg_temp.expect_error($q$select add_discussion_comment((select id from ids where name = 'd'), 'Still here?')$q$, 'Only council members taking part');
select pg_temp.expect_error($q$select cast_discussion_vote((select id from ids where name = 'd'), 'for')$q$, 'Only council members can vote');

-- The invite she accepted long ago doesn't bring her back.
reset role;
create temp table old_invite as select id from corporation_invites where lower(invited_email) = 'c@x.ca' and status in ('accepted', 'revoked') limit 1;
grant select on old_invite to authenticated;
set role authenticated;
select pg_temp.expect('her old invite is there to try', (select count(*) = 1 from old_invite));
select accept_corporation_invite((select id from old_invite));
select pg_temp.expect('an old invite doesn''t restore the membership', not is_corporation_member('BCS-1234'));

-- A new invite from the admin does: she's back, with no role until the admin gives her one.
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into corporation_invites (corporation_id, invited_email, invited_by) values ('BCS-1234', 'c@x.ca', '00000000-0000-0000-0000-00000000000b');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select accept_corporation_invite((select id from my_pending_invites() where corporation_id = 'BCS-1234'));
select pg_temp.expect('re-invited: a member again', is_corporation_member('BCS-1234') and (select count(*) = 1 from meetings));
select pg_temp.expect('with no role yet', (select count(*) = 0 from corporation_role_assignments where user_id = '00000000-0000-0000-0000-00000000000c'));
