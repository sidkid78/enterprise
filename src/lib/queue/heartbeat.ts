import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Worker presence.
 *
 * The heartbeat runs on its own timer, deliberately NOT inside the poll loop.
 * `drainQueue` runs a job to completion synchronously, and a graph can take
 * many minutes — a worker that only beat between polls would appear dead for
 * the entire time it was doing the most work, which inverts the signal exactly
 * when it matters. Process liveness and loop progress are different facts.
 */

export type WorkerStats = {
  claimed: number;
  succeeded: number;
  failed: number;
  lastError: string | null;
};

export type HeartbeatHandle = {
  /** Sends one beat immediately, then keeps beating until stopped. */
  stop: () => Promise<void>;
};

export async function startHeartbeat(params: {
  workerId: string;
  hostname: string;
  pid: number;
  intervalMs: number;
  pollIntervalMs: number;
  leaseSeconds: number;
  /** Read at each beat, so counters reflect the moment they are sent. */
  readStats: () => WorkerStats;
  onError?: (message: string) => void;
}): Promise<HeartbeatHandle> {
  const beat = async () => {
    const stats = params.readStats();

    const { error } = await createServiceClient().rpc("worker_heartbeat", {
      p_worker_id: params.workerId,
      p_hostname: params.hostname,
      p_pid: params.pid,
      p_heartbeat_interval_ms: params.intervalMs,
      p_poll_interval_ms: params.pollIntervalMs,
      p_lease_seconds: params.leaseSeconds,
      p_jobs_claimed: stats.claimed,
      p_jobs_succeeded: stats.succeeded,
      p_jobs_failed: stats.failed,
      p_last_error: stats.lastError,
    });

    // A failed beat is not a reason to stop working. The worst case is that the
    // fleet view shows this worker as stale while it carries on draining the
    // queue — misleading, but strictly better than a worker that exits because
    // it could not announce itself.
    if (error) params.onError?.(error.message);
  };

  // Beat once before returning, so a worker is visible from the moment it
  // starts rather than one interval later.
  await beat();

  const timer = setInterval(() => {
    void beat();
  }, params.intervalMs);

  // Do not hold the event loop open on the heartbeat alone.
  timer.unref?.();

  return {
    stop: async () => {
      clearInterval(timer);
      // A final beat first, so the counters the worker exits with are the ones
      // recorded, then the stop marker.
      await beat();
      await createServiceClient().rpc("worker_shutdown", {
        p_worker_id: params.workerId,
      });
    },
  };
}
