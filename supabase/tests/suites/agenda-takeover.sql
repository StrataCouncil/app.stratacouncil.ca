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


-- 0077: taking over the agenda. Bob (admin) and Cara (can run meetings)
-- both edit BCS-1234's agendas; Finn (member at large) can't.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000c', array['treasurer']);
select set_corporation_member_roles('BCS-1234', '00000000-0000-0000-0000-00000000000f', array['member_at_large']);
reset role;
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000c' and corporation_id = 'BCS-1234';
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda)
values ('77000000-0000-0000-0000-0000000000aa', 'BCS-1234', 'council', '2026-11-18', '00000000-0000-0000-0000-00000000000b', '[]');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('Bob edits', (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect_error($q$select request_agenda_takeover('77000000-0000-0000-0000-0000000000aa')$q$, 'Only someone who can run meetings');

-- Cara asks to take over; Bob's screen is told on its next renewal
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('Cara sees Bob editing', not (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
select request_agenda_takeover('77000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('her request is noted, but it is still Bob''s', claim_agenda('77000000-0000-0000-0000-0000000000aa') @> '{"mine": false, "requested": true}'::jsonb);
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect('Bob''s renewal says someone asked', (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'takeover') is not null);
-- Bob's screen saves and hands over
select release_agenda('77000000-0000-0000-0000-0000000000aa');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('then it is Cara''s', (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
select pg_temp.expect('and the request is cleared', (select agenda_takeover_by is null from meetings where id = '77000000-0000-0000-0000-0000000000aa'));

-- Bob asks back, but Cara's screen has gone: after a minute it goes through
set test.uid = '00000000-0000-0000-0000-00000000000b';
select request_agenda_takeover('77000000-0000-0000-0000-0000000000aa');
select pg_temp.expect('not straight away', not (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
reset role;
update meetings set agenda_takeover_at = now() - interval '61 seconds' where id = '77000000-0000-0000-0000-0000000000aa';
set role authenticated;
select pg_temp.expect('after a minute unanswered, Bob has it', (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);

-- An abandoned hold is free after 2 minutes
reset role;
update meetings set agenda_editor_at = now() - interval '3 minutes' where id = '77000000-0000-0000-0000-0000000000aa';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect('abandoned for 2 minutes, it can be taken', (claim_agenda('77000000-0000-0000-0000-0000000000aa') ->> 'mine')::boolean);
reset role;
select pg_temp.expect('signed-out callers get nothing', not has_function_privilege('anon', 'public.request_agenda_takeover(uuid)', 'execute'));
