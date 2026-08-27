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
  /**
   * When the server read all of this.
   *
   * Every elapsed time on this surface — lease expiry, heartbeat staleness — is
   * measured from here rather than from a clock read while rendering. The
   * dashboard is a server component that changes only on navigation, so a live
   * clock would drift away from the frozen rows beside it and show a worker
   * ageing into "presumed gone" against data captured minutes earlier.
   */
  observedAt: number;
};

/**
 * Whether a lease has run out.
 *
 * A `running` job past its lease is not being worked — the worker holding it
 * died, and it is claimable again. Showing it as "running" would be a lie, and
 * showing it as an error would be one too: the queue recovers this by itself on
 * the next claim.
 */
export function isLeaseExpired(job: QueueJob, now = Date.now()): boolean {
  if (!job.lockedUntil) return false;
  return new Date(job.lockedUntil).getTime() < now;
}

export type WorkerPresence = {
  workerId: string;
  startedAt: string;
  lastHeartbeatAt: string;
  heartbeatIntervalMs: number;
  stoppedAt: string | null;
  pollIntervalMs: number | null;
  leaseSeconds: number | null;
  jobsClaimed: number;
  jobsSucceeded: number;
  jobsFailed: number;
  lastError: string | null;
};

/**
 * How many missed beats before a worker is presumed gone.
 *
 * Three rather than one: a single late beat is ordinary — a slow query, a GC
 * pause, a moment of clock skew — and calling that a dead worker would make the
 * fleet view cry wolf often enough to be ignored, which is worse than not
 * having it.
 */
export const MISSED_BEATS_BEFORE_STALE = 3;

/**
 * Whether a worker has stopped reporting.
 *
 * Judged against the interval THAT worker declared, not a constant here: a
 * worker configured to beat every 30s is not late at 12s, and a global
 * threshold would quietly mislabel any worker tuned differently.
 *
 * Derived on every read rather than stored, because a process that dies cannot
 * write down that it died.
 */
export function isWorkerStale(worker: WorkerPresence, now = Date.now()): boolean {
  if (worker.stoppedAt) return true;
  const interval = worker.heartbeatIntervalMs || 10000;
  const age = now - new Date(worker.lastHeartbeatAt).getTime();
  return age > interval * MISSED_BEATS_BEFORE_STALE;
}

export function liveWorkers(
  workers: WorkerPresence[],
  now = Date.now(),
): WorkerPresence[] {
  return workers.filter((w) => !isWorkerStale(w, now));
}
