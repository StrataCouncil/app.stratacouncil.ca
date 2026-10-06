-- Council Training: the Legislation Library as the builder's source (2026-10-06).
--
-- 1. match_library_for_training: semantic search over the library's
--    indexed passages (one per Act or Regulation section, with its
--    citation). Server only: called with the service role by the AI module
--    builder, never by learners or councils.
-- 2. training_imports.reference_chunk_ids: the library passages chosen for
--    a build.
-- 3. training_module_drafts.fact_check: the latest check of a module's
--    facts and references against the library ({status, checkedAt,
--    draftUpdatedAt, issues: [...], error}). On the draft, so only Super
--    Admins and the module's authors can read it (learners can read
--    training_modules).
--
-- Safe to re-run.

create or replace function public.match_library_for_training(
  p_query_embedding extensions.vector(1024),
  p_match_count int default 12,
  p_match_threshold float default 0.3
)
returns table (
  id uuid,
  legislation_document_id uuid,
  title text,
  chunk_text text,
  chunk_index int,
  similarity float
)
language sql
security definer
set search_path = public, extensions
stable
as $$
  select k.id, k.legislation_document_id, k.title, k.chunk_text, k.chunk_index,
         1 - (k.embedding <=> p_query_embedding) as similarity
  from public.knowledge_chunks k
  where k.scope = 'legislation'
    and k.legislation_document_id is not null
    and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
  order by k.embedding <=> p_query_embedding
  limit least(greatest(p_match_count, 1), 50);
$$;

revoke all on function public.match_library_for_training(extensions.vector, int, float) from public;
revoke all on function public.match_library_for_training(extensions.vector, int, float) from authenticated;
grant execute on function public.match_library_for_training(extensions.vector, int, float) to service_role;

alter table public.training_imports
  add column if not exists reference_chunk_ids uuid[] not null default '{}';

alter table public.training_module_drafts
  add column if not exists fact_check jsonb;
