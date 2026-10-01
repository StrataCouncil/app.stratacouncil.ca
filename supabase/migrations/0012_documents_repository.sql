-- doc01 §4/§4a, doc02 §1 — the real document repository: free and
-- ungated for members (0008), filed into nine folders, indexed into the
-- knowledge base at upload time.
--
-- 1. documents gets the columns upload, indexing and agenda attachments
--    need. `source_type` is the reserved column from doc01 §5a
--    (default 'upload'); `link` rows are agenda link attachments, fetched
--    once at attach time and indexed like any other document.
-- 2. category is constrained to the nine folders. `agenda_attachments` is
--    system-assigned (doc01 §4) — the move RPC below won't put anything
--    there by hand.
-- 3. Private `corporation-documents` bucket. No client storage policies:
--    uploads use server-minted signed upload URLs under `<corp>/…`, and
--    downloads use server-minted signed URLs after an RLS-checked read of
--    the row, the same shape as the strata-plans bucket (0010).
-- 4. Members insert their own rows (RLS), but the indexing fields can only
--    start out empty — text, status and doc type are written by the
--    indexing job (service role), never by the browser.

alter table public.documents
  add column file_name text,
  add column mime_type text,
  add column size_bytes bigint,
  add column source_type text not null default 'upload'
    check (source_type in ('upload', 'agenda_attachment', 'link', 'strata_plan', 'historic_minutes', 'minutes')),
  add column url text,
  add column document_text text,
  add column doc_type text,
  add column indexing_status text not null default 'pending'
    check (indexing_status in ('pending', 'processing', 'indexed', 'failed', 'not_indexable', 'needs_text')),
  add column indexing_error text,
  add column indexed_at timestamptz,
  add column meeting_id uuid,           -- FK added with the meetings table (0014)
  add column agenda_item_id text;

alter table public.documents
  add constraint documents_category_check check (
    category is null or category in (
      'building_construction', 'contracts_service_agreements', 'correspondence',
      'financial_accounting', 'insurance', 'legal_governance', 'meetings_records',
      'operations', 'agenda_attachments'
    )
  );

alter table public.documents
  add constraint documents_link_has_url check (source_type <> 'link' or url is not null);

-- Strata Plans uploaded through corp creation (0010) are documents of the
-- corporation like any other — mark their source and file name so they
-- show in the repository and get indexed.
update public.documents d
  set source_type = 'strata_plan',
      file_name = coalesce(d.file_name, regexp_replace(d.storage_path, '^.*/', ''))
  where exists (select 1 from public.strata_corporations c where c.source_document_id = d.id);

create index documents_corporation_category_idx
  on public.documents (corporation_id, category, uploaded_at desc);
create index documents_indexing_pending_idx
  on public.documents (indexing_status) where indexing_status in ('pending', 'processing');

-- ── Storage ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('corporation-documents', 'corporation-documents', false, 52428800)
on conflict (id) do nothing;

-- ── RLS ─────────────────────────────────────────────────────────────────
-- Read stays "members can read documents" (0008). Insert is tightened:
-- your own row, nothing pre-filled that only the indexer may write.
drop policy "members can upload documents" on public.documents;
create policy "members can upload documents" on public.documents
  for insert with check (
    public.is_corporation_member(corporation_id)
    and uploaded_by = auth.uid()
    and document_text is null
    and doc_type is null
    and indexing_status = 'pending'
    and indexed_at is null
  );

-- Moving between folders is the one edit a member makes to an existing
-- document (doc01 §4: documents are otherwise immutable, corrected by
-- uploading a new version). A definer function rather than an update
-- policy, so no other column is writable from the browser.
create or replace function public.move_document(p_document_id uuid, p_category text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_corp text;
begin
  if p_category not in (
    'building_construction', 'contracts_service_agreements', 'correspondence',
    'financial_accounting', 'insurance', 'legal_governance', 'meetings_records', 'operations'
  ) then
    raise exception 'invalid folder' using errcode = '22023';
  end if;

  select corporation_id into v_corp from public.documents where id = p_document_id;
  if v_corp is null or not public.is_corporation_member(v_corp) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  update public.documents set category = p_category where id = p_document_id;
end;
$$;

revoke all on function public.move_document(uuid, text) from public;
grant execute on function public.move_document(uuid, text) to authenticated;
