-- Semantic cache lookup for the FinOps router.
--
-- Cosine distance against the HNSW index on semantic_cache.query_embedding.
-- Embeddings are L2-normalized client-side (see src/lib/genai/embeddings.ts),
-- which is what makes `1 - (a <=> b)` a meaningful similarity score here.
--
-- The distance operator is written as OPERATOR(extensions.<=>) because
-- `search_path = ''` puts pgvector's operators out of scope; the bare `<=>`
-- fails to resolve. This form still matches the HNSW vector_cosine_ops index.

create or replace function public.match_semantic_cache(
    p_workspace_id uuid,
    p_query_embedding extensions.vector(768),
    p_similarity_threshold double precision default 0.92,
    p_limit int default 1
)
returns table (
    id uuid,
    query_text text,
    response_payload jsonb,
    model_used text,
    similarity double precision
)
language sql
stable
-- SECURITY INVOKER: the only caller is the runtime's service_role client,
-- which already bypasses RLS. Making this DEFINER would hand every role a way
-- to read another tenant's cached prompts.
security invoker
set search_path = ''
as $$
    select c.id,
           c.query_text,
           c.response_payload,
           c.model_used,
           1 - (c.query_embedding OPERATOR(extensions.<=>) p_query_embedding) as similarity
    from public.semantic_cache c
    where c.workspace_id = p_workspace_id
      and (c.expires_at is null or c.expires_at > now())
      and 1 - (c.query_embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_similarity_threshold
    order by c.query_embedding OPERATOR(extensions.<=>) p_query_embedding
    limit p_limit;
$$;

-- Not callable by browser-facing roles: the cache stores verbatim prompts.
revoke all on function public.match_semantic_cache(uuid, extensions.vector, double precision, int) from public;
grant execute on function public.match_semantic_cache(uuid, extensions.vector, double precision, int) to service_role;

-- Records a cache hit without a read-modify-write race between concurrent runs.
create or replace function public.record_cache_hit(p_cache_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
    update public.semantic_cache
       set hit_count = hit_count + 1
     where id = p_cache_id;
$$;

revoke all on function public.record_cache_hit(uuid) from public;
grant execute on function public.record_cache_hit(uuid) to service_role;
