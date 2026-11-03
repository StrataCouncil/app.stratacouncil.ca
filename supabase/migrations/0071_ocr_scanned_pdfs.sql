-- Reading scanned PDFs (2026-11-03). Pages with no text layer are read by
-- OCR on our own servers (lib/kb/ocr.ts) instead of stopping at "No text
-- layer". These columns record how a document's text was got, so Documents
-- can say "Read from scan" or "Some pages unclear":
--
--   text_source        'text' (the file's own text) or 'ocr' (some or all
--                      pages read from the scan)
--   ocr_pages          pages read by OCR
--   ocr_unclear_pages  of those, pages read with low confidence
--   ocr_skipped_pages  scanned pages past the 300-page limit, left out
--   ocr_confidence     average confidence, 0 to 100
--   ocr_attempted_at   when OCR was last tried; scanned documents filed
--                      before this change, still at 'needs_text' with no
--                      attempt, are picked up and read automatically
--
-- Grants: no new tables. On documents these are server-written like the
-- indexing fields: the insert policy below keeps them empty when a member
-- uploads, and members have no update grant. legislation_documents is
-- Super Admin only (0020), unchanged.
--
-- Safe to re-run.

alter table public.documents
  add column if not exists text_source text check (text_source in ('text', 'ocr')),
  add column if not exists ocr_pages int,
  add column if not exists ocr_unclear_pages int,
  add column if not exists ocr_skipped_pages int,
  add column if not exists ocr_confidence int check (ocr_confidence between 0 and 100),
  add column if not exists ocr_attempted_at timestamptz;

alter table public.legislation_documents
  add column if not exists text_source text check (text_source in ('text', 'ocr')),
  add column if not exists ocr_pages int,
  add column if not exists ocr_unclear_pages int,
  add column if not exists ocr_skipped_pages int,
  add column if not exists ocr_confidence int check (ocr_confidence between 0 and 100),
  add column if not exists ocr_attempted_at timestamptz;

-- Scanned documents waiting to be read (the hourly job's query).
create index if not exists documents_unread_scans_idx on public.documents (uploaded_at)
  where indexing_status = 'needs_text' and ocr_attempted_at is null;

-- As in 0065, with the OCR fields also left to the server.
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
    and text_source is null
    and ocr_pages is null
    and ocr_unclear_pages is null
    and ocr_skipped_pages is null
    and ocr_confidence is null
    and ocr_attempted_at is null
    and (
      storage_path is null
      or (storage_path like 'corporation-documents/' || corporation_id || '/%' and storage_path not like '%..%')
    )
  );
