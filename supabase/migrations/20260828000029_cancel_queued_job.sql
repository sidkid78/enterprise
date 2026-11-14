-- Gives queued work an operator-controlled ending.
--
-- The queue has exactly one operator verb: `requeue_agent_job`, which refuses
-- anything that is not already dead-lettered. So the states an operator can act
-- on are `failed` and nothing else, and a job sitting `queued` with no worker to
-- claim it has no exit at all -- `claim_agent_job` is its only way out of that
-- status, and if the fleet is empty that call never comes.
--
-- Found live: four jobs queued since Aug 24-25 behind a worker whose last
-- heartbeat was 76 hours old. The dashboard rendered them under "In the queue
-- right now", correctly, with no control attached to any of them, and
-- `workspace_availability` had the workspace at 57.96% and falling, because
-- queued-past-threshold counts as downtime in progress. Everything was
-- reporting accurately. There was simply nothing anyone could press.
--
-- Cancelling is an operator action and never an automatic one, for the same
-- reason retry and gate expiry are. A queued job with no worker is
-- indistinguishable from a queued job whose worker is thirty seconds from
-- starting; a sweep that decided the difference by clock would discard live work
-- and call it housekeeping.
--
-- IT IS ALSO TERMINAL. There is no un-cancel: `requeue_agent_job` still takes
-- only `failed`. Restarting the work means launching it again, deliberately,
-- which is the honest shape -- the operator asserted this work would never be
-- done, and reversing that quietly would make the assertion meaningless.

-- New values are added here and used only inside function bodies below, which
-- are not executed at creation, so nothing in this migration reads a value it
-- has just added.
alter type public.job_status_enum   add value if not exists 'cancelled';
alter type public.graph_status_enum add value if not exists 'cancelled';
alter type public.hitl_status_enum  add value if not exists 'cancelled';

-- Who ended it, and why. The ledger row below carries the authoritative record,
-- but the queue panel renders the job row, and "cancelled" with no author is the
-- same non-answer that `agent_id: "HumanReviewer"` was on the ledger.
--
-- `last_error` is deliberately NOT overwritten with the reason: it is why the
-- job stopped making progress, the reason is why a person gave up on it, and
-- collapsing the two destroys the diagnosis. Same rule as requeue keeping it.
alter table public.agent_job_queue
    add column if not exists cancelled_by uuid references auth.users(id),
    add column if not exists cancel_reason text;

comment on column public.agent_job_queue.cancel_reason is
    'Why a person ended this job. Distinct from last_error, which is why it stopped progressing.';

/**
 * Ends a queued or dead-lettered job, and settles what depends on it.
 *
 * SECURITY DEFINER with the authorization written out, the same shape as
 * `expire_hitl_gate` and for the same reason: this must UPDATE
 * `agent_graph_executions`, `agent_node_executions` and `hitl_approval_gates`,
 * and `authenticated` holds no UPDATE on the first two -- nor should it, since
 * that would let any member PATCH a run's status straight through PostgREST.
 * An INVOKER version dies on the first update when run as `authenticated`.
 *
 * The bar is `agent_operator`, matching the roles the retry action already
 * allows. Ending a run and restarting one are the same weight of act.
 *
 * Returns an outcome word rather than raising, like every other queue function,
 * so ordinary situations reach the operator as sentences instead of as errors.
 */
