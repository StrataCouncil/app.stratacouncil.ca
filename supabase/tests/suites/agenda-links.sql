\set ON_ERROR_STOP 1
-- 0102: link documents attached to agenda items become inline links on
-- the agenda, and the documents go. Re-runs the migration over a meeting
-- that still has a filed link (the constraint is lifted to set that up).
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;

alter table public.documents drop constraint documents_no_links;
insert into public.documents (id, corporation_id, category, title, source_type, url)
  values ('aaaaaaaa-0000-0000-0000-0000000000a1', 'BCS-1234', 'financial_accounting', 'FY28 budget', 'link', 'https://docs.google.com/spreadsheets/d/x');
insert into public.documents (id, corporation_id, category, title, file_name, storage_path)
  values ('aaaaaaaa-0000-0000-0000-0000000000a2', 'BCS-1234', 'financial_accounting', 'October.pdf', 'October.pdf', 'corporation-documents/BCS-1234/u/October.pdf');
insert into public.meetings (id, corporation_id, type, meeting_date, created_by, agenda) values (
  'bbbbbbbb-0000-0000-0000-0000000000b1', 'BCS-1234', 'council', '2026-12-02', '00000000-0000-0000-0000-00000000000b',
  '[{"id":"i5","text":"FY28 Budget","atts":[
     {"id":"a_aaaaaaaa-0000-0000-0000-0000000000a1","kind":"link","documentId":"aaaaaaaa-0000-0000-0000-0000000000a1","url":"https://docs.google.com/spreadsheets/d/x","title":""},
     {"id":"a_aaaaaaaa-0000-0000-0000-0000000000a2","kind":"document","documentId":"aaaaaaaa-0000-0000-0000-0000000000a2","title":"October.pdf"}]},
    {"id":"i6","text":"No attachments"}]'::jsonb);
-- An adjourned meeting with the same link: its record is fixed (0014), but the address doesn't change.
insert into public.meetings (id, corporation_id, type, meeting_date, created_by, agenda) values (
  'bbbbbbbb-0000-0000-0000-0000000000b2', 'BCS-1234', 'council', '2026-11-04', '00000000-0000-0000-0000-00000000000b',
  '[{"id":"i1","text":"Budget","atts":[{"id":"a_aaaaaaaa-0000-0000-0000-0000000000a1","kind":"link","documentId":"aaaaaaaa-0000-0000-0000-0000000000a1","url":"https://docs.google.com/spreadsheets/d/x","title":"Budget sheet"}]}]'::jsonb);
select set_config('app.meeting_lifecycle', 'on', false);
update public.meetings set status = 'ADJOURNED', adjourned_at = now() where id = 'bbbbbbbb-0000-0000-0000-0000000000b2';
select set_config('app.meeting_lifecycle', '', false);

\i supabase/migrations/0102_agenda_links_stay_on_agenda.sql

select pg_temp.expect('link becomes an inline link with no document',
  (select a ->> 'documentId' is null and a ->> 'kind' = 'link' and a ->> 'url' = 'https://docs.google.com/spreadsheets/d/x' and a ->> 'title' = 'FY28 budget'
   from public.meetings m, jsonb_array_elements(m.agenda -> 0 -> 'atts') a where m.id = 'bbbbbbbb-0000-0000-0000-0000000000b1' and a ->> 'kind' = 'link'));
select pg_temp.expect('the file attachment is untouched',
  (select count(*) = 1 from public.meetings m, jsonb_array_elements(m.agenda -> 0 -> 'atts') a where m.id = 'bbbbbbbb-0000-0000-0000-0000000000b1' and a ->> 'documentId' = 'aaaaaaaa-0000-0000-0000-0000000000a2'));
select pg_temp.expect('items keep their order and items without attachments are kept',
  (select agenda -> 0 ->> 'id' = 'i5' and agenda -> 1 ->> 'id' = 'i6' and agenda -> 1 -> 'atts' is null from public.meetings where id = 'bbbbbbbb-0000-0000-0000-0000000000b1'));
select pg_temp.expect('the adjourned meeting''s link is inline too',
  (select a ->> 'documentId' is null and a ->> 'title' = 'Budget sheet'
   from public.meetings m, jsonb_array_elements(m.agenda -> 0 -> 'atts') a where m.id = 'bbbbbbbb-0000-0000-0000-0000000000b2'));
select pg_temp.expect('the adjourned meeting is still protected afterwards',
  (select count(*) = 0 from pg_settings where name = 'app.meeting_lifecycle' and setting = 'on'));
select pg_temp.expect('the link document is gone', (select count(*) = 0 from public.documents where source_type = 'link'));
select pg_temp.expect('the uploaded file stays', (select count(*) = 1 from public.documents where id = 'aaaaaaaa-0000-0000-0000-0000000000a2'));
select pg_temp.expect('no new link documents',
  (select count(*) = 1 from pg_constraint where conname = 'documents_no_links'));

\i supabase/migrations/0102_agenda_links_stay_on_agenda.sql
select pg_temp.expect('running it again changes nothing',
  (select jsonb_array_length(agenda -> 0 -> 'atts') = 2 from public.meetings where id = 'bbbbbbbb-0000-0000-0000-0000000000b1'));
