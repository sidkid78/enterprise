"use client";

import { useActionState } from "react";

import { requeueJob, type RequeueState } from "@/app/dashboard/queue-actions";
import {
  isLeaseExpired,
  type QueueHealth,
  type QueueJob,
} from "@/lib/queue/job-view";

const initialState: RequeueState = { error: null, message: null };

function shortId(id: string) {
  return id.slice(0, 8);
}

function when(iso: string) {
  return new Date(iso).toLocaleString();
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

function ActiveRow({ job }: { job: QueueJob }) {
  const expired = isLeaseExpired(job);

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
  canRetry,
}: {
  workspaceId: string;
  health: QueueHealth;
  canRetry: boolean;
}) {
  const { deadLetters, inFlight, waiting } = health;
  const active = [...inFlight, ...waiting];

  if (deadLetters.length === 0 && active.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 space-y-4">
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
              <ActiveRow key={job.id} job={job} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
