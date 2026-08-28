"use server";

import { revalidatePath } from "next/cache";

import { createServiceClient } from "@/lib/supabase/service";
import { createClient } from "@/lib/supabase/server";

export type RequeueState = { error: string | null; message: string | null };

/** Restarting stalled work is an operator act, not a reader's. */
const REQUEUE_ROLES = ["workspace_owner", "ai_administrator", "agent_operator"];

/**
 * Ending work is the same weight of act as restarting it, so it takes the same
 * roles. The database enforces this independently — `cancel_agent_job` checks
 * `has_role_power(workspace_id, 'agent_operator')` itself — and this check
 * exists to produce a sentence rather than a silent outcome word. Same division
 * as `hitl_resolve`: the database is the authority, the action is the UX.
 */
const CANCEL_ROLES = REQUEUE_ROLES;

/**
 * Confirms the caller may act on this job, and that the job is theirs.
 *
 * Membership proves rights over `workspaceId`, never over an arbitrary `jobId`
 * a client submitted — so both are checked before the id reaches a
 * service-role call.
 */
async function authorizeJob(
  workspaceId: string,
  jobId: string,
  roles: string[],
  verb: string,
): Promise<string | null> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "Not signed in.";

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return "You are not a member of this workspace.";
  if (!roles.includes(membership.role as string)) {
    return `Your role cannot ${verb} runs.`;
  }

  const { data: job } = await supabase
    .from("agent_job_queue")
    .select("id")
    .eq("id", jobId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!job) return "That job is not in this workspace.";

  return null;
}

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

  const denied = await authorizeJob(
    workspaceId,
    jobId,
    REQUEUE_ROLES,
    "restart",
  );
  if (denied) return { error: denied, message: null };

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

/**
 * Ends a job that will never be done.
 *
 * The gap this fills: `requeue_agent_job` refuses anything that is not already
 * dead-lettered, so a job sitting `queued` behind an empty worker fleet had no
 * operator exit at all. `claim_agent_job` was its only way out of that status,
 * and if nothing is draining the queue that call never comes — the run waits
 * indefinitely while `workspace_availability` correctly counts every second of
 * it as downtime.
 *
 * Unlike a retry this is terminal: there is no un-cancel, and running the work
 * again means launching it again. So the reason is passed through and kept, on
 * the job row and on the ledger.
 *
 * Called with the USER-SCOPED client, unlike `requeueJob` beside it, and the
 * difference is not stylistic. `requeue_agent_job` is granted to `service_role`
 * and needs no identity. `cancel_agent_job` is SECURITY DEFINER, granted to
 * `authenticated`, and reads `auth.uid()` twice — once to authorize through
 * `has_role_power`, once to record who ended the run. The service client
 * carries no session, so through it `auth.uid()` is null: the call is refused
 * as `forbidden`, and had it not been, the cancellation would have landed in
 * the ledger with no operator on it. Same contract as `expire_hitl_gate`.
 */
export async function cancelJob(
  _prev: RequeueState,
  formData: FormData,
): Promise<RequeueState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const jobId = String(formData.get("jobId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!workspaceId || !jobId) {
    return { error: "Nothing to cancel.", message: null };
  }

  const denied = await authorizeJob(workspaceId, jobId, CANCEL_ROLES, "cancel");
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("cancel_agent_job", {
    p_job_id: jobId,
    p_reason: reason || null,
  });

  if (error) {
    return { error: `Could not cancel: ${error.message}`, message: null };
  }

  const outcome = (data as string | null) ?? "not_found";

  const messages: Record<string, string> = {
    cancelled: "Cancelled. The run will not be picked up again.",
    // A worker is actively holding this one and will write its own ending over
    // anything we set, so refusing is the honest answer rather than a race.
    running_active:
      "A worker is running this right now. Wait for it to finish or for its lease to expire.",
    not_cancellable: "That job has already finished; there is nothing to end.",
    forbidden: "Your role cannot cancel runs.",
    not_found: "That job no longer exists.",
  };

  revalidatePath("/dashboard");

  return outcome === "cancelled"
    ? { error: null, message: messages.cancelled }
    : { error: messages[outcome] ?? outcome, message: null };
}
