-- doc02 §1, doc04 §5 — the knowledge base: PII-stripped document chunks
-- with voyage-3 embeddings (1024 dimensions), searched by cosine
-- similarity.
--
-- Three scopes. `corporation` chunks belong to one corporation and are
-- written for every indexed document, subscribed or not (doc01 §6:
-- indexing is free; querying is the paid part). `global_precedent` chunks
-- are an extra, identity-stripped copy written only when the corporation
-- is subscribed at indexing time; corporation_id is null and
-- source_corporation_id records provenance for audits only. `legislation`
-- is loaded by the platform.
--
-- No client policies at all: rows are written by the indexing job
-- (service role) and read only through match_knowledge_chunks, which
-- checks membership and Stratasphere access itself.

create extension if not exists vector with schema extensions;

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('legislation', 'global_precedent', 'corporation')),
  corporation_id text references public.strata_corporations(strata_plan_number),
  source_corporation_id text,
  document_id uuid references public.documents(id) on delete cascade,
  legislation_document_id uuid,
  source_act text,
  title text,
  chunk_text text not null,
  embedding extensions.vector(1024) not null,
  chunk_index int not null,
  created_at timestamptz not null default now(),
  constraint knowledge_chunks_scope_shape check (
    (scope = 'corporation' and corporation_id is not null)
    or (scope <> 'corporation' and corporation_id is null)
  )
);

create index knowledge_chunks_embedding_idx
  on public.knowledge_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index knowledge_chunks_corporation_idx on public.knowledge_chunks (corporation_id) where scope = 'corporation';
create index knowledge_chunks_document_idx on public.knowledge_chunks (document_id);

alter table public.knowledge_chunks enable row level security;

-- Stratasphere access: an active subscription. The free trial meeting
-- extends this while it's live — 0014 redefines this function once the
-- meetings table exists.
create or replace function public.has_stratasphere_access(target_corporation_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_corporation_member(target_corporation_id) and exists (
    select 1 from public.subscriptions
    where corporation_id = target_corporation_id and status = 'active'
  );
$$;

-- Semantic search for one corporation: its own chunks, plus the global
-- precedent pool and legislation. Refuses outright (rather than returning
-- nothing) when the caller has no access, so a missing gate upstream is
-- loud.
create or replace function public.match_knowledge_chunks(
  p_corporation_id text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 12,
  p_match_threshold float default 0.35
)
returns table (
  id uuid,
  scope text,
  document_id uuid,
  title text,
  source_act text,
  chunk_text text,
  similarity float
)
language plpgsql
security definer
set search_path = public, extensions
stable
as $$
begin
  if not public.has_stratasphere_access(p_corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
    select k.id, k.scope, k.document_id, k.title, k.source_act, k.chunk_text,
           1 - (k.embedding <=> p_query_embedding) as similarity
    from public.knowledge_chunks k
    left join public.documents d on d.id = k.document_id
    where (
        (k.scope = 'corporation' and k.corporation_id = p_corporation_id)
        or k.scope = 'legislation'
        or (k.scope = 'global_precedent' and k.source_corporation_id is distinct from p_corporation_id)
      )
      and (d.id is null or d.is_current)
      and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
    order by k.embedding <=> p_query_embedding
    limit least(greatest(p_match_count, 1), 50);
end;
$$;

revoke all on function public.match_knowledge_chunks(text, extensions.vector, int, float) from public;
grant execute on function public.match_knowledge_chunks(text, extensions.vector, int, float) to authenticated;
revoke all on function public.has_stratasphere_access(text) from public;
grant execute on function public.has_stratasphere_access(text) to authenticated;
