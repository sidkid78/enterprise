"use server";

import { revalidatePath } from "next/cache";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export type RequeueState = { error: string | null; message: string | null };

/** Restarting stalled work is an operator act, not a reader's. */
const REQUEUE_ROLES = ["workspace_owner", "ai_administrator", "agent_operator"];

/**
 * Returns a dead-lettered job to the queue.
 *
 * The RPC is service_role-only, like every other queue function — a client able
 * to reach it directly could make workers re-run another tenant's executions.
 * So membership and role are checked here with the user-scoped client first,
 * the same contract as launchRun.
 */
export async function requeueJob(
  _prev: RequeueState,
  formData: FormData,
): Promise<RequeueState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");

  if (!workspaceId || !jobId) {
    return { error: "Nothing to retry.", message: null };
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Not signed in.", message: null };

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return { error: "You are not a member of this workspace.", message: null };
  }

  if (!REQUEUE_ROLES.includes(membership.role as string)) {
    return { error: "Your role cannot restart runs.", message: null };
  }

  // Confirm the job belongs to this workspace before handing the id to a
  // service-role call. The membership check above proves the user's rights over
  // workspaceId, not over an arbitrary jobId they may have submitted.
  const { data: job } = await supabase
    .from("agent_job_queue")
    .select("id")
    .eq("id", jobId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!job) {
    return { error: "That job is not in this workspace.", message: null };
  }

  const { data, error } = await createServiceClient().rpc("requeue_agent_job", {
    p_job_id: jobId,
  });

  if (error) {
    return { error: `Could not requeue: ${error.message}`, message: null };
  }

  const outcome = (data as string | null) ?? "not_found";

  const messages: Record<string, string> = {
    queued: "Requeued. A worker will pick it up on its next poll.",
    already_active: "Another job is already driving this run.",
    not_failed: "That job is not dead-lettered; nothing to retry.",
    not_found: "That job no longer exists.",
  };

  revalidatePath("/dashboard");

  return outcome === "queued"
    ? { error: null, message: messages.queued }
    : { error: messages[outcome] ?? outcome, message: null };
}
