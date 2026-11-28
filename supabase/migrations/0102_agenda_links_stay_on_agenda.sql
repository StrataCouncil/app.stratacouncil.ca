-- Links attached to agenda items stay on the agenda item only.
--
-- Until now a link attachment was also filed in Documents as a "link"
-- document and fetched for Stratasphere. Most links point at shared drives
-- that need a sign-in, so the fetch failed ("The link returned an error
-- (401)") and the entry was clutter in Documents. From now on the app
-- keeps a link inside the agenda item itself (an attachment with a url and
-- no document), which the agenda already supports.
--
-- 1. Every agenda attachment that points at a link document becomes an
--    inline link (same address and title, no document).
-- 2. The link documents are removed, with their indexed passages (which
--    cascade). One referenced from a record that can't lose it is kept.
-- 3. Documents can no longer hold links.
--
-- Safe to run more than once. Run the whole file in one go.

begin;

-- ── 1. Agenda attachments become inline links ───────────────────────────
update public.meetings m
set agenda = (
  select coalesce(jsonb_agg(
    case
      when jsonb_typeof(it -> 'atts') = 'array' then jsonb_set(it, '{atts}', (
        select coalesce(jsonb_agg(
          case
            when d.id is not null then jsonb_build_object(
              'id', 'l_' || d.id::text,
              'kind', 'link',
              'documentId', null,
              'url', d.url,
              'title', coalesce(nullif(btrim(a ->> 'title'), ''), nullif(btrim(d.title), ''), d.url)
            )
            else a
          end
          order by ord
        ), '[]'::jsonb)
        from jsonb_array_elements(it -> 'atts') with ordinality as x(a, ord)
        left join public.documents d
          on d.source_type = 'link'
         and d.url is not null
         and d.corporation_id = m.corporation_id
         and d.id::text = a ->> 'documentId'
      ))
      else it
    end
    order by iord
  ), '[]'::jsonb)
  from jsonb_array_elements(m.agenda) with ordinality as y(it, iord)
)
where jsonb_typeof(m.agenda) = 'array'
  and exists (
    select 1 from public.documents d
    where d.source_type = 'link'
      and d.corporation_id = m.corporation_id
      and position(d.id::text in m.agenda::text) > 0
  );

-- ── 2. Remove the link documents ────────────────────────────────────────
delete from public.documents d
where d.source_type = 'link'
  and not exists (select 1 from public.documents x where x.supersedes_document_id = d.id)
  and not exists (select 1 from public.corporation_creation_requests x where x.strata_plan_document_id = d.id)
  and not exists (select 1 from public.strata_corporations x where x.source_document_id = d.id)
  and not exists (select 1 from public.stratasphere_reactivation_requests x where x.proof_document_id = d.id)
  and not exists (select 1 from public.decisions x where x.source_document_id = d.id);

-- ── 3. No new link documents ────────────────────────────────────────────
-- NOT VALID so a kept, referenced link (step 2) doesn't block this; every
-- new or changed row is checked.
alter table public.documents drop constraint if exists documents_no_links;
alter table public.documents
  add constraint documents_no_links check (source_type <> 'link') not valid;

commit;

-- Check: both should be 0 (the second may be more than 0 only if a link
-- was kept in step 2 because another record points at it).
select
  (select count(*) from public.meetings m, jsonb_array_elements(m.agenda) it, jsonb_array_elements(coalesce(it -> 'atts', '[]'::jsonb)) a
     join public.documents d on d.id::text = a ->> 'documentId' and d.source_type = 'link') as agenda_links_still_filed,
  (select count(*) from public.documents where source_type = 'link') as link_documents_left;
