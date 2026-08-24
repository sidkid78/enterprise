-- Gives a permanently failed job somewhere to be seen, and a way back.
--
-- fail_agent_job flips a job to 'failed' once attempts are exhausted, and until
-- now nothing read that column. A run whose worker gave up simply stopped: no
-- view, no count, no alert, no way to retry it short of SQL. For a governance
-- product that is the same class of defect as the node the engine used to skip
-- silently — work that did not happen, presented as nothing at all.
--
-- Retry is deliberately an operator action rather than an automatic one. The
-- queue already retried it max_attempts times; if the cause were transient it
-- would be finished. A fourth automatic attempt is a loop, not a recovery.

/**
 * Returns a dead-lettered job to the queue.
 *
 * Returns an outcome word rather than raising, so the caller can tell the
 * operator which of several ordinary situations it hit.
 *
 * attempts resets to 0: the operator is asserting that whatever caused the
 * failure has been dealt with, so the job deserves its full retry budget
 * again. last_error is deliberately KEPT — it is the only record of why this
 * job died, and clearing it on retry would destroy the diagnosis at the exact
 * moment someone is investigating.
 */
create or replace function public.requeue_agent_job(p_job_id uuid)
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
    v_status public.job_status_enum;
    v_graph uuid;
begin
    select status, graph_execution_id
      into v_status, v_graph
      from public.agent_job_queue
     where id = p_job_id
       for update;

    if not found then
        return 'not_found';
    end if;

    -- Only a dead letter is retryable here. A queued or running job is already
    -- on its way, and a succeeded one has nothing to redo.
    if v_status <> 'failed' then
        return 'not_failed';
    end if;

    -- One active job per graph (migration ...16) is what makes the engine's
    -- "a node found running is orphaned" reasoning true. Report the collision
    -- plainly instead of letting the unique index raise: an operator retrying
    -- a run that someone else already restarted has not done anything wrong.
    if exists (
        select 1
          from public.agent_job_queue
         where graph_execution_id = v_graph
           and status in ('queued', 'running')
    ) then
        return 'already_active';
    end if;

    update public.agent_job_queue
       set status = 'queued',
           attempts = 0,
           run_after = now(),
           locked_until = null,
           locked_by = null
     where id = p_job_id;

    return 'queued';
end;
$$;

revoke all on function public.requeue_agent_job(uuid) from public;
grant execute on function public.requeue_agent_job(uuid) to service_role;

-- The dead-letter read path: failed jobs, newest first.
create index idx_job_queue_dead_letter
    on public.agent_job_queue(workspace_id, updated_at desc)
    where status = 'failed';
