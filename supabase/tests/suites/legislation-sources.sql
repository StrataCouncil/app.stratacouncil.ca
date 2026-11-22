\set ON_ERROR_STOP 1
-- 0101: Knowledge Base entries read from BC Laws.
create function pg_temp.expect(label text, ok boolean) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'OK: %', label; end $$;
create function pg_temp.expect_error(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'wrong error for [%]: %', sql, sqlerrm; end if;
    raise notice 'OK refused: %', sqlerrm; return;
  end;
  raise exception 'expected error containing "%" but [%] succeeded', needle, sql;
end $$;

-- A library like production's: names as uploaded, one link already set by hand.
delete from legislation_documents;
insert into legislation_documents (title, kind) values
  ('Strata Property Act', 'act'),
  ('Short Term Rental Accommodations Act', 'act'),
  ('Insurance Act', 'act'),
  ('Real Estate Services Rules', 'guidance'),
  ('BC Strata Meetings Guide', 'guidance'),
  ('Personal Information Protection and Electronic Documents Act', 'act');
insert into legislation_documents (title, kind, source_url) values
  ('Land Title Act', 'act', 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96250_01');

-- Run the migration's data steps again: it was applied once when the template was built.
\i supabase/migrations/0101_legislation_bc_laws_sources.sql
\i supabase/migrations/0101_legislation_bc_laws_sources.sql

select pg_temp.expect('the SPA is linked to its contents page',
  (select source_url = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00' from legislation_documents where title = 'Strata Property Act'));
select pg_temp.expect('names match ignoring punctuation',
  (select source_url like '%/23032' from legislation_documents where title = 'Short Term Rental Accommodations Act'));
select pg_temp.expect('the Insurance Act is linked to the whole Act, not one part',
  (select source_url like '%/12001_00' from legislation_documents where title = 'Insurance Act'));
select pg_temp.expect('a link set by hand is kept',
  (select source_url like '%/96250_01' from legislation_documents where title = 'Land Title Act'));
select pg_temp.expect('guidance and federal Acts get no link',
  (select count(*) = 2 from legislation_documents where source_url is null));
select pg_temp.expect('the Rules are now a regulation',
  (select kind = 'regulation' and indexing_status = 'pending' from legislation_documents where title = 'Real Estate Services Rules'));
select pg_temp.expect('the missing regulation and code are added once each',
  (select count(*) = 2 from legislation_documents where title in ('Real Estate Services Regulation', 'Human Rights Code')));
select pg_temp.expect('added entries wait to be read from BC Laws',
  (select bool_and(indexing_status = 'pending' and storage_path is null and source_url is not null)
   from legislation_documents where title in ('Real Estate Services Regulation', 'Human Rights Code')));

select pg_temp.expect_error($q$update legislation_documents set source_url = 'https://example.com/civix/document/id/complete/statreg/98043_00' where title = 'Insurance Act'$q$, 'source_url_check');
select pg_temp.expect_error($q$update legislation_documents set source_url = 'http://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00' where title = 'Insurance Act'$q$, 'source_url_check');
