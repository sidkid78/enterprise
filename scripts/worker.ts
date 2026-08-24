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
import { config } from "dotenv";

config({ path: ".env.local" });

const POLL_INTERVAL_MS = Number(process.env.WORKER_POLL_MS ?? 3000);
const LEASE_SECONDS = Number(process.env.WORKER_LEASE_SECONDS ?? 900);

const workerId = `${process.env.WORKER_ID ?? "worker"}-${process.pid}`;

let stopping = false;

function log(message: string, extra?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), worker: workerId, message, ...extra };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function main() {
  // Imported here rather than at module scope so dotenv has already populated
  // the environment the Supabase and GenAI clients read at construction.
  const { drainQueue } = await import("../src/lib/queue/worker");

  log("started", { pollMs: POLL_INTERVAL_MS, leaseSeconds: LEASE_SECONDS });

  while (!stopping) {
    try {
      const result = await drainQueue({
        workerId,
        maxJobs: 1,
        leaseSeconds: LEASE_SECONDS,
      });

      for (const outcome of result.outcomes) {
        log("job finished", outcome);
      }

      // Only sleep when there was nothing to do. A busy queue keeps draining.
      if (result.claimed === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (err) {
      log("poll failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

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
