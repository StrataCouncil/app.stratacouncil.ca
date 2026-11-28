-- Duplicates matched on content, not only on the file's bytes.
--
-- 0065 found identical files by a fingerprint of the stored bytes
-- (content_sha256). A document exported again from Google Drive, scanned
-- again, or saved again has different bytes but the same text, so it
-- slipped through. This adds a fingerprint of the document's text.
--
-- 1. document_text_fingerprint(text): the text lower-cased, with runs of
--    whitespace collapsed, hashed (sha256, hex). Texts under 200
--    characters get none: short texts (a cover page, a one-line note)
--    match each other too easily.
-- 2. documents.text_fingerprint, kept up to date by a trigger whenever
--    document_text changes, and filled in now for every document already
--    read. Members can't set it (the trigger overwrites it).
-- 3. merge_duplicate_document accepts two documents with the same text as
--    well as the same file, and points a Discussion's vote record at the
--    one kept (it used to be left empty).
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

-- 1. The text fingerprint.
create or replace function public.document_text_fingerprint(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_text is null then null
    when char_length(btrim(regexp_replace(lower(p_text), '\s+', ' ', 'g'))) < 200 then null
    else encode(sha256(convert_to(btrim(regexp_replace(lower(p_text), '\s+', ' ', 'g')), 'UTF8')), 'hex')
  end
$$;

-- 2. The column, the trigger and the backfill.
alter table public.documents add column if not exists text_fingerprint text;
create index if not exists documents_corporation_text_fingerprint_idx
  on public.documents (corporation_id, text_fingerprint) where text_fingerprint is not null;

create or replace function public.documents_text_fingerprint()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.text_fingerprint := public.document_text_fingerprint(new.document_text);
  return new;
end;
$$;

drop trigger if exists documents_text_fingerprint on public.documents;
create trigger documents_text_fingerprint
  before insert or update of document_text, text_fingerprint on public.documents
  for each row execute function public.documents_text_fingerprint();

update public.documents
  set text_fingerprint = public.document_text_fingerprint(document_text)
  where document_text is not null
    and text_fingerprint is distinct from public.document_text_fingerprint(document_text);

-- 3. Merge a copy with the same file or the same text into the one kept.
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
  -- The same file, or the same text (a re-export or re-scan of the same document).
  if not (
    (v_dup.content_sha256 is not null and v_dup.content_sha256 = v_keep.content_sha256)
    or (v_dup.text_fingerprint is not null and v_dup.text_fingerprint = v_keep.text_fingerprint)
  ) then
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

  -- A Discussion's vote record that was the duplicate now points at the one kept.
  update public.discussions set record_document_id = p_keep_id where record_document_id = p_duplicate_id;

  delete from public.documents where id = p_duplicate_id;
  return v_dup.storage_path;
end;
$$;

revoke all on function public.merge_duplicate_document(uuid, uuid) from public;
grant execute on function public.merge_duplicate_document(uuid, uuid) to authenticated;

-- Check: how many documents have a text fingerprint, and how many sets of
-- copies with the same text there are.
select
  (select count(*) from public.documents where text_fingerprint is not null) as documents_with_text_fingerprint,
  (select count(*) from (
     select corporation_id, text_fingerprint from public.documents
     where text_fingerprint is not null and is_current
     group by 1, 2 having count(*) > 1) g) as sets_of_same_text;
