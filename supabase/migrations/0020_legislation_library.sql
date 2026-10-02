-- The legislation library (doc04 §5): BC Acts, regulations and official
-- guidance that Stratasphere quotes and cites. Loaded by Super Admins only,
-- never by a corporation. Safe to run more than once. Run the whole file
-- in one go.
--
-- Each library entry is indexed into knowledge_chunks with
-- scope = 'legislation': one chunk per section for Acts and regulations
-- (so an answer can cite "Strata Property Act, s. 45"), ordinary chunks
-- for guidance.

create table if not exists public.legislation_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  short_name text check (short_name is null or char_length(short_name) between 1 and 30),
  kind text not null default 'act' check (kind in ('act', 'regulation', 'guidance')),
  current_to date,
  file_name text,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  document_text text,
  indexing_status text not null default 'pending'
    check (indexing_status in ('pending', 'processing', 'indexed', 'needs_text', 'not_indexable', 'failed')),
  indexing_error text,
  section_count int,
  chunk_count int,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  indexed_at timestamptz
);

alter table public.legislation_documents enable row level security;

drop policy if exists "super admins" on public.legislation_documents;
create policy "super admins" on public.legislation_documents
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select, insert, update, delete on public.legislation_documents to authenticated;
grant all on public.legislation_documents to service_role;

-- Chunks go when their library entry goes.
alter table public.knowledge_chunks drop constraint if exists knowledge_chunks_legislation_document_id_fkey;
alter table public.knowledge_chunks
  add constraint knowledge_chunks_legislation_document_id_fkey
  foreign key (legislation_document_id) references public.legislation_documents(id) on delete cascade;
create index if not exists knowledge_chunks_legislation_idx on public.knowledge_chunks (legislation_document_id);

-- Private bucket; files are written with signed upload URLs minted for
-- Super Admins and read only by the indexer (service role).
insert into storage.buckets (id, name, public, file_size_limit)
values ('legislation', 'legislation', false, 52428800)
on conflict (id) do nothing;

-- Search can now be limited to some scopes, so legislation gets its own
-- share of every answer instead of competing with the strata's documents.
drop function if exists public.match_knowledge_chunks(text, extensions.vector, int, float);
drop function if exists public.match_knowledge_chunks(text, extensions.vector, int, float, text[]);
create function public.match_knowledge_chunks(
  p_corporation_id text,
  p_query_embedding extensions.vector(1024),
  p_match_count int default 12,
  p_match_threshold float default 0.35,
  p_scopes text[] default null
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
      and (p_scopes is null or k.scope = any (p_scopes))
      and (d.id is null or d.is_current)
      and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
    order by k.embedding <=> p_query_embedding
    limit least(greatest(p_match_count, 1), 50);
end;
$$;

revoke all on function public.match_knowledge_chunks(text, extensions.vector, int, float, text[]) from public;
grant execute on function public.match_knowledge_chunks(text, extensions.vector, int, float, text[]) to authenticated;
