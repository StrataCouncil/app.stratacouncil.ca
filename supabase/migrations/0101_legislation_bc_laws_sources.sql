-- Knowledge Base read from BC Laws (2026-11-22).
--
-- Each Act or regulation can carry its BC Laws link. The app reads the
-- entry's HTML straight from BC Laws, stores it as text, indexes it, and
-- checks every Monday for a newer consolidation (lib/inngest/refresh-
-- legislation.ts). Uploading copies is no longer needed for anything on
-- BC Laws.
--
-- Adds three columns:
--   source_url         the BC Laws complete-document link
--   source_checked_at  when BC Laws was last checked
--   source_error       why the last check failed, if it did
--
-- Then fixes the library's data:
--   - links every existing Act and regulation that is on BC Laws (matched
--     by name, ignoring case and punctuation, only where no link is set);
--   - files the Real Estate Services Rules as a regulation, so they are
--     split by section and can be cited by section;
--   - adds the Real Estate Services Regulation and the Human Rights Code,
--     which were missing; they are read from BC Laws when the check runs.
-- After running this, press "Check BC Laws now" on the Knowledge Base
-- screen (or wait for Monday's check).
--
-- Safe to run more than once: columns and the constraint are added only if
-- missing, links are set only where none is set, and an entry is added
-- only if none has that name. Grants: none needed. No new tables or
-- functions; the existing Super Admin policy and grants on
-- legislation_documents cover the new columns. Paste the whole file into
-- an empty SQL editor tab.

alter table public.legislation_documents
  add column if not exists source_url text,
  add column if not exists source_checked_at timestamptz,
  add column if not exists source_error text;

alter table public.legislation_documents drop constraint if exists legislation_documents_source_url_check;
alter table public.legislation_documents
  add constraint legislation_documents_source_url_check
  check (source_url is null or source_url ~ '^https://www\.bclaws\.gov\.bc\.ca/civix/document/id/complete/statreg/[A-Za-z0-9_]{2,40}$');

-- BC Laws document ids, each checked on 2026-11-22.
with links(name, doc_id) as (
  values
    ('builders lien act', '97045_01'),
    ('civil resolution tribunal act', '12025_01'),
    ('electronic transactions act', '01010_01'),
    ('fire safety act', '16019'),
    ('guide dog and service dog act', '15017'),
    ('homeowner protection act', '98031_01'),
    ('insurance act', '12001_00'),
    ('interpretation act', '96238_01'),
    ('land title act', '96250_00'),
    ('limitation act', '12013_01'),
    ('personal information protection act', '03063_01'),
    ('real estate development marketing act', '04041_01'),
    ('real estate services act', '04042_01'),
    ('residential tenancy act', '02078_01'),
    ('short term rental accommodations act', '23032'),
    ('strata property act', '98043_00'),
    ('workers compensation act', '19001_00'),
    ('homeowner protection act regulation', '29_99'),
    ('strata property regulation', '43_2000'),
    ('real estate services rules', '209_2021'),
    ('real estate services regulation', '506_2004'),
    ('human rights code', '96210_01')
)
update public.legislation_documents d
set source_url = 'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/' || l.doc_id
from links l
where d.source_url is null
  and trim(regexp_replace(lower(d.title), '[^a-z0-9]+', ' ', 'g')) = l.name;

update public.legislation_documents
set kind = 'regulation', indexing_status = 'pending', indexing_error = null
where kind = 'guidance'
  and trim(regexp_replace(lower(title), '[^a-z0-9]+', ' ', 'g')) = 'real estate services rules';

insert into public.legislation_documents (title, short_name, kind, source_url, indexing_status)
select v.title, v.short_name, v.kind, v.source_url, 'pending'
from (
  values
    ('Real Estate Services Regulation', 'RES Reg', 'regulation',
     'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/506_2004'),
    ('Human Rights Code', 'HRC', 'act',
     'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/96210_01')
) as v(title, short_name, kind, source_url)
where not exists (
  select 1 from public.legislation_documents d
  where trim(regexp_replace(lower(d.title), '[^a-z0-9]+', ' ', 'g')) = trim(regexp_replace(lower(v.title), '[^a-z0-9]+', ' ', 'g'))
);
