\set ON_ERROR_STOP 1
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
grant execute on function pg_temp.expect(text,boolean) to authenticated;

insert into library_resources (kind, title, summary, draft_markup, published, published_at)
values ('policy_template', 'Pet policy', 'A template.', 'Body', '{"kind":"policy_template","title":"Pet policy","summary":"A template.","tags":[],"markup":"Body","sources":[]}', now());
select pg_temp.expect('the service role can read the Library', (select count(*) = 1 from library_resources));

-- Templates are for subscribers, so members never read the table directly (the app does, after checking).
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';  -- Bob, strata admin
do $$
begin
  perform 1 from library_resources;
  raise exception 'FAILED: a member read the Library table directly';
exception when insufficient_privilege then
  raise notice 'OK: members can''t read the Library table directly';
end $$;
reset role;

do $$
begin
  insert into library_resources (kind) values ('nonsense');
  raise exception 'FAILED: an unknown kind was accepted';
exception when check_violation then
  raise notice 'OK: only known kinds are accepted';
end $$;
