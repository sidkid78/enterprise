-- Makes a gate nobody answers visible, and gives an operator a way to close it.
--
-- `hitl_status_enum` has carried 'timed_out' since migration ...03 with nothing
-- ever writing it. The blueprint declares the same value (`database_arch copy`,
-- `summary copy`) and likewise never says what produces it. So a gate that no
-- one resolves stays `pending` forever: it holds no worker, blocks no queue,
-- raises no alarm, and the run behind it is frozen with nothing anywhere saying
-- so. Confirmed on this database — a gate had been pending for 111 hours.
--
-- Same defect as `fail_agent_job` writing `failed` with no reader, and the same
-- shape as the escalation dead end: work that is not happening, presented as
-- nothing at all.
--
-- WHY EXPIRY IS AN ACTION AND NOT A SWEEP.
-- The obvious build is a background job that flips old gates to `timed_out`.
-- That is rejected here. A gate exists because a decision needs a human; having
-- the platform close it by clock is the platform deciding by inaction, which is
-- the failure mode the gate was created to prevent. Worse, it would terminate a
-- run for a reason no person ever reviewed.
--
-- What the platform can honestly do is MEASURE the wait and say so loudly. A
-- person then chooses to expire the gate, and that choice is recorded as theirs.
--
-- (An earlier draft of this migration expired gates automatically once they
-- passed the Interactions API's state-retention window, on the grounds that
-- resume becomes impossible when the interaction to chain from is gone. That
-- was dropped: the retention period is NOT documented. The "55 days" figure in
-- CLAUDE.md came from the prompt-logging policy — AI Studio's configurable
-- 7/14/28/55-day window — which is a different subsystem from Interactions API
-- state. Do not reintroduce a hard deadline without a cited TTL.)

/**
 * How long a gate may wait before the queue reports it as overdue.
 *
 * A working day. Long enough that a gate raised on Friday afternoon is not
 * screaming by Monday morning, short enough that "nobody has looked at this"
 * surfaces while the run still matters.
 *
 * A platform default rather than a per-workspace column: no blueprint sets it,
 * and a knob nobody has a basis to tune is a knob that ships wrong. Promote it
 * to `client_subscriptions` alongside `sla_uptime_target` when a real contract
 * names a review time.
 */
create or replace function private.hitl_review_sla_hours()
returns int
language sql
immutable
set search_path = ''
as $fn$ select 24 $fn$;

revoke all on function private.hitl_review_sla_hours() from public;
-- Granted to authenticated because the readers are INVOKER functions and the
-- dashboard itself. Migration ...20 exists because a helper was granted only to
-- service_role and the whole ROI tab died with "permission denied".
grant execute on function private.hitl_review_sla_hours() to authenticated, service_role;

/**
 * Gates still open past the review SLA, for the workspace the caller can see.
 *
 * SECURITY INVOKER, so it counts only what the caller may already read — and
 * `hitl_select` already restricts gates by role, which means an operator's
 * overdue count reflects the queue THEY are responsible for rather than the
 * workspace's total. That is the more useful number and the safer one.
 */
create or replace function public.overdue_gate_count(p_workspace_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $fn$
    select count(*)
      from public.hitl_approval_gates g
     where g.workspace_id = p_workspace_id
       and g.status in ('pending', 'escalated')
       and g.created_at < now() - make_interval(
               hours => private.hitl_review_sla_hours());
$fn$;

revoke all on function public.overdue_gate_count(uuid) from public;
grant execute on function public.overdue_gate_count(uuid) to authenticated, service_role;

create index if not exists idx_hitl_gates_open_age
    on public.hitl_approval_gates(workspace_id, created_at)
    where status in ('pending', 'escalated');

/**
 * Closes a gate nobody answered, and stops the run behind it.
 *
 * Deliberately NOT an approval path. Expiring commits nothing: the node fails,
 * the graph fails, and no output the agent proposed is acted on. Failing closed
 * is the only safe direction for a decision that was never made — the same
 * reason a rejected gate terminates rather than continues.
 *
 * SECURITY DEFINER, and the authorization is therefore written out rather than
 * inherited. Closing a gate has to fail the node and the run, and `authenticated`
 * has no UPDATE on `agent_node_executions` or `agent_graph_executions` — nor
 * should it, since granting that would let any member PATCH a run's status
 * straight through PostgREST. An INVOKER version of this function died with
 * "permission denied for table agent_node_executions" the moment it was tested
 * as `authenticated` rather than as `postgres`.
 *
 * So the check is explicit and is the SAME predicate `hitl_resolve` uses:
 * `has_role_power(workspace_id, required_role)`. Whoever could have answered
 * the gate is who may declare that nobody did — an expiry is not a lesser act
 * than a rejection. `has_role_power` filters on `auth.uid()` internally, so
 * DEFINER cannot widen it.
 *
 * Returns an outcome word rather than raising, matching `requeue_agent_job`:
 * two operators clearing the same stale queue have not done anything wrong.
 */
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
begin
    select g.id, g.workspace_id, g.required_role, g.graph_execution_id,
           g.node_execution_id, g.status, g.created_at
      into v_gate
      from public.hitl_approval_gates g
     where g.id = p_gate_id;

    if v_gate.id is null then
        return 'not_found';
    end if;

    -- The authorization, stated rather than inherited. DEFINER sees every row,
    -- so without this a business_user could expire an ai_administrator's gate
    -- and terminate the run behind it.
    if not private.has_role_power(v_gate.workspace_id, v_gate.required_role) then
        return 'forbidden';
    end if;

    if v_gate.status not in ('pending', 'escalated') then
        return 'not_open';
    end if;

    -- Only once it is actually overdue. Without this, "expire" is a second
    -- reject button with a friendlier name, and the audit trail would stop
    -- distinguishing "we decided against this" from "nobody ever looked".
    if v_gate.created_at >= now() - make_interval(
            hours => private.hitl_review_sla_hours()) then
        return 'not_overdue';
    end if;

    update public.hitl_approval_gates
       set status = 'timed_out',
           human_feedback = coalesce(
               p_reason,
               'Expired: no decision within the review window.'),
           resolved_by = (select auth.uid()),
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

    return 'expired';
end;
$fn$;

revoke all on function public.expire_hitl_gate(uuid, text) from public;
grant execute on function public.expire_hitl_gate(uuid, text) to authenticated, service_role;
