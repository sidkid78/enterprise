-- Pillar 4: FinOps budget controls, token accounting, and the semantic cache.

create table public.finops_budget_controls (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
    monthly_budget_usd numeric(12,4) not null default 1000.00,
    current_spend_usd numeric(12,4) not null default 0.00,
    max_tokens_per_execution int not null default 500000,
    max_agent_loop_recursion int not null default 15,
    hard_stop_enabled boolean not null default true,
    updated_at timestamptz not null default now()
);

create trigger trg_finops_budget_updated_at
    before update on public.finops_budget_controls
    for each row execute function private.set_updated_at();

create table public.finops_token_logs (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid references public.agent_graph_executions(id) on delete cascade,
    node_execution_id uuid references public.agent_node_executions(id) on delete cascade,
    model_name text not null,
    prompt_tokens int not null default 0,
    completion_tokens int not null default 0,
    cached_tokens int not null default 0,
    estimated_cost_usd numeric(10,6) not null default 0.000000,
    routing_tier text not null default 'model_cascade_cheap',
    created_at timestamptz not null default now()
);

create index idx_token_logs_workspace on public.finops_token_logs(workspace_id, created_at desc);
create index idx_token_logs_graph on public.finops_token_logs(graph_execution_id);

-- ============================================================================
-- SEMANTIC CACHE
-- ============================================================================
-- Embedding model: gemini-embedding-001 at 768 dimensions.
--
-- That model defaults to 3072 dims and supports 128-3072 (768 / 1536 / 3072
-- recommended). 768 is chosen deliberately, not inherited:
--
--   * pgvector's HNSW index caps the `vector` type at 2000 dimensions, so a
--     vector(3072) column CANNOT carry the index this cache depends on. Storing
--     3072 would require the `halfvec` type (4000-dim index ceiling) and a
--     halfvec_cosine_ops index instead.
--   * Only 3072-dim output is normalized automatically. At 768 the embedding
--     MUST be L2-normalized client-side before insert, or cosine distance —
--     and therefore the >0.92 similarity threshold — is meaningless.
--
-- Both constraints are enforced in the runtime, not the schema. See
-- src/lib/genai/embeddings.ts when phase 4 lands.
create extension if not exists vector with schema extensions;

create table public.semantic_cache (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    query_text text not null,
    query_embedding extensions.vector(768) not null,
    response_payload jsonb not null,
    model_used text not null,
    hit_count int not null default 0,
    created_at timestamptz not null default now(),
    expires_at timestamptz
);

create index idx_semantic_cache_vector on public.semantic_cache
    using hnsw (query_embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);
create index idx_semantic_cache_workspace on public.semantic_cache(workspace_id);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.finops_budget_controls enable row level security;
alter table public.finops_token_logs enable row level security;
alter table public.semantic_cache enable row level security;

create policy finops_budget_select on public.finops_budget_controls
    for select to authenticated using (private.is_workspace_member(workspace_id));

create policy finops_budget_update on public.finops_budget_controls
    for update to authenticated
    using (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]))
    with check (private.has_workspace_role(
        workspace_id, array['workspace_owner', 'ai_administrator']::public.user_role_enum[]));

create policy finops_token_logs_select on public.finops_token_logs
    for select to authenticated using (private.is_workspace_member(workspace_id));

-- The semantic cache holds verbatim prompt text and model responses, which is
-- the highest-PII-risk table in the schema. No client access at all: the
-- runtime reads and writes it with the service role.
-- RLS is enabled with no policies, so every Data API request returns zero rows.

grant select on public.finops_budget_controls to authenticated;
grant update on public.finops_budget_controls to authenticated;
grant select on public.finops_token_logs to authenticated;
