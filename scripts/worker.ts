/**
 * The background worker.
 *
 * Run alongside the app: `npm run worker`.
 *
 * Deliberately a plain long-lived process rather than a cron-driven serverless
 * function. The whole reason for the queue is that a graph outlives a request
 * budget, so a worker that is itself a request has moved the problem rather
 * than solved it. `drainQueue` is still bounded, so a serverless caller can use
 * the same code where a persistent process is not an option.
 *
 * Polls rather than listens: LISTEN/NOTIFY would cut the idle latency, but it
 * needs a direct Postgres connection that survives PgBouncer, which the app
 * does not otherwise require. Polling every few seconds costs one cheap indexed
 * query and keeps the deployment story to "run this process".
 */
import os from "node:os";

import { config } from "dotenv";

config({ path: ".env.local" });

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS ?? 900);

/**
 * How often this worker announces it is alive.
 *
 * Independent of the poll interval on purpose: polling stops for as long as a
 * job runs, and a graph can take minutes. Tying the two together would make a
 * busy worker look dead.
 */
const HEARTBEAT_MS = Number(process.env.WORKER_HEARTBEAT_MS ?? 10000);

const workerId = `${process.env.WORKER_ID ?? "worker"}-${process.pid}`;

let stopping = false;

/** Cumulative for this process. The row in agent_workers is per process too. */
const stats = { claimed: 0, succeeded: 0, failed: 0, lastError: null as string | null };

function log(message: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), worker: workerId, message, ...extra };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function main() {
  // Imported here rather than at module scope so dotenv has already populated
  // the environment the Supabase and GenAI clients read at construction.
  const { drainQueue } = await import("../src/lib/queue/worker");
  const { startHeartbeat } = await import("../src/lib/queue/heartbeat");

  const heartbeat = await startHeartbeat({
    workerId,
    hostname: os.hostname(),
    pid: process.pid,
    intervalMs: HEARTBEAT_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    leaseSeconds: LEASE_SECONDS,
    readStats: () => ({ ...stats }),
    onError: (error) => log("heartbeat failed", { error }),
  });

  log("started", {
    pollMs: POLL_INTERVAL_MS,
    leaseSeconds: LEASE_SECONDS,
    heartbeatMs: HEARTBEAT_MS,
  });

  while (!stopping) {
    try {
      const result = await drainQueue({
        workerId,
        maxJobs: 1,
        leaseSeconds: LEASE_SECONDS,
      });

      stats.claimed += result.claimed;
      stats.succeeded += result.succeeded;
      stats.failed += result.failed;

      for (const outcome of result.outcomes) {
        log("job finished", outcome);
        if (outcome.status.startsWith("failed") || outcome.status.startsWith("threw")) {
          stats.lastError = outcome.status;
        }
      }

      // Only sleep when there was nothing to do. A busy queue keeps draining.
      if (result.claimed === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      stats.lastError = error;
      log("poll failed", { error });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  // Records the stop deliberately, so a planned shutdown reads as a planned
  // shutdown rather than decaying into a stale heartbeat that looks like a
  // crash.
  await heartbeat.stop();
  log("stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Finishes the job in flight rather than abandoning it mid-node. The lease
    // would eventually free it anyway, but a clean exit avoids the wait.
    log("shutting down after the current job");
    stopping = true;
  });
}

main().catch((err) => {
  log("fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
