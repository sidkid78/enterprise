-- Moves agent execution off the request thread.
--
-- The orchestrator has always run inline in the HTTP request that started it,
-- which is fine for a 3-6 node plan and impossible for anything larger: a
-- serverless request budget expires long before a real graph finishes. The
-- engine does not need to change — every node is already persisted as it
-- completes — so this is a change of caller.
--
-- pgmq (available here, 1.5.1) was the obvious alternative and is deliberately
-- not used. Its messages are opaque payloads in a separate store, which would
-- put queue state beside agent_graph_executions as a second source of truth,
-- and the dashboard would need a second lookup to answer "is this run queued or
-- actually running?". A job row that references the execution keeps one story,
-- stays visible to RLS, and is about forty lines of FOR UPDATE SKIP LOCKED —
-- which is what pgmq does internally anyway.

create type public.job_status_enum as enum (
    'queued',
    'running',
    'succeeded',
    'failed'
);

create type public.job_type_enum as enum (
    -- Plan the graph, then run it.
    'launch',
    -- Continue a graph whose gate has been resolved.
    'resume'
);

create table public.agent_job_queue (
    id uuid primary key default gen_random_uuid(),
    workspace_id uuid not null references public.workspaces(id) on delete cascade,
    graph_execution_id uuid not null references public.agent_graph_executions(id) on delete cascade,
    job_type public.job_type_enum not null,
    status public.job_status_enum not null default 'queued',

    attempts int not null default 0,
    max_attempts int not null default 3,

    -- Backoff, and the scheduling hook for a delayed retry.
    run_after timestamptz not null default now(),

    -- Lease. A worker that dies holds nothing: once locked_until passes, the
    -- job is claimable again. This is what makes delivery at-least-once rather
    -- than at-most-once, and why every step of the engine has to be safe to
    -- re-enter — which it is, because executePending only picks up nodes still
    -- marked pending.
    locked_until timestamptz,
    locked_by text,

    last_error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- The claim query's access path: ready jobs, oldest first.
create index idx_job_queue_claimable
    on public.agent_job_queue(run_after)
    where status = 'queued';

create index idx_job_queue_graph on public.agent_job_queue(graph_execution_id);
create index idx_job_queue_workspace on public.agent_job_queue(workspace_id, created_at desc);

create trigger trg_job_queue_updated_at
    before update on public.agent_job_queue
    for each row execute function private.set_updated_at();

-- ============================================================================
-- RLS
-- ============================================================================
-- Readable by members so the dashboard can show that a run is waiting for a
-- worker rather than silently doing nothing. Writes belong to the runtime
-- alone: a client able to insert jobs could make the workers do arbitrary work
-- on another tenant's executions.

alter table public.agent_job_queue enable row level security;

create policy job_queue_select on public.agent_job_queue
    for select to authenticated using (private.is_workspace_member(workspace_id));

grant select on public.agent_job_queue to authenticated;

-- ============================================================================
-- CLAIM / COMPLETE / FAIL
-- ============================================================================

/**
 * Claims one ready job for a worker.
 *
 * FOR UPDATE SKIP LOCKED is the whole trick: concurrent workers each take a
 * different row instead of blocking on the same one. Without SKIP LOCKED, N
 * workers serialize into one.
 */
create or replace function public.claim_agent_job(
    p_worker_id text,
    p_lease_seconds int default 900
)
returns table (
    job_id uuid,
    workspace_id uuid,
    graph_execution_id uuid,
    job_type public.job_type_enum,
    attempts int
)
language sql
volatile
security invoker
set search_path = ''
as $$
    update public.agent_job_queue q
       set status = 'running',
           attempts = q.attempts + 1,
           locked_by = p_worker_id,
           locked_until = now() + make_interval(secs => p_lease_seconds)
     where q.id = (
            select c.id
              from public.agent_job_queue c
             where c.run_after <= now()
               and (
                     c.status = 'queued'
                     -- Reclaim a job whose worker died holding the lease.
                     or (c.status = 'running' and c.locked_until < now())
                   )
             order by c.run_after
             for update skip locked
             limit 1
           )
    returning q.id, q.workspace_id, q.graph_execution_id, q.job_type, q.attempts;
$$;

create or replace function public.complete_agent_job(p_job_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
    update public.agent_job_queue
       set status = 'succeeded',
           locked_until = null,
           locked_by = null
     where id = p_job_id;
$$;

/**
 * Records a failed attempt.
 *
 * Re-queues with backoff while attempts remain, and gives up permanently once
 * they are exhausted — a job that keeps failing must stop rather than occupy a
 * worker forever.
 */
create or replace function public.fail_agent_job(
    p_job_id uuid,
    p_error text,
    p_retry_in_seconds int default 30
)
returns public.job_status_enum
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
    v_status public.job_status_enum;
begin
    update public.agent_job_queue
       set status = case
                      when attempts >= max_attempts then 'failed'::public.job_status_enum
                      else 'queued'::public.job_status_enum
                    end,
           run_after = case
                         when attempts >= max_attempts then run_after
                         else now() + make_interval(secs => p_retry_in_seconds)
                       end,
           last_error = left(p_error, 2000),
           locked_until = null,
           locked_by = null
     where id = p_job_id
    returning status into v_status;

    return v_status;
end;
$$;

revoke all on function public.claim_agent_job(text, int) from public;
revoke all on function public.complete_agent_job(uuid) from public;
revoke all on function public.fail_agent_job(uuid, text, int) from public;

grant execute on function public.claim_agent_job(text, int) to service_role;
grant execute on function public.complete_agent_job(uuid) to service_role;
grant execute on function public.fail_agent_job(uuid, text, int) to service_role;
