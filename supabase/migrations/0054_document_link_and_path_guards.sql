-- Two guards on documents a member adds directly (2026-10 audit).
--
-- 1. A link document's address must be a web address (http or https).
--    A `javascript:` address saved as a link could run code in the
--    session of whoever opened it. The app now refuses to open anything
--    else too (lib/web-url.ts); this stops such a row being saved at all.
--    NOT VALID: rows already saved aren't re-checked here, and the app
--    won't open one that fails.
-- 2. An uploaded file's path must be in the strata's own folder of the
--    documents bucket. Downloads and indexing read the file with the
--    service role, so a row pointing elsewhere could otherwise reach a
--    file the member shouldn't see.
--
-- Safe to run more than once. Run the whole file in one go.

alter table public.documents drop constraint if exists documents_link_is_web;
alter table public.documents
  add constraint documents_link_is_web check (url is null or url ~* '^https?://') not valid;

drop policy if exists "members can upload documents" on public.documents;
create policy "members can upload documents" on public.documents
  for insert with check (
    public.is_corporation_member(corporation_id)
    and uploaded_by = auth.uid()
    and document_text is null
    and doc_type is null
    and indexing_status = 'pending'
    and indexed_at is null
    and (
      storage_path is null
      or (storage_path like 'corporation-documents/' || corporation_id || '/%' and storage_path not like '%..%')
    )
  );
