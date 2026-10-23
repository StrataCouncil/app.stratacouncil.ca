-- Stratasphere: always find the strata's own documents (2026-10-23).
--
-- A strata's documents could be indexed and still never come back from a
-- search. match_knowledge_chunks ranked every passage with the vector
-- index, which returns only the few dozen nearest passages across the
-- whole table before anything else is checked. The legislation library
-- (the BC Building Code alone is thousands of passages) fills those slots,
-- so the filter for "this strata's documents" was left with nothing, and
-- Stratasphere answered as if the document had no text.
--
-- Each scope is now searched on its own: the strata's documents and the
-- precedent pool exactly (they're small; the strata's passages come
-- straight from its own index), and the legislation library through the
-- vector index as before. Same signature and results, so the app needs no
-- change.
--
-- Safe to re-run. Paste the whole file into an empty SQL editor tab.

create or replace function public.match_knowledge_chunks(
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
declare
  v_count int := least(greatest(p_match_count, 1), 50);
begin
  if not public.has_stratasphere_access(p_corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return query
  select r.id, r.scope, r.document_id, r.title, r.source_act, r.chunk_text, r.similarity
  from (
    -- The strata's own documents: exact. "+ 0" keeps the planner off the
    -- vector index, so the strata's passages are never crowded out.
    (select k.id, k.scope, k.document_id, k.title, k.source_act, k.chunk_text,
            1 - (k.embedding <=> p_query_embedding) as similarity
     from public.knowledge_chunks k
     left join public.documents d on d.id = k.document_id
     where (p_scopes is null or 'corporation' = any (p_scopes))
       and k.scope = 'corporation' and k.corporation_id = p_corporation_id
       and (d.id is null or d.is_current)
       and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
     order by (k.embedding <=> p_query_embedding) + 0
     limit v_count)
    union all
    -- Precedent from other stratas: exact, for the same reason.
    (select k.id, k.scope, k.document_id, k.title, k.source_act, k.chunk_text,
            1 - (k.embedding <=> p_query_embedding)
     from public.knowledge_chunks k
     left join public.documents d on d.id = k.document_id
     where (p_scopes is null or 'global_precedent' = any (p_scopes))
       and k.scope = 'global_precedent' and k.source_corporation_id is distinct from p_corporation_id
       and (d.id is null or d.is_current)
       and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
     order by (k.embedding <=> p_query_embedding) + 0
     limit v_count)
    union all
    -- Legislation: the large library, through the vector index.
    (select k.id, k.scope, k.document_id, k.title, k.source_act, k.chunk_text,
            1 - (k.embedding <=> p_query_embedding)
     from public.knowledge_chunks k
     where (p_scopes is null or 'legislation' = any (p_scopes))
       and k.scope = 'legislation'
       and 1 - (k.embedding <=> p_query_embedding) >= p_match_threshold
     order by k.embedding <=> p_query_embedding
     limit v_count)
  ) r
  order by r.similarity desc
  limit v_count;
end;
$$;
revoke all on function public.match_knowledge_chunks(text, extensions.vector, int, float, text[]) from public;
grant execute on function public.match_knowledge_chunks(text, extensions.vector, int, float, text[]) to authenticated;
