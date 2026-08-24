-- Enforces the invariant the crash-recovery logic depends on: at most one
-- ACTIVE job per graph execution.
--
-- executePending resets nodes found `running` back to `pending` on entry, on
-- the grounds that such a node is an orphan left by a crashed worker rather
-- than one being actively worked. That reasoning holds only if a single worker
-- can be driving a given graph at a time — and until now nothing enforced it.
-- The lease is per JOB, not per GRAPH: two rows for the same
-- graph_execution_id could both be claimed, by two different workers.
--
-- Confirmed before writing this: inserting a `launch` and a `resume` for one
-- graph was accepted, and both were claimed and executed. With two workers that
-- is concurrent execution of the same graph, and the reset stops being a repair
-- and becomes a cause of double execution — including re-invoking tools that
-- had already run.
--
-- A partial unique index makes it impossible rather than merely unlikely.
-- Terminal jobs (succeeded, failed) are excluded, so a graph can be re-queued
-- once its previous job is done — which is exactly the resume flow.

create unique index idx_job_queue_one_active_per_graph
    on public.agent_job_queue(graph_execution_id)
    where status in ('queued', 'running');
