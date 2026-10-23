-- Agenda attachments live in the strata's own folders (2026-10-23).
--
-- Before: every file or link attached to an agenda item became a new copy
-- in a system folder, Agenda Attachments, so a report uploaded to
-- Documents and also attached to an agenda item was stored twice. Now an
-- agenda item points at a document wherever it's filed: an upload asks for
-- its folder, a link too, and an existing document is attached as it is.
--
-- 1. Agenda Attachments is retired. Its documents become Unfiled (no
--    folder, like the older documents that never had one) for an admin
--    or member to move into the right folder. Agenda items keep pointing
--    at them; nothing about a meeting changes.
-- 2. documents.content_sha256: a fingerprint of the stored file, written
--    only by the server (a background job reads the file and hashes it),
--    so identical files can be found. Members can't set it when adding a
--    document.
-- 3. merge_duplicate_document(duplicate, keep): an admin removes a
--    document whose file is identical to another one, after pointing
--    every agenda item that attached it at the one kept. Search passages
--    shared with other stratas (the precedent pool) are kept and moved to
--    the kept document; the strata's own passages go with the duplicate.
--    Returns the duplicate's storage path, so the app can delete the file.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

-- 1. Retire Agenda Attachments.
update public.documents set category = null where category = 'agenda_attachments';

alter table public.documents drop constraint if exists documents_category_check;
alter table public.documents
  add constraint documents_category_check check (
    category is null or category in (
      'building_construction', 'contracts_service_agreements', 'correspondence',
      'financial_accounting', 'insurance', 'legal_governance', 'meetings_records',
      'operations'
    )
  );

-- 2. File fingerprints.
alter table public.documents add column if not exists content_sha256 text;
alter table public.documents drop constraint if exists documents_content_sha256_hex;
alter table public.documents
  add constraint documents_content_sha256_hex check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
create index if not exists documents_corporation_sha256_idx
  on public.documents (corporation_id, content_sha256) where content_sha256 is not null;

-- Members add documents with the fingerprint empty (as with the indexing
-- fields); only the server's job writes it. Otherwise as in 0054.
drop policy if exists "members can upload documents" on public.documents;
create policy "members can upload documents" on public.documents
  for insert with check (
    public.is_corporation_member(corporation_id)
    and uploaded_by = auth.uid()
    and document_text is null
    and doc_type is null
    and indexing_status = 'pending'
    and indexed_at is null
    and content_sha256 is null
    and (
      storage_path is null
      or (storage_path like 'corporation-documents/' || corporation_id || '/%' and storage_path not like '%..%')
    )
  );

-- 3. Merge an identical copy into the one kept.
create or replace function public.merge_duplicate_document(p_duplicate_id uuid, p_keep_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup public.documents%rowtype;
  v_keep public.documents%rowtype;
  v_dup_text text := p_duplicate_id::text;
  v_keep_text text := p_keep_id::text;
begin
  if p_duplicate_id is null or p_keep_id is null or p_duplicate_id = p_keep_id then
    raise exception 'choose two different documents' using errcode = '22023';
  end if;

  select * into v_dup from public.documents where id = p_duplicate_id for update;
  select * into v_keep from public.documents where id = p_keep_id for update;
  if v_dup.id is null or v_keep.id is null
     or v_dup.corporation_id is distinct from v_keep.corporation_id
     or not public.has_corporation_role(v_dup.corporation_id, array['admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_dup.content_sha256 is null or v_dup.content_sha256 is distinct from v_keep.content_sha256 then
    raise exception 'not the same file' using errcode = '22023';
  end if;
  if not v_keep.is_current then
    raise exception 'keep the current version' using errcode = '22023';
  end if;
  if v_dup.source_type in ('minutes', 'historic_minutes', 'strata_plan')
     or exists (select 1 from public.documents where supersedes_document_id = p_duplicate_id)
     or v_dup.supersedes_document_id is not null
     or exists (select 1 from public.strata_corporations where source_document_id = p_duplicate_id)
     or exists (select 1 from public.corporation_creation_requests where strata_plan_document_id = p_duplicate_id)
     or exists (select 1 from public.stratasphere_reactivation_requests where proof_document_id = p_duplicate_id)
     or exists (select 1 from public.decisions where source_document_id = p_duplicate_id) then
    raise exception 'this document is part of the strata''s records and stays' using errcode = '22023';
  end if;

  -- Point agenda items at the kept document, dropping the duplicate's
  -- entry where an item already has the kept one. Adjourned meetings
  -- included: the file is identical, so the record doesn't change.
  perform set_config('app.meeting_lifecycle', 'on', true);
  update public.meetings m
    set agenda = (
      select coalesce(jsonb_agg(
        case
          when jsonb_typeof(it -> 'atts') = 'array' then jsonb_set(it, '{atts}', (
            select coalesce(jsonb_agg(s.att order by s.ord), '[]'::jsonb)
            from (
              select x.ord,
                     case when x.a ->> 'documentId' = v_dup_text
                       then x.a || jsonb_build_object('documentId', v_keep_text, 'id', 'a_' || v_keep_text)
                       else x.a end as att,
                     row_number() over (
                       partition by case when x.a ->> 'documentId' = v_dup_text then v_keep_text
                                         else coalesce(x.a ->> 'documentId', 'att:' || (x.a ->> 'id'), 'pos:' || x.ord) end
                       order by x.ord
                     ) as rn
              from jsonb_array_elements(it -> 'atts') with ordinality as x(a, ord)
            ) s
            where s.rn = 1
          ))
          else it
        end
        order by i.ord), '[]'::jsonb)
      from jsonb_array_elements(m.agenda) with ordinality as i(it, ord)
    )
    where m.corporation_id = v_dup.corporation_id
      and m.agenda::text like '%' || v_dup_text || '%';
  perform set_config('app.meeting_lifecycle', '', true);

  -- Precedent passages are never deleted (doc02 §0); they follow the kept copy.
  update public.knowledge_chunks set document_id = p_keep_id
    where document_id = p_duplicate_id and scope = 'global_precedent';

  delete from public.documents where id = p_duplicate_id;
  return v_dup.storage_path;
end;
$$;

revoke all on function public.merge_duplicate_document(uuid, uuid) from public;
grant execute on function public.merge_duplicate_document(uuid, uuid) to authenticated;
