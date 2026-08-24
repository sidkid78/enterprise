-- Makes the SLA figure measured rather than assumed.
--
-- sla_breach_events has existed since migration ...05 with no writer, so the
-- count was always zero and the dashboard rendered 100.00% uptime
-- unconditionally. A governance product asserting perfect availability because
-- it never looked is the same fabrication the critic gate refuses everywhere
-- else, and the same reason the runtime is not allowed to score its own ROI.
--
-- AVAILABILITY IS NOT THE ERROR RATE. That distinction decides everything here:
--
--   * A run that FAILS is the platform working and returning a bad answer. It
--     is an incident, it is recorded and counted, and it does NOT reduce
--     uptime. Folding failures into availability would let one bad prompt look
--     like an outage.
--   * A job that sits queued with nothing consuming it IS downtime: the
--     platform was asked to do work and could not begin. It has a real start
--     (when the job became eligible) and a real end (when a worker claimed it),
--     so it is measured, not estimated.
--   * A budget or token halt is NEITHER. That is the customer cap doing exactly
--     what it was configured to do. Counting it against our availability would
--     penalise the platform for enforcing their own policy.
--
-- Durations are summed from real intervals and OVERLAPPING ONES ARE MERGED.
-- Two jobs each waiting ten minutes in the same ten minutes is ten minutes of
-- downtime, not twenty; summing rows naively inflates an outage by however many
-- jobs happened to be queued during it.

/**
 * Breach types that consume availability.
 *
 * Kept in one function so writer and reader cannot drift: a type added to the
 * recorder without being classified here counts as an incident and not as
 * downtime, which is the safer of the two defaults.
 */
create or replace function private.downtime_breach_types()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
    select array['queue_stall']::text[];
$fn$;

/**
 * Records a breach.
 *
 * The interval is explicit because a caller usually learns about one only once
 * it has ENDED: a queue stall becomes measurable at the moment a worker finally
 * claims the job, not while it is waiting. Passing null for p_resolved_at
 * records an incident that is still open.
 */
