import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

export type JobType = "launch" | "resume";

export type ClaimedJob = {
  jobId: string;
  workspaceId: string;
  graphExecutionId: string;
  jobType: JobType;
  attempts: number;
};

/**
 * Queues work for a background worker.
 *
 * The caller must already have verified workspace membership — this writes with
 * the service role, the same contract as the engine it schedules.
 */
export async function enqueueJob(
  db: Db,
  params: {
    workspaceId: string;
    graphExecutionId: string;
    jobType: JobType;
  },
): Promise<{ jobId: string | null; error: string | null }> {
  const { data, error } = await db
    .from("agent_job_queue")
    .insert({
      workspace_id: params.workspaceId,
      graph_execution_id: params.graphExecutionId,
      job_type: params.jobType,
    })
    .select("id")
    .single();

  if (!error) return { jobId: data.id as string, error: null };

  // A graph may have only one active job (migration ...16), which is what makes
  // "a node found running is orphaned" true. Hitting that is not a failure:
  // something is already scheduled to drive this graph, which is precisely what
  // the caller wanted. Two operators resolving gates on the same run, or one
  // double-clicking, should not see a constraint violation.
  if (error.code === "23505") {
    const { data: existing } = await db
      .from("agent_job_queue")
      .select("id")
      .eq("graph_execution_id", params.graphExecutionId)
      .in("status", ["queued", "running"])
      .maybeSingle();

    return { jobId: (existing?.id as string) ?? null, error: null };
  }

  return { jobId: null, error: error.message };
}

/**
 * Claims one ready job, or null when the queue is empty.
 *
 * The lease is what makes a dead worker recoverable: the row stays `running`
 * until `locked_until` passes, after which another worker may take it. Set the
 * lease longer than the longest run you expect, or a slow job will be picked up
 * twice concurrently.
 */
export async function claimJob(
  db: Db,
  workerId: string,
  leaseSeconds = 900,
): Promise<ClaimedJob | null> {
  const { data, error } = await db.rpc("claim_agent_job", {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });

  if (error) throw new Error(`Could not claim a job: ${error.message}`);

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;

  return {
    jobId: row.job_id as string,
    workspaceId: row.workspace_id as string,
    graphExecutionId: row.graph_execution_id as string,
    jobType: row.job_type as JobType,
    attempts: Number(row.attempts ?? 1),
  };
}

export async function completeJob(db: Db, jobId: string): Promise<void> {
  await db.rpc("complete_agent_job", { p_job_id: jobId });
}

/**
 * Records a failed attempt, re-queueing with backoff while attempts remain.
 *
 * Returns the resulting status so the caller can distinguish "will be retried"
 * from "given up".
 */
export async function failJob(
  db: Db,
  jobId: string,
  error: string,
  retryInSeconds = 30,
): Promise<string> {
  const { data } = await db.rpc("fail_agent_job", {
    p_job_id: jobId,
    p_error: error,
    p_retry_in_seconds: retryInSeconds,
  });

  return (data as string | null) ?? "failed";
}
