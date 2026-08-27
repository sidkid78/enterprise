import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUserClaims, getUserWorkspaces } from "@/lib/data/workspaces";

import OnboardingForm from "./onboarding-form";

export const metadata: Metadata = {
  title: "Create workspace · Enterprise AgentOps",
};

export default async function OnboardingPage() {
  const claims = await getUserClaims();
  if (!claims) {
    redirect("/login");
  }

  // Someone who already has a workspace has no business here.
  const workspaces = await getUserWorkspaces();
  if (workspaces.length > 0) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100 antialiased">
      <div className="w-full max-w-sm">
        <h1 className="text-lg font-bold tracking-tight text-white">
          Create your workspace
        </h1>
        <p className="mb-8 mt-1 text-xs text-slate-400">
          A workspace is the tenant boundary — agents, gates, and audit records
          all belong to one. You will be its owner.
        </p>

        <OnboardingForm />
      </div>
    </div>
  );
}
