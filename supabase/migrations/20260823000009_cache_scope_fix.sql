-- Fixes a correctness bug in the semantic cache.
--
-- Sibling nodes in one run share priorContext and have related objectives, so
-- their inputs scored above the 0.92 similarity threshold against each other.
-- The cache then served node 1's output to nodes 2, 3 and 4, and the run
-- reported "completed" having produced four identical steps.
--
-- Two changes:
--   1. Entries record the run that produced them, and a lookup excludes its own
--      run. Cross-run reuse (the actual FinOps win) is preserved; intra-run
--      collapse becomes structurally impossible rather than threshold-dependent.
--   2. The default threshold rises 0.92 -> 0.97. For agent steps, a wrong hit
--      silently fabricates work, so near-identical is the only safe bar. Repeat
--      runs of the same prompt still score ~1.0 and still hit.

alter table public.semantic_cache
    add column if not exists graph_execution_id uuid
        references public.agent_graph_executions(id) on delete set null;

create index if not exists idx_semantic_cache_graph
    on public.semantic_cache(graph_execution_id);

-- Existing rows predate the fix and cannot be attributed to a run, so they
-- would never be excludable. Clearing is safe: a cache is rebuildable by
-- definition, and these are the entries that caused the bug.
delete from public.semantic_cache where graph_execution_id is null;

drop function if exists public.match_semantic_cache(uuid, extensions.vector, double precision, int);

create or replace function public.match_semantic_cache(
    p_workspace_id uuid,
    p_query_embedding extensions.vector(768),
    p_similarity_threshold double precision default 0.97,
    p_limit int default 1,
    p_exclude_graph_id uuid default null
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
      -- Never serve an entry produced by the run currently executing.
      and (p_exclude_graph_id is null
           or c.graph_execution_id is distinct from p_exclude_graph_id)
      and 1 - (c.query_embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_similarity_threshold
    order by c.query_embedding OPERATOR(extensions.<=>) p_query_embedding
    limit p_limit;
$$;

revoke all on function public.match_semantic_cache(uuid, extensions.vector, double precision, int, uuid) from public;
grant execute on function public.match_semantic_cache(uuid, extensions.vector, double precision, int, uuid) to service_role;
