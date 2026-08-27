-- The Runaway Loop Guard: a ceiling on how many times a graph may execute a
-- node, not just on how many nodes it may plan.
--
-- `ai_docs` (Drive) -> FinOps Engine -> Runaway-loop-guard specifies a
-- recursion limit of 15, anchored in `finops_budget_controls` per workspace and
-- validated at RUNTIME as the DAG progresses, halting with a descriptive
-- exception when depth exceeds the cap.
--
-- The column has existed since migration ...04 and only half of that was built:
-- `max_agent_loop_recursion` is read at launch and used to cap PLAN SIZE. That
-- bounds how many steps a planner may emit and nothing else. It cannot see the
-- loop the guard exists for, because a runaway here is not a large plan — it is
-- a SMALL plan re-entered without end:
--
--     node escalates -> human approves -> resume -> node escalates -> ...
--
-- Every cycle is a fresh model call, a fresh set of tool hops, and a fresh
-- charge. The queue's `max_attempts` does not bound it: each HITL resolution
-- dispatches a NEW job, so the attempt counter starts over every time.
--
-- `agent_node_executions.retry_count` has existed since migration ...02 with no
-- writer and no reader — the same shape of defect as `sla_breach_events` and
-- `fail_agent_job`'s `failed` status. It becomes the counter here, and is
-- renamed: it is incremented on the FIRST execution, so a column called
-- `retry_count` reading 1 for a node that was never retried is a lie of exactly
-- the kind this codebase keeps having to dig out. Nothing referenced it, so the
-- rename costs nothing.

alter table public.agent_node_executions
    rename column retry_count to attempt_count;

comment on column public.agent_node_executions.attempt_count is
    'Times this node has been entered for execution, across retries and HITL resumptions. 1 after a clean single run, not 0.';

-- A halt distinct from `halted_finops`.
--
-- Both stop a run to protect the budget, but the operator's remedy is opposite:
-- a budget halt is resolved by RAISING the cap and resuming, and the run then
-- finishes. Resuming a looping graph the same way just loops again. Reporting
-- them as the same status would send the operator to the billing screen for an
-- agent that is broken.
alter type public.graph_status_enum add value if not exists 'halted_loop_guard';

/**
 * Takes one execution attempt against the workspace's recursion limit.
 *
 * Checks BEFORE incrementing, so a graph that is already at its ceiling does
 * not spend attempts on being told it is at its ceiling. Otherwise every resume
 * an operator tried would push the counter further past the cap, and raising
 * the limit to 20 would find the graph already at 23 through nothing but failed
 * resumptions.
 *
 * Check and increment are one statement for the same reason `record_spend` is:
 * split into a read and a write they are a race, and the answer to "may I run?"
 * has to come from the same statement that consumes the permission. At most one
 * job per graph is active (migration ...16), so this is belt and braces rather
 * than the only thing holding the invariant — but the invariant it protects is
 * money.
 *
 * p_limit of 0 means unset, matching how a budget cap of 0 means unset.
 */
create or replace function public.claim_node_attempt(
    p_node_execution_id uuid,
    p_limit int
)
returns table (
    allowed boolean,
    node_attempts int,
    graph_attempts bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
    v_graph_id uuid;
    v_total bigint;
    v_node int;
begin
    select n.graph_execution_id into v_graph_id
      from public.agent_node_executions n
     where n.id = p_node_execution_id;

    if v_graph_id is null then
        allowed := false; node_attempts := 0; graph_attempts := 0;
        return next;
        return;
    end if;

    -- Serialize on the graph row before counting, so two concurrent claims
    -- cannot both read the same total and both decide they are under the cap.
    -- The lock is taken on the parent rather than on the node rows because
    -- `for update` cannot be combined with an aggregate, and because the thing
    -- being protected is a property of the GRAPH, not of any one node.
    perform 1 from public.agent_graph_executions g
     where g.id = v_graph_id for update;

    select coalesce(sum(n.attempt_count), 0) into v_total
      from public.agent_node_executions n
     where n.graph_execution_id = v_graph_id;

    if p_limit > 0 and v_total >= p_limit then
        allowed := false;
        node_attempts := (select n.attempt_count
                            from public.agent_node_executions n
                           where n.id = p_node_execution_id);
        graph_attempts := v_total;
        return next;
        return;
    end if;

    update public.agent_node_executions n
       set attempt_count = n.attempt_count + 1
     where n.id = p_node_execution_id
    returning n.attempt_count into v_node;

    allowed := true;
    node_attempts := v_node;
    graph_attempts := v_total + 1;
    return next;
end;
$fn$;

revoke all on function public.claim_node_attempt(uuid, int) from public;
grant execute on function public.claim_node_attempt(uuid, int) to service_role;
