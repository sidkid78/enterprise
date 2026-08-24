"use client";

import { useActionState } from "react";

import {
  generateSop,
  setSopPublished,
  type OutcomeState,
} from "@/app/dashboard/outcome-actions";
import type { AttributableRun } from "@/lib/data/bio";
import type { TrainingModule } from "@/lib/data/workforce";

const initialState: OutcomeState = { error: null, message: null };

const inputClass =
  "rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60";

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

function GenerateForm({
  workspaceId,
  runs,
}: {
  workspaceId: string;
  runs: AttributableRun[];
}) {
  const [state, formAction, pending] = useActionState(
    generateSop,
    initialState,
  );

  if (runs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900 p-8 text-center">
        <p className="text-sm text-slate-400">No completed runs yet.</p>
        <p className="mt-1 text-xs text-slate-500">
          A procedure is written from a run that worked, so there is nothing to
          derive one from until a run completes.
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
        Draft a procedure from a run
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        Every step is taken from a node that actually ran, in dependency order,
        with the approval points marked. No model call — the procedure describes
        what happened, not what a model thinks should happen.
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
              {run.id.slice(0, 8)} · {run.rootPrompt.slice(0, 70)}
            </option>
          ))}
        </select>
        <input
          name="workflowDomain"
          maxLength={60}
          disabled={pending}
          placeholder="Domain, e.g. revops (optional)"
          aria-label="Workflow domain"
          className={inputClass}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Drafting…" : "Draft procedure"}
        </button>
      </div>

      <Feedback state={state} />
    </form>
  );
}

function SopRow({
  workspaceId,
  sop,
  canEdit,
}: {
  workspaceId: string;
  sop: TrainingModule;
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setSopPublished,
    initialState,
  );

  return (
    <tr className="border-b border-slate-800/60 last:border-0">
      <td className="py-3 pr-3">
        <div className="text-sm font-medium text-slate-100">{sop.title}</div>
        <div className="mt-0.5 font-mono text-[10px] text-slate-500">
          {sop.workflowDomain}
        </div>
        {state.error && (
          <div role="alert" className="mt-1 text-[10px] text-rose-400">
            {state.error}
          </div>
        )}
      </td>
      <td className="py-3 pr-3 text-center">
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            sop.isPublished
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-amber-500/30 bg-amber-500/10 text-amber-400"
          }`}
        >
          {sop.isPublished ? "Published" : "Draft"}
        </span>
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        {sop.humans}
      </td>
      <td className="py-3 pr-3 text-right font-mono text-xs text-slate-300">
        {sop.completion.toFixed(0)}%
      </td>
      <td className="py-3 text-right">
        {canEdit && (
          <form action={formAction}>
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="sopId" value={sop.id} />
            <input
              type="hidden"
              name="publish"
              value={String(!sop.isPublished)}
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 disabled:opacity-50"
            >
              {pending ? "…" : sop.isPublished ? "Unpublish" : "Publish"}
            </button>
          </form>
        )}
      </td>
    </tr>
  );
}

export default function SopWorkbench({
  workspaceId,
  runs,
  sops,
  canEdit,
}: {
  workspaceId: string;
  runs: AttributableRun[];
  sops: TrainingModule[];
  canEdit: boolean;
}) {
  const drafts = sops.filter((sop) => !sop.isPublished).length;

  return (
    <div className="mb-6 space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-white">
              Procedure Library
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              What an agent run teaches the team it replaced. Drafted from the
              run, published by a person.
            </p>
          </div>
          <div className="flex items-center gap-4 font-mono text-xs">
            <span>
              <span className="text-slate-400">Procedures: </span>
              <span className="font-bold text-slate-200">{sops.length}</span>
            </span>
            <span>
              <span className="text-slate-400">Awaiting review: </span>
              <span
                className={`font-bold ${drafts > 0 ? "text-amber-400" : "text-slate-200"}`}
              >
                {drafts}
              </span>
            </span>
          </div>
        </div>

        {canEdit ? (
          <GenerateForm workspaceId={workspaceId} runs={runs} />
        ) : (
          <p className="text-sm text-slate-400">
            Procedures are drafted and published by owners and administrators.
          </p>
        )}
      </div>

      {sops.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 shadow-xl">
          <h3 className="border-b border-slate-800 px-6 py-4 text-xs font-bold uppercase tracking-wider text-cyan-400">
            Procedures
          </h3>
          <div className="overflow-x-auto px-6 pb-4">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-slate-800 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <th className="py-3 pr-3">Procedure</th>
                  <th className="py-3 pr-3 text-center">Status</th>
                  <th className="py-3 pr-3 text-right">Operators</th>
                  <th className="py-3 pr-3 text-right">Completion</th>
                  <th className="py-3" />
                </tr>
              </thead>
              <tbody>
                {sops.map((sop) => (
                  <SopRow
                    key={sop.id}
                    workspaceId={workspaceId}
                    sop={sop}
                    canEdit={canEdit}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
