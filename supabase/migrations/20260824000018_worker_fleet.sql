-- Makes the fleet a fact rather than an inference.
--
-- Until now the only evidence a worker existed was agent_job_queue.locked_by on
-- a job it happened to be holding. That answers "who is working this row?" and
-- nothing else: an idle worker is invisible, a dead worker is invisible, and an
-- empty fleet is indistinguishable from an empty queue. Which means the single
-- most consequential operational fact in the system — nothing is draining the
-- queue, so every run is stalled and none of them will move — could not be
-- observed at all.
--
-- Liveness is DERIVED from the heartbeat, never stored as a status. A process
-- that dies cannot write "I died", so any column claiming a worker is alive is
-- only ever as true as the last moment someone remembered to update it. Same
-- reasoning as verify_ledger_chain recomputing the hash chain instead of
-- reading a status column.

create table public.agent_workers (
    -- The id the worker also writes into agent_job_queue.locked_by, so the two
    -- can be joined.
    worker_id text primary key,

    -- Infrastructure detail. NOT granted to authenticated below: this table is
    -- global, so every tenant reads every row, and a hostname is nobody's
    -- business but the operator's.
    hostname text,
    pid int,

    started_at timestamptz not null default now(),
    last_heartbeat_at timestamptz not null default now(),

    -- What "late" means for THIS worker. A worker configured to beat every 30s
    -- must not be judged against a reader's assumption of 5s, and hard-coding a
    -- global threshold would silently mislabel any worker tuned differently.
    heartbeat_interval_ms int not null default 10000,

    -- Set on a clean exit, so a worker that was shut down deliberately leaves
    -- the fleet view at once instead of decaying through the stale window and
    -- looking like a crash.
    stopped_at timestamptz,

    poll_interval_ms int,
    lease_seconds int,

    -- Cumulative for THIS process, not all time: the row is per process, and a
    -- restart legitimately starts the count again.
    jobs_claimed bigint not null default 0,
    jobs_succeeded bigint not null default 0,
    jobs_failed bigint not null default 0,

    last_error text
);

-- Deliberately no current_job_id. agent_job_queue.locked_by already says which
-- worker holds which job; a second copy here would be a second source of truth
-- that can disagree with the first, which is the same objection that ruled out
-- putting queue state in pgmq.

create index idx_agent_workers_live
    on public.agent_workers(last_heartbeat_at desc)
    where stopped_at is null;

-- ============================================================================
-- RLS
-- ============================================================================
-- Workers are not workspace-scoped: one process drains every tenant's queue.
-- So this table has no workspace_id and every signed-in user sees every row —
-- which is only acceptable because a row carries NO tenant data. No workspace
-- ids, no job ids, no prompts, and counters that are fleet-wide totals rather
-- than per-customer volumes. Nothing added here may break that.

alter table public.agent_workers enable row level security;

create policy workers_select on public.agent_workers
    for select to authenticated using (true);

revoke all on public.agent_workers from authenticated;

grant select (worker_id, started_at, last_heartbeat_at, heartbeat_interval_ms,
              stopped_at, poll_interval_ms, lease_seconds,
              jobs_claimed, jobs_succeeded, jobs_failed, last_error)
    on public.agent_workers to authenticated;

grant all on public.agent_workers to service_role;

-- ============================================================================
-- HEARTBEAT
-- ============================================================================

/**
 * Registers a worker and records that it is still alive.
 *
 * One call does both: a worker's first beat inserts the row, every later beat
 * updates it. Separate register/heartbeat calls would leave a window where a
 * worker that crashed between them has a row claiming a heartbeat it never
 * sent.
 *
 * Counters are absolute totals from the process rather than increments, so a
 * beat that is retried or arrives out of order cannot inflate them.
 */
create or replace function public.worker_heartbeat(
    p_worker_id text,
    p_hostname text default null,
    p_pid int default null,
    p_heartbeat_interval_ms int default 10000,
    p_poll_interval_ms int default null,
    p_lease_seconds int default null,
    p_jobs_claimed bigint default 0,
    p_jobs_succeeded bigint default 0,
    p_jobs_failed bigint default 0,
    p_last_error text default null
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
    insert into public.agent_workers as w (
        worker_id, hostname, pid, heartbeat_interval_ms, poll_interval_ms,
        lease_seconds, jobs_claimed, jobs_succeeded, jobs_failed, last_error
    )
    values (
        p_worker_id, p_hostname, p_pid, p_heartbeat_interval_ms,
        p_poll_interval_ms, p_lease_seconds, p_jobs_claimed, p_jobs_succeeded,
        p_jobs_failed, left(p_last_error, 2000)
    )
    on conflict (worker_id) do update
       set last_heartbeat_at = now(),
           hostname = excluded.hostname,
           pid = excluded.pid,
           heartbeat_interval_ms = excluded.heartbeat_interval_ms,
           poll_interval_ms = excluded.poll_interval_ms,
           lease_seconds = excluded.lease_seconds,
           jobs_claimed = excluded.jobs_claimed,
           jobs_succeeded = excluded.jobs_succeeded,
           jobs_failed = excluded.jobs_failed,
           last_error = excluded.last_error,
           -- A worker id is reused when a restart lands on the same pid. Clear
           -- the stop marker and restart the clock, or the new process inherits
           -- the dead one's shutdown and never appears live.
           stopped_at = null,
           started_at = case when w.stopped_at is not null then now()
                             else w.started_at end;

    -- Keep the table bounded without a scheduled job. A row nobody has heard
    -- from in a day is a process that is not coming back; the runs it touched
    -- are recorded in the ledger and the job queue, not here.
    delete from public.agent_workers
     where last_heartbeat_at < now() - interval '1 day';
end;
$$;

/** Marks a clean exit. */
create or replace function public.worker_shutdown(p_worker_id text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
    update public.agent_workers
       set stopped_at = now(),
           last_heartbeat_at = now()
     where worker_id = p_worker_id;
$$;

revoke all on function public.worker_heartbeat(text, text, int, int, int, int, bigint, bigint, bigint, text) from public;
revoke all on function public.worker_shutdown(text) from public;

grant execute on function public.worker_heartbeat(text, text, int, int, int, int, bigint, bigint, bigint, text) to service_role;
grant execute on function public.worker_shutdown(text) to service_role;
