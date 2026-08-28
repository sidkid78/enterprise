"use client";

import { useActionState, useState } from "react";

import { enrollInSop, setSopStepDone } from "@/app/dashboard/outcome-actions";
import type { OutcomeState } from "@/app/dashboard/outcome-actions";
import type { SopStep, TrainingModule } from "@/lib/data/workforce";

const initialState: OutcomeState = { error: null, message: null };

/**
 * Starts the viewer on a procedure.
 *
 * Separate from ticking a step so that "opened it and has done nothing" is a
 * recordable state. That is the row a supervisor most wants to see, and folding
 * enrollment into the first tick would make it indistinguishable from never
 * having opened the procedure at all.
 */
function StartButton({
  workspaceId,
  sopId,
}: {
  workspaceId: string;
  sopId: string;
}) {
  const [state, formAction, pending] = useActionState(
    enrollInSop,
    initialState,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="sopId" value={sopId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-semibold text-indigo-400 transition-colors hover:bg-indigo-500/20 disabled:opacity-60"
      >
        {pending ? "Starting…" : "Start this procedure"}
      </button>
      {state.error && (
        <p role="alert" className="mt-2 text-[11px] text-rose-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** One step, with the viewer's own tick. */
function StepRow({
  workspaceId,
  sopId,
  step,
  done,
  enrolled,
}: {
  workspaceId: string;
  sopId: string;
  step: SopStep;
  done: boolean;
  enrolled: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setSopStepDone,
    initialState,
  );

  return (
    <li className="flex gap-3 border-b border-slate-800/60 py-3 last:border-0">
      <div className="pt-0.5">
        {enrolled ? (
          <form action={formAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="sopId" value={sopId} />
            <input type="hidden" name="stepOrder" value={step.order} />
            <input type="hidden" name="done" value={done ? "false" : "true"} />
            <button
              type="submit"
              disabled={pending}
              aria-pressed={done}
              aria-label={`Mark step ${step.order} ${done ? "not done" : "done"}`}
              className={`flex h-5 w-5 items-center justify-center rounded border text-[11px] font-bold transition-colors disabled:opacity-50 ${
                done
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400"
                  : "border-slate-700 text-transparent hover:border-slate-500"
              }`}
            >
              ✓
            </button>
          </form>
        ) : (
          <span className="flex h-5 w-5 items-center justify-center rounded border border-slate-800 font-mono text-[10px] text-slate-600">
            {step.order}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-200">
            {step.heading}
          </span>
          <span className="font-mono text-[10px] text-slate-500">
            {step.agentRole}
          </span>
          {/*
            Carried through from the run that produced this procedure. It is the
            single most consequential fact on a step — a person following the
            SOP needs to know where a decision was escalated rather than made by
            the agent — and it is why progress records which steps are done
            rather than only how many.
          */}
          {step.requiredHuman && (
            <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-400">
              Needs a human
            </span>
          )}
        </div>

        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {step.objective}
        </p>

        {step.outcome && (
          <p className="mt-1.5 border-l-2 border-slate-800 pl-2 text-[11px] leading-relaxed text-slate-500">
            Last time: {step.outcome}
          </p>
        )}

        {state.error && (
          <p role="alert" className="mt-1.5 text-[11px] text-rose-400">
            {state.error}
          </p>
        )}
      </div>
    </li>
  );
}

/** The procedure itself, opened from its row. */
function SopDetail({
  workspaceId,
  mod,
}: {
  workspaceId: string;
  mod: TrainingModule;
}) {
  const enrolled = mod.myCompletedSteps !== null;
  const mine = new Set(mod.myCompletedSteps ?? []);

  return (
    <div className="border-t border-slate-800 bg-slate-950/60 px-4 py-4">
      {mod.overview && (
        <p className="mb-4 text-xs leading-relaxed text-slate-400">
          {mod.overview}
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
        <span>
          v{mod.version} · {mod.steps.length} step
          {mod.steps.length === 1 ? "" : "s"}
        </span>
        {mod.sourceRunId && (
          <span className="font-mono">
            from run {mod.sourceRunId.slice(0, 8)}
          </span>
        )}
        {mod.systemsTouched.length > 0 && (
          <span>systems: {mod.systemsTouched.join(", ")}</span>
        )}
      </div>

      {mod.steps.length === 0 ? (
        /*
          A generated SOP with no steps. Possible when the source run completed
          with nothing informative to say, and worth stating plainly — an empty
          procedure published to a team is worse than no procedure, because it
          reads as guidance that exists.
        */
        <p className="rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
          This procedure has no steps. It was generated from a run that produced
          none, and should be regenerated or removed rather than followed.
        </p>
      ) : (
        <>
          <ul>
            {mod.steps.map((step) => (
              <StepRow
                key={step.order}
                workspaceId={workspaceId}
                sopId={mod.id}
                step={step}
                done={mine.has(step.order)}
                enrolled={enrolled}
              />
            ))}
          </ul>

          <div className="mt-4">
            {enrolled ? (
              <p className="text-[11px] text-slate-500">
                You have completed {mine.size} of {mod.steps.length}. Progress is
                yours alone — ticking a step records only that you did it, not
                that it was done correctly.
              </p>
            ) : (
              <StartButton workspaceId={workspaceId} sopId={mod.id} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * SOPs generated from real runs, and who has worked through them.
 *
 * Both halves were missing until now, in opposite ways. The procedures were
 * generated, stored and published, and no screen could open one — "Review SOP"
 * was a button with no handler, so `sop_content` was reachable only through
 * SQL. And `user_upskilling_progress` had policies, grants and a Server Action
 * with no caller, so Completion and Human Supervisors rendered 0 on every row:
 * true, and only because nobody could ever record anything.
 */
export default function WorkforceUpskillingHub({
  workspaceId,
  workspaceName,
  modules,
  seesEveryone,
}: {
  workspaceId: string;
  workspaceName: string;
  modules: TrainingModule[];
  /**
   * Whether the viewer's role lets them read other people's progress rows.
   * `upskilling_select` allows owner/administrator; everyone else sees only
   * their own, which makes the roster figures a floor rather than a count.
   */
  seesEveryone: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-xl font-bold text-white">
          Workforce Enablement &amp; SOP Hub
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Standard operating procedures generated from completed runs, and who
          has worked through them, for {workspaceName}.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl lg:col-span-2">
          <h3 className="border-b border-slate-800 px-4 py-3 text-sm font-bold text-white">
            Procedures
          </h3>

          {modules.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No SOP templates yet. They are generated from completed agent runs.
            </p>
          ) : (
            <ul>
              {modules.map((mod) => {
                const open = openId === mod.id;

                return (
                  <li key={mod.id} className="border-b border-slate-800 last:border-0">
                    <div className="flex flex-wrap items-center gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-200">
                            {mod.title}
                          </span>
                          {!mod.isPublished && (
                            <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
                              Draft
                            </span>
                          )}
                          {mod.myCompletedSteps !== null && (
                            <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-400">
                              {mod.myCompletedSteps.length === mod.steps.length &&
                              mod.steps.length > 0
                                ? "You: complete"
                                : `You: ${mod.myCompletedSteps.length}/${mod.steps.length}`}
                            </span>
                          )}
                        </div>
                        <span className="font-mono text-xs text-slate-500">
                          {mod.workflowDomain}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-slate-800">
                          <div
                            className={`h-2 rounded-full ${
                              mod.completion === 100
                                ? "bg-emerald-400"
                                : "bg-cyan-500"
                            }`}
                            style={{ width: `${mod.completion}%` }}
                          />
                        </div>
                        <span className="w-9 font-mono text-xs text-slate-400">
                          {mod.completion}%
                        </span>
                      </div>

                      <div
                        className="flex items-center gap-1.5"
                        title={`${mod.agentsAssigned} agent roles produced this run`}
                      >
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10 text-xs font-bold text-cyan-400">
                          {mod.agentsAssigned}
                        </span>
                        <span
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/10 text-xs font-bold text-amber-400"
                          title={`${mod.humans} enrolled`}
                        >
                          {mod.humans}
                        </span>
                      </div>

                      <button
                        onClick={() => setOpenId(open ? null : mod.id)}
                        aria-expanded={open}
                        className="text-xs font-semibold text-indigo-400 transition-colors hover:text-indigo-300"
                      >
                        {open ? "Close" : "Review SOP"}
                      </button>
                    </div>

                    {open && <SopDetail workspaceId={workspaceId} mod={mod} />}
                  </li>
                );
              })}
            </ul>
          )}

          {!seesEveryone && modules.some((m) => m.humans > 0) && (
            /*
              An ordinary member can only read their own progress row, so the
              enrolled count and the completion average they see cover
              themselves alone. Saying so beats rendering a workspace-wide
              figure that is quietly one person's.
            */
            <p className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500">
              Completion and enrolment shown here cover your own record only.
              Owners and administrators see the whole team.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h3 className="mb-4 text-sm font-bold text-white">
            Workforce Telemetry
          </h3>

          {/*
            These three figures were hard-coded placeholders in the mock. There
            is no instrumentation behind them yet — decision latency and
            confidence accuracy need timing columns on hitl_approval_gates and
            agent_node_executions first. Showing "—" rather than inventing
            numbers, since a governance dashboard that displays fabricated
            telemetry is worse than one that admits a gap.
          */}
          <div className="space-y-4">
            {[
              "Human Decision Avg Latency",
              "Agent Decision Avg Latency",
              "Agent Confidence Accuracy",
            ].map((label) => (
              <div
                key={label}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3"
              >
                <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">
                  {label}
                </p>
                <p className="font-mono text-xl text-slate-600">
                  &mdash;
                  <span className="ml-2 text-[10px] uppercase tracking-wide">
                    not instrumented
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