create or replace function public.record_sla_breach(
    p_workspace_id uuid,
    p_breach_type text,
    p_severity text,
    p_details jsonb default '{}'::jsonb,
    p_started_at timestamptz default now(),
    p_resolved_at timestamptz default now()
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $fn$
    insert into public.sla_breach_events
        (workspace_id, breach_type, severity, details, created_at, resolved_at)
    values
        (p_workspace_id, p_breach_type, p_severity, p_details, p_started_at, p_resolved_at)
    returning id;
$fn$;

/**
 * How long a job may sit eligible before the wait counts against availability.
 *
 * Well above the poll interval, so ordinary scheduling latency and a brief
 * worker restart are not outages. Short enough that a fleet which is genuinely
 * down gets recorded inside the window an operator would care about.
 */
create or replace function private.queue_stall_threshold_seconds()
returns int
language sql
immutable
set search_path = ''
as $fn$ select 300 $fn$;

/**
 * Availability over a window, computed from recorded intervals.
 *
 * SECURITY INVOKER, so a caller measures only the workspaces they may already
 * read. As DEFINER this would turn "how is my platform doing?" into a
 * cross-tenant availability report.
 */
create or replace function public.workspace_availability(
    p_workspace_id uuid,
    p_window_hours int default 168
)
returns table (
    window_hours int,
    downtime_seconds numeric,
    uptime_pct numeric,
    incident_count bigint,
    open_incident_count bigint,
    worst_severity text
)
language sql
stable
security invoker
set search_path = ''
as $fn$
    with bounds as (
        select now() - make_interval(hours => p_window_hours) as window_start,
               now() as window_end
    ),
    -- Clip every interval to the window, so an outage that began before it
    -- contributes only the part falling inside.
    clipped as (
        select greatest(e.created_at, b.window_start) as starts,
               least(coalesce(e.resolved_at, b.window_end), b.window_end) as ends
          from public.sla_breach_events e, bounds b
         where e.workspace_id = p_workspace_id
           and e.breach_type = any(private.downtime_breach_types())
           and coalesce(e.resolved_at, b.window_end) > b.window_start
           and e.created_at < b.window_end
    ),
    -- Stalls that are STILL HAPPENING, measured from the queue itself.
    --
    -- Recording at claim time alone leaves the worst case unrecorded: if no
    -- worker ever comes back, nothing is ever claimed, so nothing is ever
    -- written, and a totally dead platform reports 100% availability on the
    -- strength of having no evidence. A job sitting eligible past the threshold
    -- right now is downtime in progress, and it is observable without waiting
    -- for the recovery that may never arrive.
    --
    -- These cannot double-count the recorded rows: a job contributes here only
    -- while it is still queued, and the closed interval is written at the
    -- moment it stops being queued.
    live_stalls as (
        select greatest(j.run_after, b.window_start) as starts,
               b.window_end as ends
          from public.agent_job_queue j, bounds b
         where j.status = 'queued'
           and j.run_after <= now() - make_interval(
                   secs => private.queue_stall_threshold_seconds())
           and j.workspace_id = p_workspace_id
    ),
    valid as (
        select starts, ends from clipped where ends > starts
        union all
        select starts, ends from live_stalls where ends > starts
    ),
    -- Merge overlaps: an island begins wherever an interval starts after every
    -- previous one has already ended.
    marked as (
        select starts, ends,
               max(ends) over (
                   order by starts
                   rows between unbounded preceding and 1 preceding
               ) as prior_end
          from valid
    ),
    islands as (
        select starts, ends,
               sum(case when prior_end is null or starts > prior_end then 1 else 0 end)
                   over (order by starts rows unbounded preceding) as island
          from marked
    ),
    merged as (
        select min(starts) as starts, max(ends) as ends
          from islands group by island
    ),
    downtime as (
        select coalesce(sum(extract(epoch from ends - starts)), 0)::numeric as seconds
          from merged
    ),
    incidents as (
        select count(*) as total,
               count(*) filter (where e.resolved_at is null) as still_open,
               max(case e.severity when 'critical' then 3 when 'error' then 2
                                   when 'warning' then 1 else 0 end) as sev
          from public.sla_breach_events e, bounds b
         where e.workspace_id = p_workspace_id
           and e.created_at >= b.window_start
    )
    select p_window_hours,
           d.seconds,
           -- Clamped: a window can only lose the time it contains, and a
           -- negative or above-100 availability figure is worse than none.
           greatest(0, least(100,
               100 - (d.seconds / (p_window_hours * 3600.0)) * 100))::numeric,
           i.total,
           i.still_open,
           case i.sev when 3 then 'critical' when 2 then 'error'
                      when 1 then 'warning' else null end
      from downtime d, incidents i;
$fn$;

revoke all on function private.downtime_breach_types() from public;
revoke all on function public.record_sla_breach(uuid, text, text, jsonb, timestamptz, timestamptz) from public;
revoke all on function public.workspace_availability(uuid, int) from public;

grant execute on function private.downtime_breach_types() to authenticated, service_role;
grant execute on function public.record_sla_breach(uuid, text, text, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.workspace_availability(uuid, int) to authenticated, service_role;

-- ============================================================================
-- THE WRITER: the queue measures its own wait
-- ============================================================================
-- Recorded at CLAIM time, which is when the duration becomes known. A reader
-- cannot do this: it would only see stalls while somebody happened to be
-- looking, and an outage nobody watched would go unrecorded entirely.

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
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
    v_row record;
    v_waited numeric;
begin
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
    returning q.id, q.workspace_id, q.graph_execution_id, q.job_type,
              q.attempts, q.run_after
    into v_row;

    if v_row.id is null then
        return;
    end if;

    -- The wait is measured from when the job became ELIGIBLE, not from when it
    -- was created: a retry deliberately backs off, and serving it promptly at
    -- its backoff deadline is not a stall.
    v_waited := extract(epoch from now() - v_row.run_after);

    if v_waited > private.queue_stall_threshold_seconds() then
        -- A closed interval. It started when the job became runnable and ended
        -- just now, when it finally got a worker. Nothing is estimated.
        perform public.record_sla_breach(
            v_row.workspace_id,
            'queue_stall',
            case when v_waited > 3600 then 'critical'
                 when v_waited > 900 then 'error'
                 else 'warning' end,
            jsonb_build_object(
                'job_id', v_row.id,
                'graph_execution_id', v_row.graph_execution_id,
                'job_type', v_row.job_type,
                'waited_seconds', round(v_waited),
                'claimed_by', p_worker_id
            ),
            v_row.run_after,
            now()
        );
    end if;

    job_id := v_row.id;
    workspace_id := v_row.workspace_id;
    graph_execution_id := v_row.graph_execution_id;
    job_type := v_row.job_type;
    attempts := v_row.attempts;
    return next;
end;
$fn$;

revoke all on function public.claim_agent_job(text, int) from public;
revoke all on function private.queue_stall_threshold_seconds() from public;
grant execute on function public.claim_agent_job(text, int) to service_role;
grant execute on function private.queue_stall_threshold_seconds() to service_role;

create index if not exists idx_sla_breach_window
    on public.sla_breach_events(workspace_id, breach_type, created_at desc);
