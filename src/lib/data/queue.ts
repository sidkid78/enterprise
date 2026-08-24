import "server-only";

import {
  type QueueHealth,
  type QueueJob,
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

export type { QueueHealth, QueueJob } from "@/lib/queue/job-view";
