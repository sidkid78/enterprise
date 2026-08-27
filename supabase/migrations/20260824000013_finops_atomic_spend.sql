-- FinOps correctness: make spend accounting atomic, and make the budget stop
-- enforceable during a run rather than only before one.

-- ============================================================================
-- ATOMIC SPEND
-- ============================================================================
-- bumpSpend() was read-modify-write in TypeScript: SELECT current_spend_usd,
-- add, UPDATE. Two runs billing concurrently both read the same starting value
-- and the second overwrites the first, so the workspace is under-billed by
-- whatever the lost run cost. Silent, and it gets worse as concurrency rises —
-- which is the direction this is going, since tool loops multiply the number of
-- billable calls per run.
--
-- A single UPDATE ... SET x = x + delta is atomic under Postgres' row locking,
-- so concurrent callers serialize on the row instead of racing.
--
-- It also RETURNS the post-increment budget state, so a caller learns whether
-- the workspace has just gone over in the same round trip that charged it.
-- Charging and then separately asking "am I over?" is a second race.

create or replace function public.record_spend(
    p_workspace_id uuid,
    p_delta numeric
)
returns table (
    current_spend_usd numeric,
    monthly_budget_usd numeric,
    hard_stop_enabled boolean,
    over_budget boolean
)
language sql
volatile
-- SECURITY INVOKER, granted to service_role only: the runtime is the sole
-- caller. A client role able to move the spend figure could zero it and defeat
-- the budget stop entirely.
security invoker
set search_path = ''
as $$
    update public.finops_budget_controls
       set current_spend_usd = current_spend_usd + greatest(p_delta, 0),
           updated_at = now()
     where workspace_id = p_workspace_id
    returning
        current_spend_usd,
        monthly_budget_usd,
        hard_stop_enabled,
        -- A cap of 0 means "no cap set", not "no budget at all"; treating it as
        -- the latter would halt every run in a workspace nobody configured.
        (hard_stop_enabled
         and monthly_budget_usd > 0
         and current_spend_usd >= monthly_budget_usd) as over_budget;
$$;

revoke all on function public.record_spend(uuid, numeric) from public;
grant execute on function public.record_spend(uuid, numeric) to service_role;

-- Reading the budget without charging it, for the pre-flight gate and for the
-- per-node check on a run that has not spent anything yet.
create or replace function public.get_budget_state(p_workspace_id uuid)
returns table (
    current_spend_usd numeric,
    monthly_budget_usd numeric,
    hard_stop_enabled boolean,
    max_tokens_per_execution int,
    max_agent_loop_recursion int,
    over_budget boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
    select current_spend_usd,
           monthly_budget_usd,
           hard_stop_enabled,
           max_tokens_per_execution,
           max_agent_loop_recursion,
           (hard_stop_enabled
            and monthly_budget_usd > 0
            and current_spend_usd >= monthly_budget_usd) as over_budget
      from public.finops_budget_controls
     where workspace_id = p_workspace_id;
$$;

revoke all on function public.get_budget_state(uuid) from public;
grant execute on function public.get_budget_state(uuid) to authenticated, service_role;

-- ============================================================================
-- SPEND VISIBILITY
-- ============================================================================
-- Per-run totals, so the dashboard can show what a run cost without summing
-- token logs in the client. Reads finops_token_logs, whose SELECT policy is
-- workspace membership, and stays SECURITY INVOKER so that policy applies.

create or replace function public.run_spend_summary(
    p_workspace_id uuid,
    p_limit int default 20
)
returns table (
    graph_execution_id uuid,
    total_cost_usd numeric,
    total_tokens bigint,
    call_count bigint,
    tier_breakdown jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
    with per_tier as (
        select graph_execution_id,
               routing_tier,
               sum(estimated_cost_usd) as tier_cost,
               sum(prompt_tokens + completion_tokens) as tier_tokens,
               count(*) as tier_calls
          from public.finops_token_logs
         where workspace_id = p_workspace_id
         group by graph_execution_id, routing_tier
    )
    select graph_execution_id,
           sum(tier_cost) as total_cost_usd,
           sum(tier_tokens)::bigint as total_tokens,
           sum(tier_calls)::bigint as call_count,
           jsonb_object_agg(routing_tier, tier_cost) as tier_breakdown
      from per_tier
     group by graph_execution_id
     order by sum(tier_cost) desc
     limit p_limit;
$$;

revoke all on function public.run_spend_summary(uuid, int) from public;
grant execute on function public.run_spend_summary(uuid, int) to authenticated, service_role;
