-- Pillar 5: hybrid RAG — parent/child document store with dense vector search
-- (pgvector HNSW) fused against sparse full-text search (tsvector + GIN) by
-- Reciprocal Rank Fusion.
--
-- Parent/child split: chunks are embedded small so retrieval is precise, but
-- what the worker reads is the parent document, so it gets the surrounding
-- context a short chunk cannot carry.

create table public.knowledge_bases (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    name text not null,
    description text,
    created_at timestamptz not null default now(),
    unique (workspace_id, name)
);

create index idx_knowledge_bases_workspace on public.knowledge_bases(workspace_id);

create table public.document_parents (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
    document_title text not null,
    source_uri text,
    full_content text not null,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

create index idx_document_parents_kb on public.document_parents(knowledge_base_id, created_at desc);
create index idx_document_parents_workspace on public.document_parents(workspace_id);

create table public.document_chunks (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    parent_id uuid not null references public.document_parents(id) on delete cascade,
    knowledge_base_id uuid not null references public.knowledge_bases(id) on delete cascade,
    chunk_index int not null,
    chunk_content text not null,
    -- 768 dims, matching the semantic cache: gemini-embedding-001 defaults to
    -- 3072, but HNSW caps `vector` at 2000. See migration ...04 for the full
    -- rationale. Both stores must agree or the embeddings are not comparable.
    embedding extensions.vector(768) not null,
    -- The regconfig is cast explicitly rather than passed as a bare string:
    -- to_tsvector(regconfig, text) is IMMUTABLE and so allowed in a generated
    -- column, while the one-argument form is only STABLE and is rejected.
    fts_tokens tsvector generated always as (
        to_tsvector('pg_catalog.english'::regconfig, chunk_content)
    ) stored,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    unique (parent_id, chunk_index)
);

create index idx_document_chunks_vector on public.document_chunks
    using hnsw (embedding extensions.vector_cosine_ops)
    with (m = 16, ef_construction = 64);

create index idx_document_chunks_fts on public.document_chunks using gin (fts_tokens);

create index idx_document_chunks_tenant
    on public.document_chunks(workspace_id, knowledge_base_id);

-- ============================================================================
-- RLS
-- ============================================================================

alter table public.knowledge_bases enable row level security;
alter table public.document_parents enable row level security;
alter table public.document_chunks enable row level security;

create policy knowledge_bases_select on public.knowledge_bases
    for select to authenticated using (private.is_workspace_member(workspace_id));

create policy knowledge_bases_insert on public.knowledge_bases
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy knowledge_bases_update on public.knowledge_bases
    for update to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy knowledge_bases_delete on public.knowledge_bases
    for delete to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy document_parents_select on public.document_parents
    for select to authenticated using (private.is_workspace_member(workspace_id));

create policy document_parents_insert on public.document_parents
    for insert to authenticated
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy document_parents_delete on public.document_parents
    for delete to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

-- Chunks are readable so a reviewer can see what a citation actually said.
-- Writes belong to the ingestion pipeline alone: a chunk row is only meaningful
-- alongside an embedding produced by the same model, and a client cannot make
-- one.
create policy document_chunks_select on public.document_chunks
    for select to authenticated using (private.is_workspace_member(workspace_id));

grant select, insert, update, delete on public.knowledge_bases to authenticated;
grant select, insert, delete on public.document_parents to authenticated;
grant select on public.document_chunks to authenticated;

-- ============================================================================
-- HYBRID SEARCH (Reciprocal Rank Fusion)
-- ============================================================================
-- Deviates from the blueprint, which declares this SECURITY DEFINER with
-- search_path = public. That would be a tenant-isolation hole: DEFINER bypasses
-- RLS, so any authenticated caller could pass another workspace's id and read
-- its documents. SECURITY INVOKER granted only to service_role matches
-- match_semantic_cache and keeps the runtime the only caller, which must
-- therefore verify workspace membership itself, as it already does for
-- launchGraph.

create or replace function public.hybrid_search_knowledge_chunks(
    p_workspace_id uuid,
    p_query_text text,
    p_query_embedding extensions.vector(768),
    p_knowledge_base_id uuid default null,
    p_match_count int default 5,
    p_rrf_k int default 60
)
returns table (
    chunk_id uuid,
    parent_id uuid,
    chunk_content text,
    parent_full_content text,
    document_title text,
    source_uri text,
    combined_score double precision
)
language sql
stable
security invoker
set search_path = ''
as $fn$
    with dense_search as (
        select dc.id,
               row_number() over (
                   order by dc.embedding OPERATOR(extensions.<=>) p_query_embedding
               ) as dense_rank
        from public.document_chunks dc
        where dc.workspace_id = p_workspace_id
          and (p_knowledge_base_id is null
               or dc.knowledge_base_id = p_knowledge_base_id)
        order by dc.embedding OPERATOR(extensions.<=>) p_query_embedding
        limit p_match_count * 2
    ),
    sparse_search as (
        select dc.id,
               row_number() over (
                   order by ts_rank_cd(
                       dc.fts_tokens,
                       plainto_tsquery('pg_catalog.english'::regconfig, p_query_text)
                   ) desc
               ) as sparse_rank
        from public.document_chunks dc
        where dc.workspace_id = p_workspace_id
          and (p_knowledge_base_id is null
               or dc.knowledge_base_id = p_knowledge_base_id)
          and dc.fts_tokens @@ plainto_tsquery('pg_catalog.english'::regconfig, p_query_text)
        order by ts_rank_cd(
            dc.fts_tokens,
            plainto_tsquery('pg_catalog.english'::regconfig, p_query_text)
        ) desc
        limit p_match_count * 2
    ),
    -- Fused by RANK, never by raw score. Cosine distance and ts_rank_cd are on
    -- incomparable scales, so blending the scores directly would just return
    -- whichever happens to have the larger magnitude.
    rrf_scores as (
        select coalesce(d.id, s.id) as id,
               coalesce(1.0 / (p_rrf_k + d.dense_rank), 0.0)
             + coalesce(1.0 / (p_rrf_k + s.sparse_rank), 0.0) as score
        from dense_search d
        full outer join sparse_search s on d.id = s.id
    )
    select dc.id,
           dp.id,
           dc.chunk_content,
           dp.full_content,
           dp.document_title,
           dp.source_uri,
           r.score::double precision
    from rrf_scores r
    join public.document_chunks dc on dc.id = r.id
    join public.document_parents dp on dp.id = dc.parent_id
    order by r.score desc
    limit p_match_count;
$fn$;

revoke all on function public.hybrid_search_knowledge_chunks(
    uuid, text, extensions.vector, uuid, int, int) from public;
grant execute on function public.hybrid_search_knowledge_chunks(
    uuid, text, extensions.vector, uuid, int, int) to service_role;
