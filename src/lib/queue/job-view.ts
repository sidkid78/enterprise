/**
 * The queue's shape as the UI sees it, plus the pure helpers over it.
 *
 * Deliberately NOT marked `server-only`, and importing nothing that is: the
 * dead-letter panel is a Client Component, and pulling a value out of a module
 * that reaches the server Supabase client drags `next/headers` into the browser
 * bundle. Types alone would have been erased; `isLeaseExpired` is a value, so
 * it has to live somewhere both sides can reach. Same split as `lib/rag/chunk`.
 */

export type QueueJob = {
  id: string;
  graphExecutionId: string;
  jobType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lockedBy: string | null;
  lockedUntil: string | null;
  runAfter: string;
  updatedAt: string;
  /** The run this job drives, so an operator sees what actually stalled. */
  rootPrompt: string | null;
  graphStatus: string | null;
};

export type QueueHealth = {
  /** Jobs the queue has given up on. These need a person. */
  deadLetters: QueueJob[];
  /** Claimed and being worked right now, with the lease that proves it. */
  inFlight: QueueJob[];
  /** Waiting for a worker, including backoff retries. */
  waiting: QueueJob[];
};

/**
 * Whether a lease has run out.
 *
 * A `running` job past its lease is not being worked — the worker holding it
 * died, and it is claimable again. Showing it as "running" would be a lie, and
 * showing it as an error would be one too: the queue recovers this by itself on
 * the next claim.
 */
export function isLeaseExpired(job: QueueJob): boolean {
  if (!job.lockedUntil) return false;
  return new Date(job.lockedUntil).getTime() < Date.now();
}
