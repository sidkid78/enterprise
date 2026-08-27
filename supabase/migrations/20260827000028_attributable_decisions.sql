-- Makes a human decision attributable to the human who made it.
--
-- The audit ledger is this product's central claim: hash-chained, append-only,
-- tamper-evident. Asked "who approved the $14,500 payout", it answers
-- `agent_id: "HumanReviewer"` — a constant string, identical on every row —
-- with a payload carrying the gate id and the feedback and nothing else. The
-- most consequential events in the system are the ones a person authorised, and
-- those are exactly the ones the ledger could not attribute.
--
-- `ai_docs` (Drive) -> Stateful HITL Gates -> Role-based access-control is
-- explicit that this belongs there: the chain hash combines "the previous
-- block's hash, the transaction details, and THE OPERATOR'S ID".
--
-- `hitl_approval_gates.resolved_by` and `resolved_at` have been written since
-- Phase 3 and read by nothing. A resolved gate simply disappears from the
-- interface — there is no view anywhere of who decided what.
--
-- Two things are needed, and the second is the one with a design problem:
--   1. Put the resolver on the ledger row. Easy: the worker reads the gate.
--   2. Render an identity. `resolved_by` is a uuid, `authenticated` cannot read
--      auth.users, and "approved by c91ea881" is not an audit record anyone can
--      act on.

/**
 * Names the people in a workspace.
 *
 * SECURITY DEFINER because `auth.users` is unreadable by `authenticated`, and
 * the membership check is therefore explicit — the same shape as
 * `expire_hitl_gate`.
 *
 * This is NOT the email-existence oracle that invitations were designed to
 * avoid (migration ...23). The difference is the direction of the question: the
 * oracle answers "does an account exist for this address?" for any address a
 * caller invents, whereas this answers "what are the addresses of the people
 * already on my roster?" — a list the caller can already enumerate as user ids
 * through `workspace_members`. It adds no membership information, only the name
 * attached to a row already visible.
 *
 * Restricted to members: someone outside the workspace gets nothing at all,
 * not an empty list they could probe with.
 */
create or replace function public.workspace_member_directory(
    p_workspace_id uuid
)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $fn$
    select m.user_id, u.email::text
      from public.workspace_members m
      join auth.users u on u.id = m.user_id
     where m.workspace_id = p_workspace_id
       and private.is_workspace_member(p_workspace_id);
$fn$;

revoke all on function public.workspace_member_directory(uuid) from public;
grant execute on function public.workspace_member_directory(uuid) to authenticated, service_role;

/**
 * Decisions a person made on this workspace's gates.
 *
 * Resolved gates were previously invisible: `getPendingGates` filters to open
 * ones, so the moment a reviewer acted the record left the interface. For a
 * governance product the decision log is not a nice-to-have view — it is the
 * evidence the controls were exercised.
 *
 * SECURITY INVOKER, so `hitl_select` decides what the caller sees. An operator
 * reads the decisions on gates at their own level; the ledger roles see more.
 * The alternative — one workspace-wide history — would leak the existence and
 * subject of gates a viewer may not open.
 */
create or replace function public.workspace_decision_history(
    p_workspace_id uuid,
    p_limit int default 50
)
returns table (
    gate_id uuid,
    graph_execution_id uuid,
    node_id text,
    agent_role text,
    trigger_reason text,
    required_role public.user_role_enum,
    status public.hitl_status_enum,
    confidence_score numeric,
    human_feedback text,
    resolved_by uuid,
    resolved_at timestamptz,
    created_at timestamptz,
    /** How long the gate waited. Measured, not derived at render time. */
    wait_seconds numeric
)
language sql
stable
security invoker
set search_path = ''
as $fn$
    select g.id,
           g.graph_execution_id,
           n.node_id,
           n.agent_role,
           g.trigger_reason,
           g.required_role,
           g.status,
           g.confidence_score,
           g.human_feedback,
           g.resolved_by,
           g.resolved_at,
           g.created_at,
           extract(epoch from coalesce(g.resolved_at, now()) - g.created_at)::numeric
      from public.hitl_approval_gates g
      left join public.agent_node_executions n on n.id = g.node_execution_id
     where g.workspace_id = p_workspace_id
       and g.status not in ('pending', 'escalated')
     order by g.resolved_at desc nulls last
     limit p_limit;
$fn$;

revoke all on function public.workspace_decision_history(uuid, int) from public;
grant execute on function public.workspace_decision_history(uuid, int) to authenticated, service_role;

-- ============================================================================
-- Expiry was invisible to the ledger
-- ============================================================================
-- `expire_hitl_gate` (migration ...26) fails a node and terminates a run, and
-- wrote no ledger entry at all. Every other terminal outcome — approval,
-- rejection, budget halt, token halt, loop guard — is recorded. An operator
-- ending a run was the one consequential act that left no trace.

create or replace function public.expire_hitl_gate(
    p_gate_id uuid,
    p_reason text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
    v_gate record;
    v_actor uuid := (select auth.uid());
begin
    select g.id, g.workspace_id, g.required_role, g.graph_execution_id,
           g.node_execution_id, g.status, g.created_at
      into v_gate
      from public.hitl_approval_gates g
     where g.id = p_gate_id;

    if v_gate.id is null then
        return 'not_found';
    end if;

    if not private.has_role_power(v_gate.workspace_id, v_gate.required_role) then
        return 'forbidden';
    end if;

    if v_gate.status not in ('pending', 'escalated') then
        return 'not_open';
    end if;

    if v_gate.created_at >= now() - make_interval(
            hours => private.hitl_review_sla_hours()) then
        return 'not_overdue';
    end if;

    update public.hitl_approval_gates
       set status = 'timed_out',
           human_feedback = coalesce(
               p_reason,
               'Expired: no decision within the review window.'),
           resolved_by = v_actor,
           resolved_at = now()
     where id = p_gate_id;

    if v_gate.node_execution_id is not null then
        update public.agent_node_executions
           set node_status = 'failed'
         where id = v_gate.node_execution_id;
    end if;

    update public.agent_graph_executions
       set status = 'failed', completed_at = now()
     where id = v_gate.graph_execution_id;

    -- previous_hash/current_hash are overwritten by the compute_ledger_hash
    -- trigger; whatever is sent here is discarded.
    insert into public.agent_audit_ledger
        (workspace_id, graph_execution_id, node_execution_id, agent_id,
         action_type, payload, previous_hash, current_hash)
    values
        (v_gate.workspace_id, v_gate.graph_execution_id, v_gate.node_execution_id,
         'HumanReviewer', 'hitl_expiry',
         jsonb_build_object(
             'gate_id', p_gate_id,
             'operator_id', v_actor,
             'required_role', v_gate.required_role,
             'waited_seconds',
                 round(extract(epoch from now() - v_gate.created_at)),
             'reason', coalesce(p_reason,
                 'Expired: no decision within the review window.')
         ),
         '', '');

    return 'expired';
end;
$fn$;

revoke all on function public.expire_hitl_gate(uuid, text) from public;
grant execute on function public.expire_hitl_gate(uuid, text) to authenticated, service_role;
