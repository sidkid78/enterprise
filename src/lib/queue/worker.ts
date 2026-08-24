import "server-only";

import { resumeGraph, runGraph } from "@/lib/genai/orchestrator";
import { createServiceClient } from "@/lib/supabase/service";

import { claimJob, completeJob, failJob } from "./jobs";

export type DrainResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  /** Terminal status per job, for logging. */
  outcomes: { jobId: string; graphExecutionId: string; status: string }[];
};

/**
 * Runs one job to whatever conclusion it reaches.
 *
 * A run reaching `waiting_hitl` is a SUCCESS for the job, not a failure: the
 * graph did exactly what it should and is now waiting on a person. Treating it
 * as a failure would retry it, and the retry would find the same gate and stall
 * again until attempts ran out.
 *
 * `rejected` is the same shape of mistake and was making it. A human refusing a
 * gate is a correct terminal outcome, but it came back as `failed`, so the
 * queue retried it three times, re-read the same rejection each time, and
 * dead-lettered the run — presenting a reviewer's deliberate "no" to the
 * operator as something the platform broke. Verified before fixing: one drain
 * of a rejected graph left the job re-queued with "Run terminated by human
 * rejection." as its retry reason.
 */
async function runJob(
  db: ReturnType<typeof createServiceClient>,
  job: {
    jobId: string;
    workspaceId: string;
    graphExecutionId: string;
    jobType: string;
  },
): Promise<string> {
  const result =
    job.jobType === "launch"
      ? await runGraph(job.graphExecutionId)
      : await resumeGraph(job.graphExecutionId);

  if (result.status === "failed") {
    // The engine already recorded the failure on the execution row. Marking the
    // job failed too lets the queue retry a transient cause — a rate limit, a
    // dropped connection — without the caller doing anything.
    const status = await failJob(db, job.jobId, result.message);
    if (status === "failed") {
      await recordDeadLetter(db, job, result.message);
    }
    return `${result.status} (job ${status})`;
  }

  await completeJob(db, job.jobId);
  return result.status;
}

/**
 * Records the incident, once, at the point the customer actually experiences
 * one.
 *
 * NOT on every failed attempt. A transient failure the queue retried
 * successfully is the system working as designed, and counting it would make
 * the incident log a measure of how flaky the provider was rather than of what
 * anyone was let down by. Only when the queue gives up has the run stopped
 * being delivered.
 *
 * Recorded as a point event, so it appears in the incident count and leaves
 * uptime alone: a run that fails is the platform working and returning a bad
 * answer, not the platform being unavailable. Downtime here is `queue_stall`
 * only — see migration ...19.
 */
async function recordDeadLetter(
  db: ReturnType<typeof createServiceClient>,
  job: { jobId: string; workspaceId: string; graphExecutionId: string },
  reason: string,
): Promise<void> {
  const { error } = await db.rpc("record_sla_breach", {
    p_workspace_id: job.workspaceId,
    p_breach_type: "job_dead_lettered",
    p_severity: "critical",
    p_details: {
      job_id: job.jobId,
      graph_execution_id: job.graphExecutionId,
      reason: reason.slice(0, 500),
    },
  });

  // Failing to record an incident must not turn into a second incident. The
  // job is already dead-lettered and visible in the queue panel either way.
  if (error) {
    console.error(`Could not record dead-letter incident: ${error.message}`);
  }
}

/**
 * Claims and runs jobs until the queue is empty or the budget of jobs is spent.
 *
 * Bounded rather than looping forever so the same function works in both
 * callers: a long-lived worker process calls it repeatedly, and a scheduled
 * serverless invocation calls it once with a small budget and returns before
 * its own deadline.
 */
export async function drainQueue(params: {
  workerId: string;
  maxJobs?: number;
  leaseSeconds?: number;
}): Promise<DrainResult> {
  const db = createServiceClient();
  const maxJobs = params.maxJobs ?? 1;

  const result: DrainResult = {
    claimed: 0,
    succeeded: 0,
    failed: 0,
    outcomes: [],
  };

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await claimJob(db, params.workerId, params.leaseSeconds);
    if (!job) break;

    result.claimed += 1;

    try {
      const status = await runJob(db, job);
      if (status.startsWith("failed")) result.failed += 1;
      else result.succeeded += 1;

      result.outcomes.push({
        jobId: job.jobId,
        graphExecutionId: job.graphExecutionId,
        status,
      });
    } catch (err) {
      // A throw here is the engine itself breaking, not a run failing. Release
      // the job so it can be retried rather than leaving it locked until the
      // lease expires.
      const message = err instanceof Error ? err.message : "Unknown worker error";
      const status = await failJob(db, job.jobId, message);
      result.failed += 1;
      result.outcomes.push({
        jobId: job.jobId,
        graphExecutionId: job.graphExecutionId,
        status: `threw (job ${status}): ${message}`,
      });
    }
  }

  return result;
}
