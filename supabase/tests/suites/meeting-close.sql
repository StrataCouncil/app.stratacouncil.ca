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
grant select, insert, update, delete on all tables in schema public to authenticated;
delete from subscriptions;
update corporation_memberships set can_run_meetings = true where user_id = '00000000-0000-0000-0000-00000000000c';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
insert into meetings (id, corporation_id, type, meeting_date, created_by, agenda) values
  ('bbbbbbbb-0000-0000-0000-000000000001','BCS-1234','council','2026-11-01','00000000-0000-0000-0000-00000000000b','[{"id":"i1","text":"Call to Order"}]');
select pg_temp.expect('AI refused before launch (no subscription, no trial running)', not consume_stratasphere_request('BCS-1234'));
select launch_meeting('bbbbbbbb-0000-0000-0000-000000000001');
insert into meeting_item_notes (meeting_id, item_id, body) values ('bbbbbbbb-0000-0000-0000-000000000001','i2','private');
select pg_temp.expect('10 trial AI calls allowed', (select bool_and(consume_stratasphere_request('BCS-1234')) from generate_series(1,10)));
select pg_temp.expect('11th refused', not consume_stratasphere_request('BCS-1234'));
select call_meeting_to_order('bbbbbbbb-0000-0000-0000-000000000001', '{"SL001":"present","SL002":"present"}', '["SL001","SL002"]');

select pg_temp.expect_error($q$select adjourn_meeting('bbbbbbbb-0000-0000-0000-000000000001', '[{"id":"i1","text":"Call to Order","done":true},{"id":"i2","text":"Roof","done":false}]', '{}')$q$, 'decided or deferred');
set test.uid = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect_error($q$select adjourn_meeting('bbbbbbbb-0000-0000-0000-000000000001', '[]', '{}')$q$, 'not allowed');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select adjourn_meeting('bbbbbbbb-0000-0000-0000-000000000001', $j$[
  {"id":"i1","text":"Call to Order","done":true},
  {"id":"i2","text":"Roof replacement","cat":"New Business","done":true,"motion":{"text":"THAT the roof be replaced","dt":"THREE_QUARTER","for":6,"against":1,"abstain":0,"outcome":"CARRIED","mover":"SL001","sec":"SL002"}},
  {"id":"i3","text":"Pool hours","done":true,"motion":{"text":"THAT...","dt":"MAJORITY","for":1,"against":3,"abstain":0,"outcome":"DEFEATED","mover":"SL001","sec":"SL002"}},
  {"id":"i4","text":"Garden","deferred":true},
  {"id":"i5","text":"Adjournment","done":true,"motion":{"text":"THAT the meeting be adjourned.","dt":"MAJORITY","for":2,"against":0,"abstain":0,"outcome":"CARRIED","mover":"SL001","sec":"SL002"}}
]$j$, '{"draft":true}');
select pg_temp.expect('adjourned with draft minutes', (select status = 'ADJOURNED' and minutes_state = 'DRAFT' and adjourned_at is not null from meetings where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select pg_temp.expect('only the carried non-adjournment motion is in the ledger', (select array_agg(title) = array['Roof replacement'] and bool_and(mover = 'SL001' and votes_for = 6 and decision_type = 'THREE_QUARTER') from decisions where meeting_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select pg_temp.expect_error($q$update meetings set agenda = '[]' where id = 'bbbbbbbb-0000-0000-0000-000000000001'$q$, 'adjourned meeting');
select pg_temp.expect_error($q$select adjourn_meeting('bbbbbbbb-0000-0000-0000-000000000001', '[]', '{}')$q$, 'already been adjourned');

-- Cara (has the switch) edits draft minutes and finalizes, though Bob ran it
set test.uid = '00000000-0000-0000-0000-00000000000c';
update meetings set minutes_content = '{"edited":true}' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select pg_temp.expect('another runner edits draft minutes after adjournment', (select minutes_content = '{"edited":true}' from meetings where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select finalize_minutes('bbbbbbbb-0000-0000-0000-000000000001', null);
reset role;
select pg_temp.expect('final, notes purged', (select minutes_state = 'FINAL' and minutes_finalized_by = '00000000-0000-0000-0000-00000000000c' from meetings where id = 'bbbbbbbb-0000-0000-0000-000000000001') and not exists (select 1 from meeting_item_notes where meeting_id = 'bbbbbbbb-0000-0000-0000-000000000001'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
update meetings set minutes_content = '{"tamper":true}' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select pg_temp.expect('final minutes immutable', (select minutes_content = '{"edited":true}' from meetings where id = 'bbbbbbbb-0000-0000-0000-000000000001'));
select pg_temp.expect_error($q$select finalize_minutes('bbbbbbbb-0000-0000-0000-000000000001', null)$q$, 'already final');
select pg_temp.expect('trial over: no AI', not consume_stratasphere_request('BCS-1234') and not has_stratasphere_access('BCS-1234'));

-- Historic decisions
reset role;
insert into documents (id, corporation_id, category, title, source_type) values ('cccccccc-0000-0000-0000-000000000001','BCS-1234','meetings_records','2019 minutes','historic_minutes');
set role authenticated;
select pg_temp.expect('historic decisions recorded', record_historic_decisions('BCS-1234','cccccccc-0000-0000-0000-000000000001','[{"title":"Paint hallways","motion_text":"THAT...","mover":"SL004","decided_on":"2019-05-01","votes_for":"5"}]') = 1);
select pg_temp.expect('re-record returns new count', record_historic_decisions('BCS-1234','cccccccc-0000-0000-0000-000000000001','[{"title":"Paint hallways v2"},{"title":"Fix gate"}]') = 2);
reset role;
select pg_temp.expect('re-record replaces', (select count(*) = 2 from decisions where source_document_id = 'cccccccc-0000-0000-0000-000000000001'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000f';
select pg_temp.expect_error($q$select record_historic_decisions('BCS-1234','cccccccc-0000-0000-0000-000000000001','[]')$q$, 'not allowed');
