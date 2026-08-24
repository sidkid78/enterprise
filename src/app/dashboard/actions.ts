"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ResolveDecision = "approve" | "reject" | "escalate";

export type ResolveState = {
  error: string | null;
  ok: boolean;
  /** Outcome of resuming the DAG, shown after a successful decision. */
  message?: string | null;
};

const DECISION_STATUS: Record<ResolveDecision, string> = {
  approve: "approved",
  reject: "rejected",
  escalate: "escalated",
};

function isDecision(value: string): value is ResolveDecision {
  return value in DECISION_STATUS;
}

/**
 * Resolves a pending HITL gate.
 *
 * Authorization is not re-implemented here — this uses the user-scoped client,
 * so the `hitl_resolve` RLS policy decides whether the update is allowed. A
 * caller without the required role matches zero rows and gets a clear error
 * rather than a silent no-op.
 */
export async function resolveGate(
  _prev: ResolveState,
  formData: FormData,
): Promise<ResolveState> {
  const gateId = String(formData.get("gateId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const feedback = String(formData.get("feedback") ?? "").trim();
  const overrideRaw = String(formData.get("overridePayload") ?? "").trim();

  if (!gateId || !isDecision(decision)) {
    return { ok: false, error: "Invalid decision." };
  }

  const update: Record<string, unknown> = {
    status: DECISION_STATUS[decision],
    human_feedback: feedback || null,
    resolved_at: new Date().toISOString(),
  };

  // An override rewrites the payload the DAG will resume with, so it must be
  // valid JSON — never forward an unparsed string into the execution record.
  if (overrideRaw) {
    try {
      const parsed = JSON.parse(overrideRaw);
      if (parsed === null || typeof parsed !== "object") {
        return { ok: false, error: "Override must be a JSON object." };
      }
      update.output_payload = parsed;
    } catch {
      return { ok: false, error: "Override is not valid JSON." };
    }
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { ok: false, error: "Not signed in." };
  }
  update.resolved_by = claims.claims.sub;

  const { data, error } = await supabase
    .from("hitl_approval_gates")
    .update(update)
    .eq("id", gateId)
    .eq("status", "pending")
    .select("id, graph_execution_id, workspace_id");

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Gate could not be resolved — it may already be resolved, or your role does not permit it.",
    };
  }

  // The RLS UPDATE above is the authorization check — reaching here means the
  // caller was permitted to resolve this gate, so it is safe to hand off to the
  // service-role runtime.
  const graphExecutionId = (data[0] as { graph_execution_id: string })
    .graph_execution_id;

  // Dispatch rather than drive. The reviewer's click does not hold a connection
  // open for however long the rest of the graph takes — it queues the
  // continuation and returns. The worker picks up the same persisted state and
  // carries on from the halted node.
  const workspaceId = (data[0] as { workspace_id: string }).workspace_id;

  let resumeMessage: string | null = null;
  try {
    const { enqueueJob } = await import("@/lib/queue/jobs");
    const { createServiceClient } = await import("@/lib/supabase/service");

    const { error: queueError } = await enqueueJob(createServiceClient(), {
      workspaceId,
      graphExecutionId,
      jobType: "resume",
    });

    resumeMessage = queueError
      ? `Decision saved, but queueing the continuation failed: ${queueError}`
      : "Decision saved. The run continues in the background.";
  } catch (err) {
    // The human's decision is already committed and must not be rolled back
    // because the queue failed. Surface it and leave the record intact.
    resumeMessage =
      err instanceof Error
        ? `Decision saved, but resuming failed: ${err.message}`
        : "Decision saved, but resuming failed.";
  }

  revalidatePath("/dashboard");
  return { ok: true, error: null, message: resumeMessage };
}
