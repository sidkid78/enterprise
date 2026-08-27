-- Makes the FinOps engine's own effectiveness measurable.
--
-- Four cost defences are built — the model cascade, the semantic cache, budget
-- controls and the loop guard — and none of them is observable. The dashboard
-- shows a budget bar and a per-run spend figure; nothing anywhere says how much
-- work the cache absorbed, how the tier mix actually fell out, or what any of
-- it was worth. A platform whose pitch is margin protection cannot show its own.
--
-- `ai_docs` (Drive) -> FinOps Engine -> semantic-cache specifies the missing
-- half explicitly: on a hit the system "increments the cache entry's hit_count,
-- and LOGS THE COMPUTED TOKEN SAVINGS in the finops_token_logs table". We do
-- the first and not the second.
--
-- WHAT A SAVING IS ALLOWED TO MEAN HERE.
-- The tempting figure is "what this call would have cost", which is a
-- counterfactual nobody can measure — the same fabrication the runtime is
-- forbidden from committing when it scores its own ROI. So the cache records
-- what producing that answer ACTUALLY cost the first time, and a hit reports
-- that recorded number. It is a measurement of a real past call, not a guess
-- about a hypothetical one. The distinction is worth keeping in the column
-- names and in anything that renders them.

-- What this entry cost to produce. Nullable, because entries written before
-- this migration have no recorded cost and must not claim a saving of zero
-- dollars as though it were measured — `null` says "unknown", `0` would say
-- "free".
alter table public.semantic_cache
    add column if not exists prompt_tokens int,
    add column if not exists completion_tokens int,
    add column if not exists cost_usd numeric(12,6);

comment on column public.semantic_cache.cost_usd is
    'What producing this response actually cost on the miss that created it. Null for entries predating the column — unknown, not free.';

-- Savings sit in their own columns, never in estimated_cost_usd.
--
-- `estimated_cost_usd` is summed by run_spend_summary, by record_spend and by
-- the budget gate. Putting an avoided cost there would inflate real spend and
-- could halt a workspace for money it did not spend — a saving recorded as a
-- charge is worse than no saving recorded at all.
alter table public.finops_token_logs
    add column if not exists avoided_cost_usd numeric(12,6) not null default 0,
    add column if not exists avoided_tokens int not null default 0;

comment on column public.finops_token_logs.avoided_cost_usd is
    'Cost NOT incurred because a cache hit served this step, taken from what the cached answer cost when first produced. Never spend; never summed into it.';

drop function if exists public.match_semantic_cache(uuid, extensions.vector, double precision, int, uuid);

/**
 * Cache lookup, now returning what the entry cost to make.
 *
 * The caller needs it at hit time: the saving has to be written onto the same
 * `finops_token_logs` row as the hit, or the two have to be joined later by
 * guesswork.
 */
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
    similarity double precision,
    prompt_tokens int,
    completion_tokens int,
    cost_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
    select c.id,
           c.query_text,
           c.response_payload,
           c.model_used,
           1 - (c.query_embedding OPERATOR(extensions.<=>) p_query_embedding) as similarity,
           c.prompt_tokens,
           c.completion_tokens,
           c.cost_usd
    from public.semantic_cache c
    where c.workspace_id = p_workspace_id
      and (c.expires_at is null or c.expires_at > now())
      and (p_exclude_graph_id is null
           or c.graph_execution_id is distinct from p_exclude_graph_id)
      and 1 - (c.query_embedding OPERATOR(extensions.<=>) p_query_embedding) >= p_similarity_threshold
    order by c.query_embedding OPERATOR(extensions.<=>) p_query_embedding
    limit p_limit;
$$;

revoke all on function public.match_semantic_cache(uuid, extensions.vector, double precision, int, uuid) from public;
grant execute on function public.match_semantic_cache(uuid, extensions.vector, double precision, int, uuid) to service_role;

/**
 * What the cost controls actually did, over a window.
 *
 * SECURITY INVOKER, so a caller measures only their own workspace — as DEFINER
 * this would become a cross-tenant spend report, the same objection that keeps
 * `workspace_availability` and `verify_ledger_chain` invoker-scoped.
 *
 * Everything returned is counted from rows that were written as work happened.
 * There is deliberately no "projected spend", no "savings rate" and no
 * annualised figure: those are forecasts, and this platform does not present
 * forecasts as measurements.
 */
create or replace function public.workspace_finops_summary(
    p_workspace_id uuid,
    p_window_hours int default 168
)
returns table (
    window_hours int,
    total_spend_usd numeric,
    model_calls bigint,
    cache_hits bigint,
    -- Hits with a recorded production cost. The avoided total covers only
    -- these; a hit on a pre-migration entry is counted as a hit and
    -- contributes nothing to the money figure, so the two are not the same
    -- number and must not be rendered as if they were.
    cache_hits_priced bigint,
    avoided_cost_usd numeric,
    avoided_tokens bigint,
    cheap_calls bigint,
    default_calls bigint,
    reasoning_calls bigint,
    critic_calls bigint,
    total_tokens bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
    with logs as (
        select *
          from public.finops_token_logs
         where workspace_id = p_workspace_id
           and created_at >= now() - make_interval(hours => p_window_hours)
    )
    select p_window_hours,
           coalesce(sum(estimated_cost_usd), 0)::numeric,
           count(*) filter (where routing_tier <> 'semantic_cache_hit'),
           count(*) filter (where routing_tier = 'semantic_cache_hit'),
           count(*) filter (where routing_tier = 'semantic_cache_hit'
                              and avoided_cost_usd > 0),
           coalesce(sum(avoided_cost_usd), 0)::numeric,
           coalesce(sum(avoided_tokens), 0)::bigint,
           count(*) filter (where routing_tier = 'model_cascade_cheap'),
           count(*) filter (where routing_tier = 'model_cascade_default'),
           count(*) filter (where routing_tier = 'model_cascade_reasoning'),
           count(*) filter (where routing_tier = 'critic_gate'),
           coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint
      from logs;
$$;

revoke all on function public.workspace_finops_summary(uuid, int) from public;
grant execute on function public.workspace_finops_summary(uuid, int) to authenticated, service_role;