create or replace function public.cancel_agent_job(
    p_job_id uuid,
    p_reason text default null
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
    v_job record;
    v_graph record;
    v_actor uuid := (select auth.uid());
    v_waited numeric;
    v_reason text := coalesce(nullif(btrim(p_reason), ''),
                              'Cancelled by an operator.');
    v_graph_ended boolean := false;
begin
    select q.id, q.workspace_id, q.graph_execution_id, q.job_type, q.status,
           q.run_after, q.locked_until, q.locked_by, q.attempts
      into v_job
      from public.agent_job_queue q
     where q.id = p_job_id
       for update;

    if v_job.id is null then
        return 'not_found';
    end if;

    if not private.has_role_power(v_job.workspace_id, 'agent_operator') then
        return 'forbidden';
    end if;

    -- A job a live worker holds is off limits. That worker is mid-run and will
    -- write its own completion over anything set here, so cancelling it would
    -- report an ending that does not happen. An expired lease is different: the
    -- worker is gone, and nothing is coming back to finish it.
    if v_job.status = 'running'
       and v_job.locked_until is not null
       and v_job.locked_until > now() then
        return 'running_active';
    end if;

    if v_job.status in ('succeeded', 'cancelled') then
        return 'not_cancellable';
    end if;

    -- ------------------------------------------------------------------
    -- Close the outage this job caused, BEFORE it stops being queued.
    -- ------------------------------------------------------------------
    -- `workspace_availability` derives downtime-in-progress from jobs currently
    -- queued past the stall threshold. The moment this row leaves 'queued' that
    -- contribution disappears -- so without this block, cancelling a job that
    -- had stalled for three days would delete three days of measured downtime
    -- and lift the uptime figure by destroying the evidence for it. That is
    -- precisely the self-scoring this platform refuses everywhere else.
    --
    -- `claim_agent_job` writes the same closed interval when a worker finally
    -- arrives. This is the other way the wait can end. The two cannot
    -- double-count: each fires exactly once, as the job stops being queued.
    if v_job.status = 'queued' then
        v_waited := extract(epoch from now() - v_job.run_after);

        if v_waited > private.queue_stall_threshold_seconds() then
            perform public.record_sla_breach(
                v_job.workspace_id,
                'queue_stall',
                case when v_waited > 3600 then 'critical'
                     when v_waited > 900 then 'error'
                     else 'warning' end,
                jsonb_build_object(
                    'job_id', v_job.id,
                    'graph_execution_id', v_job.graph_execution_id,
                    'job_type', v_job.job_type,
                    'waited_seconds', round(v_waited),
                    'ended_by', 'cancellation',
                    'operator_id', v_actor
                ),
                v_job.run_after,
                now()
            );
        end if;
    end if;

    update public.agent_job_queue
       set status = 'cancelled',
           cancelled_by = v_actor,
           cancel_reason = v_reason,
           locked_by = null,
           locked_until = null
     where id = p_job_id;

    -- ------------------------------------------------------------------
    -- Settle the run, but only if it has no honest ending of its own.
    -- ------------------------------------------------------------------
    -- A graph already `failed`, `completed` or halted reached that state for a
    -- real reason, and overwriting it with 'cancelled' would replace a true
    -- account of what happened with a later administrative act. In that case the
    -- job is simply an orphan pointing at a finished run, and removing the
    -- orphan is the whole of the change.
    select g.id, g.status
      into v_graph
      from public.agent_graph_executions g
     where g.id = v_job.graph_execution_id
       for update;

    if v_graph.id is not null
       and v_graph.status in ('pending', 'running', 'waiting_hitl') then

        update public.agent_graph_executions
           set status = 'cancelled', completed_at = now()
         where id = v_graph.id;

        -- Completed nodes are preserved, as with a budget halt: that work was
        -- done and paid for. Only what will now never run is closed out.
        update public.agent_node_executions
           set node_status = 'cancelled'
         where graph_execution_id = v_graph.id
           and node_status in ('pending', 'running');

        -- An open gate on a cancelled run can never be resumed from, and left
        -- pending it would sit in the review queue forever, ageing into the
        -- overdue count and asking someone to decide about a run that no longer
        -- exists. `cancelled` is its own outcome: 'timed_out' would claim nobody
        -- looked, and 'rejected' would claim a reviewer judged the work.
        update public.hitl_approval_gates
           set status = 'cancelled',
               resolved_by = v_actor,
               resolved_at = now(),
               human_feedback = coalesce(human_feedback,
                   'Run cancelled before this gate was decided.')
         where graph_execution_id = v_graph.id
           and status in ('pending', 'escalated');

        v_graph_ended := true;
    end if;

    -- previous_hash/current_hash are recomputed by the ledger trigger; whatever
    -- is passed here is discarded.
    insert into public.agent_audit_ledger
        (workspace_id, graph_execution_id, node_execution_id, agent_id,
         action_type, payload, previous_hash, current_hash)
    values
        (v_job.workspace_id, v_job.graph_execution_id, null,
         'HumanReviewer', 'job_cancelled',
         jsonb_build_object(
             'job_id', p_job_id,
             'job_type', v_job.job_type,
             'operator_id', v_actor,
             'reason', v_reason,
             'job_status_before', v_job.status,
             'attempts', v_job.attempts,
             'graph_status_before', v_graph.status,
             'run_terminated', v_graph_ended,
             'queued_seconds', round(coalesce(v_waited, 0))
         ),
         '', '');

    return 'cancelled';
end;
$fn$;

revoke all on function public.cancel_agent_job(uuid, text) from public;
grant execute on function public.cancel_agent_job(uuid, text) to authenticated, service_role;
