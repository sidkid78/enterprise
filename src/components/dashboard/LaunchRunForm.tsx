"use client";

import { useActionState } from "react";

import { launchRun, type LaunchState } from "@/app/dashboard/run-actions";

const initialState: LaunchState = { error: null, message: null };

export default function LaunchRunForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction, pending] = useActionState(launchRun, initialState);

  return (
    <form
      action={formAction}
      className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-4"
    >
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <label
        htmlFor="rootPrompt"
        className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500"
      >
        Launch agent run
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="rootPrompt"
          name="rootPrompt"
          required
          maxLength={2000}
          disabled={pending}
          placeholder="Reconcile Q3 vendor invoices against SAP and flag discrepancies over $10,000"
          className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-cyan-500 px-5 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Running…" : "Run"}
        </button>
      </div>

      {pending && (
        <p className="mt-2 text-xs text-slate-500">
          Planning and executing inline — this can take up to a minute.
        </p>
      )}
      {state.error && (
        <p
          role="alert"
          className="mt-2 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-400"
        >
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
          {state.message}
        </p>
      )}
    </form>
  );
}
