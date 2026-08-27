"use client";

import { useActionState, useState } from "react";

import {
  expireGate,
  resolveGate,
  type ExpireState,
  type ResolveDecision,
  type ResolveState,
} from "@/app/dashboard/actions";
import type { PendingGate } from "@/lib/data/hitl";
import {
  canResolveGates,
  escalationTargets,
  type UserRole,
} from "@/lib/roles";

import JsonView from "./JsonView";

const initialState: ResolveState = { error: null, ok: false };
const expireInitialState: ExpireState = { error: null, message: null };

/**
 * The expire control, shown only on a gate that is actually overdue.
 *
 * Its own form and its own action state, deliberately kept out of the resolve
 * form: expiring is not a decision about the work, and letting it share the
 * feedback box and the approve/reject row would invite it being pressed as a
 * fourth verdict. The database refuses a gate that is not overdue anyway.
 */
function ExpireGate({ gateId, ageHours }: { gateId: string; ageHours: number }) {
  const [state, formAction, pending] = useActionState(
    expireGate,
    expireInitialState,
  );

  return (
    <form action={formAction} className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <p className="text-xs text-amber-300">
        Waiting {Math.floor(ageHours)} hours with no decision.
      </p>
      <p className="mt-1 text-[11px] text-slate-400">
        Expiring stops the run and commits nothing. It is recorded as your
        decision that nobody is coming — not as an approval or a rejection.
      </p>

      <input type="hidden" name="gateId" value={gateId} />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor={`expire-reason-${gateId}`} className="sr-only">
          Reason
        </label>
        <input
          id={`expire-reason-${gateId}`}
          name="reason"
          placeholder="Why is nobody answering? (optional)"
          className="min-w-[220px] flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {pending ? "Expiring…" : "Expire gate"}
        </button>
      </div>

      {(state.error || state.message) && (
        <p
          role={state.error ? "alert" : "status"}
          className={`mt-2 text-[11px] ${state.error ? "text-rose-400" : "text-emerald-400"}`}
        >
          {state.error ?? state.message}
        </p>
      )}
    </form>
  );
}

