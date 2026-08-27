"use client";

import { useActionState } from "react";

import { requeueJob, type RequeueState } from "@/app/dashboard/queue-actions";
import {
  isLeaseExpired,
  isWorkerStale,
  type QueueHealth,
  type QueueJob,
  type WorkerPresence,
} from "@/lib/queue/job-view";

const initialState: RequeueState = { error: null, message: null };

function shortId(id: string) {
  return id.slice(0, 8);
}

function when(iso: string) {
  return new Date(iso).toLocaleString();
}

function ago(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * The fleet.
 *
 * Rendered even when every worker is live, because "3 workers, all reporting"
 * is the answer to a question an operator would otherwise have to guess at, and
 * a panel that appears only during an incident teaches nobody what normal looks
 * like.
 *
 * Liveness is computed here from the heartbeat age rather than read from a
 * column, so nothing can claim a worker is alive on the strength of a status
 * some other process wrote.
 */
function Fleet({
  workers,
  queuedCount,
  now,
}: {
  workers: WorkerPresence[];
  queuedCount: number;
  now: number;
}) {
  const live = workers.filter((w) => !isWorkerStale(w, now));
  const gone = workers.filter((w) => isWorkerStale(w, now));

  // The one fact that turns a queue into a stalled system. Queued work with
  // nothing to drain it does not resolve itself and produces no error anywhere
  // — every run simply waits, indefinitely, looking exactly like a run that is
  // merely slow.
  const nothingDraining = live.length === 0 && queuedCount > 0;

  if (workers.length === 0 && queuedCount === 0) return null;

  return (
    <div
      className={`rounded-xl border bg-slate-900 p-5 ${
        nothingDraining ? "border-rose-500/40" : "border-slate-800"
      }`}
    >
      {nothingDraining ? (
        <>
          <h3 className="text-sm font-bold text-rose-400">
            No worker is running. {queuedCount} job
            {queuedCount === 1 ? " is" : "s are"} waiting and nothing will pick
            {queuedCount === 1 ? " it" : " them"} up.
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Runs will sit queued until a worker starts —{" "}
            <code className="text-slate-400">npm run worker</code>. Nothing is
            lost meanwhile: jobs are claimed from the database, so work resumes
            from where it stopped.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-sm font-bold text-slate-100">
            {live.length} worker{live.length === 1 ? "" : "s"} reporting
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Liveness is derived from each worker&rsquo;s own heartbeat interval,
            not read from a status column — a process that dies cannot record
            that it died.
          </p>
        </>
      )}

      <ul className="mt-4 space-y-2">
        {[...live, ...gone].map((worker) => {
          const stale = isWorkerStale(worker, now);
          const stopped = Boolean(worker.stoppedAt);

          return (
            <li
              key={worker.workerId}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 py-2 last:border-0"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    stale
                      ? stopped
                        ? "bg-slate-600"
                        : "bg-rose-500"
                      : "animate-pulse bg-emerald-400"
                  }`}
                />
                <span className="font-mono text-xs text-slate-300">
                  {worker.workerId}
                </span>
                <span className="text-[11px] text-slate-500">
                  {stopped
                    ? `stopped ${ago(worker.stoppedAt!, now)}`
                    : stale
                      ? `last beat ${ago(worker.lastHeartbeatAt, now)} — presumed gone`
                      : `up since ${when(worker.startedAt)}`}
                </span>
              </div>

              <div className="text-[11px] text-slate-500">
                <span className="text-slate-400">{worker.jobsSucceeded}</span>{" "}
                done
                {worker.jobsFailed > 0 && (
                  <>
                    {" · "}
                    <span className="text-rose-400">{worker.jobsFailed}</span>{" "}
                    failed
                  </>
                )}
                {worker.jobsClaimed > 0 && (
                  <>{` · ${worker.jobsClaimed} claimed`}</>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {gone.some((w) => !w.stoppedAt) && (
        <p className="mt-3 text-[11px] text-slate-500">
          A worker that stopped reporting holds nothing: its leases expire and
          the jobs it had are claimed by another worker.
        </p>
      )}
    </div>
  );
}

function RetryButton({
  workspaceId,
  jobId,
}: {
  workspaceId: string;
  jobId: string;
}) {
  const [state, formAction, pending] = useActionState(requeueJob, initialState);

  return (
    <form action={formAction} className="shrink-0 text-right">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="jobId" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-400 transition-colors hover:bg-cyan-500/20 disabled:opacity-60"
      >
        {pending ? "Requeueing…" : "Retry run"}
      </button>
      {(state.error || state.message) && (
        <p
          role={state.error ? "alert" : "status"}
          className={`mt-2 max-w-[16rem] text-[11px] ${
            state.error ? "text-rose-400" : "text-emerald-400"
          }`}
        >
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}

function DeadLetter({
  job,
  workspaceId,
  canRetry,
}: {
  job: QueueJob;
  workspaceId: string;
  canRetry: boolean;
}) {
  return (
    <li className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-400">
              {job.jobType}
            </span>
            <span className="font-mono text-xs text-slate-400">
              run {shortId(job.graphExecutionId)}
            </span>
            <span className="text-[11px] text-slate-500">
              gave up after {job.attempts} of {job.maxAttempts} attempts ·{" "}
              {when(job.updatedAt)}
            </span>
          </div>

          {job.rootPrompt && (
            <p className="mt-2 line-clamp-2 text-sm text-slate-300">
              {job.rootPrompt}
            </p>
          )}

          {/*
            The last error is the whole reason this panel exists. It is kept
            across a retry rather than cleared, so it is still here to read
            while someone is working out what went wrong.
          */}
          {job.lastError && (
            <p className="mt-2 rounded border border-slate-800 bg-slate-950 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-rose-300">
              {job.lastError}
            </p>
          )}
        </div>

        {canRetry && <RetryButton workspaceId={workspaceId} jobId={job.id} />}
      </div>
    </li>
  );
}

function ActiveRow({ job, now }: { job: QueueJob; now: number }) {
  const expired = isLeaseExpired(job, now);

  return (
    <li className="flex items-center justify-between gap-4 border-b border-slate-800 py-2 last:border-0">
      <div className="min-w-0">
        <span className="font-mono text-xs text-slate-300">
          {shortId(job.graphExecutionId)}
        </span>
        <span className="ml-2 text-[11px] uppercase tracking-wider text-slate-500">
          {job.jobType}
        </span>
        {job.rootPrompt && (
          <span className="ml-2 truncate text-xs text-slate-500">
            {job.rootPrompt.slice(0, 70)}
          </span>
        )}
      </div>
      <div className="shrink-0 text-right text-[11px]">
        {job.status === "running" ? (
          expired ? (
            /*
              A running job past its lease is not being worked: the worker
              holding it died. That is not an error — the next claim reclaims
              it — but calling it "running" would be false.
            */
            <span className="text-amber-400">lease expired · reclaimable</span>
          ) : (
            <span className="text-cyan-400">
              {job.lockedBy ? `on ${job.lockedBy}` : "running"}
            </span>
          )
        ) : job.attempts > 0 ? (
          <span className="text-amber-400">
            retry {job.attempts}/{job.maxAttempts} after {when(job.runAfter)}
          </span>
        ) : (
          <span className="text-slate-500">waiting for a worker</span>
        )}
      </div>
    </li>
  );
}

/**
 * Queue state an operator has to act on.
 *
 * Dead letters lead, because they are the only part of the queue that will
 * never resolve itself. Everything else here is informational: a queued job is
 * waiting, a leased job is being worked, and an expired lease is reclaimed on
 * the next poll without anyone doing anything.
 */
export default function QueueHealthPanel({
  workspaceId,
  health,
  workers,
  canRetry,
  renderedAt,
}: {
  workspaceId: string;
  health: QueueHealth;
  workers: WorkerPresence[];
  canRetry: boolean;
  /** `health.observedAt` — when the server read the rows below. */
  renderedAt: number;
}) {
  const now = renderedAt;
  const { deadLetters, inFlight, waiting } = health;
  const active = [...inFlight, ...waiting];

  if (deadLetters.length === 0 && active.length === 0 && workers.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 space-y-4">
      <Fleet workers={workers} queuedCount={waiting.length} now={now} />
      {deadLetters.length > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-slate-900 p-5">
          <h3 className="text-sm font-bold text-rose-400">
            {deadLetters.length} run{deadLetters.length === 1 ? "" : "s"} the
            queue gave up on
          </h3>
          <p className="mt-1 mb-4 text-xs text-slate-500">
            These were retried until their attempts ran out and then stopped.
            Nothing will restart them on its own — the queue already tried, and
            a fourth automatic attempt would be a loop rather than a recovery.
          </p>
          <ul className="space-y-3">
            {deadLetters.map((job) => (
              <DeadLetter
                key={job.id}
                job={job}
                workspaceId={workspaceId}
                canRetry={canRetry}
              />
            ))}
          </ul>
          {!canRetry && (
            <p className="mt-3 text-[11px] text-slate-500">
              Your role can see stalled runs but not restart them.
            </p>
          )}
        </div>
      )}

      {active.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <h3 className="mb-1 text-sm font-bold text-slate-100">
            In the queue right now
          </h3>
          <p className="mb-3 text-xs text-slate-500">
            {inFlight.length} being worked, {waiting.length} waiting.
          </p>
          <ul>
            {active.map((job) => (
              <ActiveRow key={job.id} job={job} now={now} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
