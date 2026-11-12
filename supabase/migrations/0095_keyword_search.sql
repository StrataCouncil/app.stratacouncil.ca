-- 0095: keyword search over a strata's own passages (PR 5,
-- docs/learn-decide-remember.md §7, gap 3).
--
-- Stratasphere's search is by meaning only (match_knowledge_chunks, 0064),
-- which can miss exact strings: "SL12", "bylaw 7.3", a contractor's name,
-- an invoice number. This runs alongside it:
--
--   p_exact  Strings that must appear as written (lot numbers, bylaw
--            numbers, quoted phrases), matched case-insensitively. Every
--            such passage is returned (up to 40), ranked first.
--   p_terms  The question's words, matched by Postgres full-text search
--            (any of them, English stemming), ranked; the best p_count.
--
-- Only the strata's own, current documents (scope 'corporation'), never
-- precedent from other stratas or legislation. Same access rule as the
-- meaning search: Stratasphere access to this strata (subscribed; council,
-- manager, or admin), checked here, as the table has no client policies.
--
-- The passages are already PII-stripped (they're stored that way), and the
-- app strips the question before building the strings.
--
-- One strata's passages are few (thousands at most), read through the
-- existing knowledge_chunks_corporation_idx, so no new index is needed.
--
-- Safe to re-run: create or replace only.
-- Grants: execute to authenticated only (revoked from public and anon).

create or replace function public.keyword_knowledge_chunks(
  p_corporation_id text,
  p_terms text[],
  p_exact text[] default '{}',
  p_count int default 8
)
returns table (
  id uuid,
  document_id uuid,
  title text,
  chunk_text text,
  exact boolean,
  rank float
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_count int := least(greatest(coalesce(p_count, 8), 1), 30);
  v_exact text[] := array(
    select lower(trim(e)) from unnest(coalesce(p_exact, '{}')) e
    where length(trim(e)) between 2 and 120
    limit 12
  );
  v_query tsquery;
  v_part tsquery;
  v_term text;
begin
  if not public.has_stratasphere_access(p_corporation_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Any of the words: each through plainto_tsquery (so nothing in a word is
  -- read as query syntax), joined with OR.
  foreach v_term in array coalesce(p_terms[1:16], '{}') loop
    if length(v_term) between 2 and 60 then
      v_part := plainto_tsquery('english', v_term);
      if numnode(v_part) > 0 then
        v_query := case when v_query is null then v_part else v_query || v_part end;
      end if;
    end if;
  end loop;

  return query
  with own as (
    select k.id, k.document_id, k.title, k.chunk_text
    from public.knowledge_chunks k
    left join public.documents d on d.id = k.document_id
    where k.scope = 'corporation' and k.corporation_id = p_corporation_id
      and (d.id is null or d.is_current)
  ),
  exact_hits as (
    select o.id, o.document_id, o.title, o.chunk_text, true as exact, 1.0::float as rank
    from own o
    where cardinality(v_exact) > 0
      and exists (select 1 from unnest(v_exact) e where position(e in lower(o.chunk_text)) > 0)
    limit 40
  ),
  word_hits as (
    select o.id, o.document_id, o.title, o.chunk_text, false as exact,
           ts_rank_cd(to_tsvector('english', o.chunk_text), v_query)::float as rank
    from own o
    where v_query is not null
      and to_tsvector('english', o.chunk_text) @@ v_query
      and o.id not in (select x.id from exact_hits x)
    order by 6 desc
    limit v_count
  )
  select * from exact_hits
  union all
  select * from word_hits;
end;
$$;

revoke all on function public.keyword_knowledge_chunks(text, text[], text[], int) from public, anon;
grant execute on function public.keyword_knowledge_chunks(text, text[], text[], int) to authenticated;