export default function HitlQueueDashboard({
  gates,
  viewerRole,
}: {
  gates: PendingGate[];
  viewerRole: UserRole;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    gates[0]?.id ?? null,
  );
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideText, setOverrideText] = useState("");
  const [state, formAction, pending] = useActionState(
    resolveGate,
    initialState,
  );

  // Derived, not synced. After a resolve the server revalidates and the gate
  // disappears from `gates`; falling back to the head of the list keeps a
  // selection without an effect that would cascade renders.
  const selectedGate =
    gates.find((g) => g.id === selectedId) ?? gates[0] ?? null;

  const canResolve = selectedGate
    ? canResolveGates(viewerRole, selectedGate.requiredRole)
    : false;

  // Tiers strictly above both the viewer and the current bar. Escalating to a
  // level that is not higher would be a no-op the database rejects anyway, so
  // it is never offered.
  const escalateOptions = selectedGate
    ? escalationTargets(viewerRole, selectedGate.requiredRole)
    : [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Queue */}
      <div className="flex h-[800px] flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-xl lg:col-span-5">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="flex items-center space-x-2 text-base font-bold text-white">
              <span>Pending Escalations</span>
              <span className="rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                {gates.length} In Queue
              </span>
            </h2>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {gates.length === 0 ? (
            <div className="py-16 text-center text-slate-500">
              <svg className="mx-auto mb-3 h-12 w-12 text-emerald-400 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <p className="text-sm font-medium text-slate-300">
                No pending HITL gates
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Worker agents are running within confidence thresholds.
              </p>
            </div>
          ) : (
            gates.map((gate) => {
              const isSelected = selectedId === gate.id;
              const confidence = gate.confidenceScore;
              return (
                <button
                  key={gate.id}
                  type="button"
                  onClick={() => setSelectedId(gate.id)}
                  aria-pressed={isSelected}
                  className={`relative w-full cursor-pointer rounded-xl border p-4 text-left transition-all duration-300 ${
                    isSelected
                      ? "z-10 scale-[1.02] border-cyan-500 bg-slate-800 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                      : "border-slate-800 bg-slate-950/50 hover:border-slate-700 hover:bg-slate-900"
                  }`}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                  )}
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-200">
                      {gate.agentRole}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {new Date(gate.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>

                  <p className="mb-3 line-clamp-2 text-[11px] leading-relaxed text-slate-400">
                    {gate.reasoningSummary.primaryCause}
                  </p>

                  <div className="flex items-center justify-between text-[10px]">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-slate-500">Confidence:</span>
                      {/* confidence_score is nullable — a gate can be raised by
                          a policy trigger that carries no score. */}
                      {confidence === null ? (
                        <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-slate-500">
                          n/a
                        </span>
                      ) : (
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono font-bold ${
                            confidence < 0.6
                              ? "border border-rose-500/20 bg-rose-500/10 text-rose-400"
                              : "border border-amber-500/20 bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {(confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>

                    <span className="font-mono text-slate-500">
                      Role:{" "}
                      <span className="text-slate-300">{gate.requiredRole}</span>
                      {gate.escalated && (
                        <span className="ml-2 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-300">
                          ESCALATED
                        </span>
                      )}
                      {gate.overdue && (
                        /*
                          The age, not just a flag. "Overdue" alone tells a
                          reviewer to hurry; the number tells them whether this
                          slipped by an hour or was abandoned last week.
                        */
                        <span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                          {Math.floor(gate.ageHours)}H UNANSWERED
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Inspector */}
      <div className="relative flex h-[800px] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl lg:col-span-7">
        {selectedGate && (
          <div className="pointer-events-none absolute -right-40 -top-40 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl"></div>
        )}

        {selectedGate ? (
          <div className="relative z-10 flex h-full flex-col">
            <div className="mb-5 flex-shrink-0 border-b border-slate-800 pb-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center space-x-1 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
                  <span>
                    Trigger: {selectedGate.triggerReason.replaceAll("_", " ")}
                  </span>
                </span>
                <span className="rounded border border-slate-800 bg-slate-950 px-2 py-1 font-mono text-[10px] text-slate-500">
                  Gate ID: {selectedGate.id.slice(0, 12)}
                </span>
              </div>
              <h3 className="mb-1 text-xl font-bold text-white">
                {selectedGate.agentRole} Execution Gate
              </h3>
              <p className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>Execution Graph:</span>
                <span className="rounded bg-cyan-400/10 px-1.5 py-0.5 font-mono text-cyan-400">
                  {selectedGate.graphExecutionId.slice(0, 12)}
                </span>
              </p>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto pr-2">
              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/80 shadow-inner backdrop-blur-md">
                <div className="flex items-center space-x-2 border-b border-slate-800 bg-slate-800/40 px-4 py-2.5">
                  <svg className="h-4 w-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
                    Transparent AI Reasoning Report
                  </h4>
                </div>

                <div className="p-4">
                  <div className="mb-4">
                    <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">
                      Primary Cause
                    </p>
                    <p className="text-sm font-medium leading-relaxed text-slate-200">
                      {selectedGate.reasoningSummary.primaryCause}
                    </p>
                  </div>

                  {selectedGate.reasoningSummary.triggerDescription && (
                    <div className="mb-4">
                      <p className="mb-1 text-[10px] font-bold uppercase text-slate-500">
                        Technical Trigger Description
                      </p>
                      <p className="font-mono text-[11px] leading-relaxed text-slate-400">
                        {selectedGate.reasoningSummary.triggerDescription}
                      </p>
                    </div>
                  )}

                  {selectedGate.reasoningSummary.riskFactors.length > 0 && (
                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase text-slate-500">
                        Identified Risk Factors
                      </p>
                      <ul className="space-y-1.5">
                        {selectedGate.reasoningSummary.riskFactors.map((rf) => (
                          <li
                            key={rf}
                            className="flex items-start space-x-2 text-[11px] text-amber-300/90"
                          >
                            <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            <span>{rf}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <span className="mb-2 flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Input Context</span>
                  </span>
                  <div className="overflow-x-auto rounded-lg border border-slate-800 bg-[#0d1117] p-3">
                    <pre className="font-mono text-[10px] leading-relaxed">
                      <JsonView value={selectedGate.inputPayload} />
                    </pre>
                  </div>
                </div>
                <div>
                  <span className="mb-2 flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-widest text-cyan-500">
                    <span>Proposed Output (Pending)</span>
                  </span>
                  <div className="overflow-x-auto rounded-lg border border-cyan-900/50 bg-[#0d1117] p-3 shadow-[inset_0_0_10px_rgba(6,182,212,0.05)]">
                    <pre className="font-mono text-[10px] leading-relaxed">
                      <JsonView value={selectedGate.outputPayload} />
                    </pre>
                  </div>
                </div>
              </div>
            </div>

            {state.error && (
              <p
                role="alert"
                className="mt-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
              >
                {state.error}
              </p>
            )}

            {!canResolve && (
              <p className="mt-4 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-400">
                This gate requires the{" "}
                <span className="font-mono text-slate-300">
                  {selectedGate.requiredRole}
                </span>{" "}
                role. Your role is{" "}
                <span className="font-mono text-slate-300">{viewerRole}</span>.
              </p>
            )}

            {selectedGate.overdue && canResolve && (
              <ExpireGate
                gateId={selectedGate.id}
                ageHours={selectedGate.ageHours}
              />
            )}

            <form
              id="hitl-resolve-form"
              action={formAction}
              // Closing in the submit handler rather than an effect keeps the
              // modal dismissal an event, not a render-triggered state sync.
              onSubmit={() => setOverrideOpen(false)}
              className="mt-2 flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-slate-800 bg-slate-900 pt-5"
            >
              <input type="hidden" name="gateId" value={selectedGate.id} />
              <input
                type="hidden"
                name="overridePayload"
                value={overrideOpen ? overrideText : ""}
              />

              {/* Escalation carries a destination. Without one the action is
                  ambiguous — "send this up" says nothing about who is now
                  accountable — and the gate's required_role only ratchets
                  upward, so the tier has to be chosen before it is raised. */}
              {escalateOptions.length > 0 && (
                <div className="flex items-center gap-2">
                  <label htmlFor="escalateTo" className="sr-only">
                    Escalate to
                  </label>
                  <select
                    id="escalateTo"
                    name="escalateTo"
                    defaultValue={escalateOptions[0]}
                    disabled={pending || !canResolve}
                    className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 font-mono text-xs text-slate-300 disabled:opacity-50"
                  >
                    {escalateOptions.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>

                  <ActionButton
                    decision="escalate"
                    disabled={pending || !canResolve}
                    className="border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Escalate
                  </ActionButton>
                </div>
              )}

              <ActionButton
                decision="reject"
                disabled={pending || !canResolve}
                className="border border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
              >
                Reject
              </ActionButton>

              <button
                type="button"
                disabled={pending || !canResolve}
                onClick={() => {
                  setOverrideText(
                    JSON.stringify(selectedGate.outputPayload, null, 2),
                  );
                  setOverrideOpen(true);
                }}
                className="rounded-lg border border-indigo-500/40 bg-indigo-500/20 px-4 py-2.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Modify &amp; Override
              </button>

              <ActionButton
                decision="approve"
                disabled={pending || !canResolve}
                className="ml-2 bg-emerald-500 font-bold text-slate-950 shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:bg-emerald-400"
              >
                {pending ? "Resolving…" : "Approve & Resume DAG"}
              </ActionButton>
            </form>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-500">
            <svg className="mb-4 h-16 w-16 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            <p className="text-sm font-medium text-slate-400">
              No gate selected
            </p>
            <p className="mt-1 text-[11px]">
              Select a pending gate to inspect its reasoning log.
            </p>
          </div>
        )}
      </div>

      {overrideOpen && selectedGate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="mb-1 text-lg font-bold text-white">
              Override Task Payload
            </h3>
            <p className="mb-5 text-xs text-slate-400">
              Adjust the output JSON before resuming the worker DAG. It is
              validated as JSON on submit and rejected if malformed.
            </p>

            <div className="overflow-hidden rounded-lg border border-slate-800 bg-[#0d1117] shadow-inner">
              <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/50 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                <span>outputPayload.json</span>
                <span className="text-indigo-400">Editable</span>
              </div>
              <textarea
                value={overrideText}
                onChange={(e) => setOverrideText(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed text-cyan-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              />
            </div>

            <div className="mt-6 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={() => setOverrideOpen(false)}
                className="rounded-lg bg-slate-800 px-5 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700"
              >
                Cancel
              </button>
              {/*
                Submits the same form as the action buttons, carrying
                overridePayload alongside an approve decision.
              */}
              <button
                type="submit"
                form="hitl-resolve-form"
                name="decision"
                value="approve"
                disabled={pending}
                className="rounded-lg bg-indigo-500 px-5 py-2.5 text-xs font-bold text-white shadow-[0_0_15px_rgba(99,102,241,0.3)] transition hover:bg-indigo-400 disabled:opacity-50"
              >
                Apply Override &amp; Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({
  decision,
  disabled,
  className,
  children,
}: {
  decision: ResolveDecision;
  disabled: boolean;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      name="decision"
      value={decision}
      disabled={disabled}
      className={`rounded-lg px-4 py-2.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}
