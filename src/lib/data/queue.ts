import "server-only";

import {
  type QueueHealth,
  type QueueJob,
  type WorkerPresence,
} from "@/lib/queue/job-view";
import { createClient } from "@/lib/supabase/server";

/**
 * Queue visibility.
 *
 * `agent_job_queue` is readable by every member (migration ...15) precisely so
 * the dashboard can say a run is waiting for a worker rather than silently
 * doing nothing — but nothing read it. A job that exhausted `max_attempts` went
 * to `failed` and stopped, with no view, no count and no way back short of SQL.
 */

type Row = {
  id: string;
  graph_execution_id: string;
  job_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  locked_by: string | null;
  locked_until: string | null;
  run_after: string;
  updated_at: string;
  agent_graph_executions: { root_prompt: string | null; status: string } | null;
};

const SELECT =
  "id, graph_execution_id, job_type, status, attempts, max_attempts, last_error, locked_by, locked_until, run_after, updated_at, agent_graph_executions(root_prompt, status)";

function toJob(row: Row): QueueJob {
  // A to-one embed returns an object, but the client is untyped, so a shape
  // change would be a runtime error rather than a compile one. Normalize both.
  const graph = Array.isArray(row.agent_graph_executions)
    ? row.agent_graph_executions[0]
    : row.agent_graph_executions;

  return {
    id: row.id,
    graphExecutionId: row.graph_execution_id,
    jobType: row.job_type,
    status: row.status,
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    lastError: row.last_error,
    lockedBy: row.locked_by,
    lockedUntil: row.locked_until,
    runAfter: row.run_after,
    updatedAt: row.updated_at,
    rootPrompt: graph?.root_prompt ?? null,
    graphStatus: graph?.status ?? null,
  };
}

export async function getQueueHealth(
  workspaceId: string,
  limit = 25,
): Promise<QueueHealth> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_job_queue")
    .select(SELECT)
    .eq("workspace_id", workspaceId)
    .neq("status", "succeeded")
    .order("updated_at", { ascending: false })
    .limit(limit * 3);

  if (error) {
    throw new Error(`Failed to load queue state: ${error.message}`);
  }

  const jobs = ((data ?? []) as unknown as Row[]).map(toJob);

  return {
    observedAt: Date.now(),
    deadLetters: jobs.filter((j) => j.status === "failed").slice(0, limit),
    inFlight: jobs.filter((j) => j.status === "running").slice(0, limit),
    waiting: jobs.filter((j) => j.status === "queued").slice(0, limit),
  };
}

/**
 * Dead letters only, for the tab badge.
 *
 * Separate from getQueueHealth because the badge renders on every tab and must
 * not pay for the full listing.
 */
export async function countDeadLetters(workspaceId: string): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("agent_job_queue")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "failed");

  if (error) return 0;
  return count ?? 0;
}

/**
 * Every worker that has reported recently, live or not.
 *
 * Not filtered to the live ones here: a worker that has gone quiet is the most
 * important row in the table, and dropping it server-side would make an empty
 * fleet and a dead fleet look identical — which is the exact confusion this
 * whole surface exists to remove. Liveness is decided by `isWorkerStale` at
 * render time, from the heartbeat age.
 *
 * The table has no workspace_id: one worker drains every tenant. It is
 * readable by any signed-in user precisely because a row carries no tenant
 * data, and hostname/pid are withheld by column grant (migration ...18).
 */
export async function getWorkerFleet(): Promise<WorkerPresence[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_workers")
    .select(
      "worker_id, started_at, last_heartbeat_at, heartbeat_interval_ms, stopped_at, poll_interval_ms, lease_seconds, jobs_claimed, jobs_succeeded, jobs_failed, last_error",
    )
    .order("last_heartbeat_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load the worker fleet: ${error.message}`);
  }

  type WorkerRow = {
    worker_id: string;
    started_at: string;
    last_heartbeat_at: string;
    heartbeat_interval_ms: number;
    stopped_at: string | null;
    poll_interval_ms: number | null;
    lease_seconds: number | null;
    jobs_claimed: number | string;
    jobs_succeeded: number | string;
    jobs_failed: number | string;
    last_error: string | null;
  };

  return ((data ?? []) as WorkerRow[]).map((row) => ({
    workerId: row.worker_id,
    startedAt: row.started_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    heartbeatIntervalMs: Number(row.heartbeat_interval_ms ?? 10000),
    stoppedAt: row.stopped_at,
    pollIntervalMs: row.poll_interval_ms === null ? null : Number(row.poll_interval_ms),
    leaseSeconds: row.lease_seconds === null ? null : Number(row.lease_seconds),
    // bigint arrives as a string over the wire.
    jobsClaimed: Number(row.jobs_claimed ?? 0),
    jobsSucceeded: Number(row.jobs_succeeded ?? 0),
    jobsFailed: Number(row.jobs_failed ?? 0),
    lastError: row.last_error,
  }));
}

export type { QueueHealth, QueueJob, WorkerPresence } from "@/lib/queue/job-view";
