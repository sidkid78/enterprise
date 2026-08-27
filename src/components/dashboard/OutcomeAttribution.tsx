"use client";

import { useActionState } from "react";

import {
  attributeRunOutcome,
  deleteBaseline,
  deleteOutcome,
  recordBaseline,
  type OutcomeState,
} from "@/app/dashboard/outcome-actions";
import type { AttributableRun, Baseline, Outcome } from "@/lib/data/bio";

const initialState: OutcomeState = { error: null, message: null };

function Feedback({ state }: { state: OutcomeState }) {
  if (!state.error && !state.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={`mt-3 rounded-md border px-3 py-2 text-xs ${
        state.error
          ? "border-rose-500/40 bg-rose-500/10 text-rose-400"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      }`}
    >
      {state.error ?? state.message}
    </p>
  );
}

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60";

function BaselineForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(
    recordBaseline,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="rounded-xl border border-slate-800 bg-slate-900 p-5"
    >
      <h3 className="mb-1 text-sm font-bold text-slate-100">
        Record a baseline
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        What this task cost before automation. Every ROI figure on this page is
        derived from a baseline someone measured — the platform never estimates
        its own savings.
      </p>

      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-col gap-3">
        <input
          name="metricKey"
          required
          maxLength={80}
          disabled={pending}
          placeholder="email_triage"
          aria-label="Task name"
          className={inputClass}
        />
        <input
          name="description"
          maxLength={200}
          disabled={pending}
          placeholder="What the task is (optional)"
          aria-label="Description"
          className={inputClass}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Minutes, done by hand
            </span>
            <input
              name="minutesPerOccurrence"
              type="number"
              min="1"
              step="1"
              required
              disabled={pending}
              placeholder="45"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Loaded hourly rate
            </span>
            <input
              name="hourlyRateUsd"
              type="number"
              min="1"
              step="0.01"
              required
              disabled={pending}
              placeholder="65"
              className={inputClass}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving…" : "Record baseline"}
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function AttributeForm({
  workspaceId,
  baselines,
  runs,
}: {
  workspaceId: string;
  baselines: Baseline[];
  runs: AttributableRun[];
}) {
  const [state, formAction, pending] = useActionState(
    attributeRunOutcome,
    initialState,
  );

  if (baselines.length === 0 || runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-400">
          {baselines.length === 0
            ? "Record a baseline first."
            : "No completed runs to attribute yet."}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          ROI needs both: what the work used to cost, and a run that replaced it.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="rounded-xl border border-slate-800 bg-slate-900 p-5"
    >
      <h3 className="mb-1 text-sm font-bold text-slate-100">
        Attribute a run
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        Say which manual task a completed run replaced, and how many times over.
      </p>

      <input type="hidden" name="workspaceId" value={workspaceId} />

      <div className="flex flex-col gap-3">
        <select
          name="graphExecutionId"
          required
          disabled={pending}
          aria-label="Completed run"
          className={inputClass}
        >
          {runs.map((run) => (
            <option key={run.id} value={run.id}>
              {run.id.slice(0, 8)} · {run.rootPrompt.slice(0, 60)}
              {run.attributedTo.length > 0
                ? ` (already: ${run.attributedTo.join(", ")})`
                : ""}
            </option>
          ))}
        </select>

        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <select
            name="baselineId"
            required
            disabled={pending}
            aria-label="Baseline"
            className={inputClass}
          >
            {baselines.map((baseline) => (
              <option key={baseline.id} value={baseline.id}>
                {baseline.metricKey} — {baseline.minutesPerOccurrence}min @ $
                {baseline.hourlyRateUsd}/hr
              </option>
            ))}
          </select>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Occurrences
            </span>
            <input
              name="occurrences"
              type="number"
              min="1"
              step="1"
              defaultValue="1"
              required
              disabled={pending}
              className={inputClass}
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Recording…" : "Record outcome"}
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function BaselineRow({
  workspaceId,
  baseline,
}: {
  workspaceId: string;
  baseline: Baseline;
}) {
  const [state, formAction, pending] = useActionState(
    deleteBaseline,
    initialState,
  );

  return (
    <tr className="border-b border-slate-800/60 last:border-0">
      <td className="py-3 pr-3">
        <div className="font-mono text-xs text-slate-200">
          {baseline.metricKey}
        </div>
        {baseline.description && (
          <div className="mt-0.5 text-[11px] text-slate-500">
            {baseline.description}
          </div>
        )}
        {state.error && (
          <div role="alert" className="mt-1 text-[10px] text-rose-400">
            {state.error}
          </div>
        )}
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        {baseline.minutesPerOccurrence} min
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        ${baseline.hourlyRateUsd.toFixed(2)}/hr
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-emerald-400">
        ${baseline.valuePerOccurrenceUsd.toFixed(2)}
      </td>
      <td className="py-3 text-right">
        <form action={formAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="baselineId" value={baseline.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
          >
            {pending ? "…" : "Remove"}
          </button>
        </form>
      </td>
    </tr>
  );
}

function OutcomeRow({
  workspaceId,
  outcome,
}: {
  workspaceId: string;
  outcome: Outcome;
}) {
  const [state, formAction, pending] = useActionState(
    deleteOutcome,
    initialState,
  );

  return (
    <tr className="border-b border-slate-800/60 last:border-0">
      <td className="py-3 pr-3 font-mono text-[10px] text-slate-500">
        {outcome.graphExecutionId.slice(0, 8)}
      </td>
      <td className="py-3 pr-3 font-mono text-xs text-slate-200">
        {outcome.metricKey}
        {state.error && (
          <div role="alert" className="mt-1 text-[10px] text-rose-400">
            {state.error}
          </div>
        )}
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        ×{outcome.occurrences}
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        {(outcome.timeSavedMinutes / 60).toFixed(1)}h
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-emerald-400">
        ${outcome.deflectedCostUsd.toFixed(2)}
      </td>
      <td className="py-3 text-right">
        <form action={formAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="outcomeId" value={outcome.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-50"
          >
            {pending ? "…" : "Undo"}
          </button>
        </form>
      </td>
    </tr>
  );
}

export default function OutcomeAttribution({
  workspaceId,
  baselines,
  outcomes,
  runs,
  canEdit,
}: {
  workspaceId: string;
  baselines: Baseline[];
  outcomes: Outcome[];
  runs: AttributableRun[];
  canEdit: boolean;
}) {
  return (
    <div className="space-y-6">
      {canEdit ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <BaselineForm workspaceId={workspaceId} />
          <AttributeForm
            workspaceId={workspaceId}
            baselines={baselines}
            runs={runs}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">
            Baselines and attributions are recorded by owners and administrators.
          </p>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
          Measured Baselines
        </h3>
        {baselines.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">
            No baselines recorded. Until one exists, no run can be valued and ROI
            stays at zero — which is the honest number, not a placeholder.
          </p>
        ) : (
          <div className="overflow-x-auto px-6 pb-4">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-3">Task</th>
                  <th className="py-3 pr-3 text-right">By hand</th>
                  <th className="py-3 pr-3 text-right">Rate</th>
                  <th className="py-3 pr-3 text-right">Per run</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {baselines.map((baseline) => (
                  <BaselineRow
                    key={baseline.id}
                    workspaceId={workspaceId}
                    baseline={baseline}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
        <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
          Attributed Outcomes
        </h3>
        {outcomes.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">
            No runs attributed yet.
          </p>
        ) : (
          <div className="overflow-x-auto px-6 pb-4">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-3">Run</th>
                  <th className="py-3 pr-3">Task replaced</th>
                  <th className="py-3 pr-3 text-right">Times</th>
                  <th className="py-3 pr-3 text-right">Saved</th>
                  <th className="py-3 pr-3 text-right">Value</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {outcomes.map((outcome) => (
                  <OutcomeRow
                    key={outcome.id}
                    workspaceId={workspaceId}
                    outcome={outcome}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
