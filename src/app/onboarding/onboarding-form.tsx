"use client";

import { useActionState } from "react";

import { createWorkspace, type OnboardingState } from "./actions";

const initialState: OnboardingState = { error: null };

export default function OnboardingForm() {
  const [state, formAction, pending] = useActionState(
    createWorkspace,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="name"
          className="block text-xs font-medium text-slate-400"
        >
          Workspace name
        </label>
        <input
          id="name"
          name="name"
          required
          maxLength={80}
          autoComplete="organization"
          placeholder="Acme Corp"
          className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-500 focus:outline-none"
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
