"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { ROLE_POWER, type UserRole } from "@/lib/roles";
import { REVIEW_SLA_HOURS } from "@/lib/data/hitl";

export type ResolveDecision = "approve" | "reject" | "escalate";

export type ResolveState = {
  error: string | null;
  ok: boolean;
  /** Outcome of resuming the DAG, shown after a successful decision. */
  message?: string | null;
};

/**
 * Escalation is not a decision — it is a referral.
 *
 * The other two answer the question the gate asks and let the DAG move; this
 * one leaves the question open and raises the rank needed to answer it, per
 * `ai_docs` (Drive) -> Stateful HITL Gates -> Role-based access-control:
 * "updates the required_role on the ACTIVE record ... restricting resolution
 * power to high-tier personnel".
 *
 * It used to be treated as terminal, and that parked runs permanently: the
 * gate left `pending`, so it dropped out of the queue view AND out of the set
 * of rows the `hitl_resolve` policy would admit, leaving nobody — owner
 * included — able to touch it again. Migration ...22 makes `escalated` an open
 * state; this keeps the two consistent.
 */
const DECISION_STATUS: Record<ResolveDecision, string> = {
  approve: "approved",
  reject: "rejected",
  escalate: "escalated",
};

/** Statuses a gate can be acted on from. Mirrors the `hitl_resolve` policy. */
const OPEN_STATUSES = ["pending", "escalated"];

function isDecision(value: string): value is ResolveDecision {
  return value in DECISION_STATUS;
}

function isRole(value: string): value is UserRole {
  return value in ROLE_POWER;
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
  const escalateTo = String(formData.get("escalateTo") ?? "").trim();

  if (!gateId || !isDecision(decision)) {
    return { ok: false, error: "Invalid decision." };
  }

  const update: Record<string, unknown> = {
    status: DECISION_STATUS[decision],
    human_feedback: feedback || null,
  };

  // Only a decision is a resolution. Stamping resolved_at on an escalation
  // would record the gate as settled at the moment it was handed to somebody
  // else, and the ledger would show a reviewer resolving something they
  // explicitly declined to resolve.
  if (decision !== "escalate") {
    update.resolved_at = new Date().toISOString();
  }

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
  // Who acted, whichever way they acted. An escalation is still a human
  // touching the gate, and the reviewer who passed it upward is exactly who an
  // auditor asks about later.
  update.resolved_by = claims.claims.sub;

  if (decision === "escalate") {
    // Read the current bar before raising it. The database ratchets
    // required_role upward regardless (migration ...22), but a policy error is
    // a poor way to tell a reviewer that the tier they picked is not above the
    // one already set.
    const { data: current } = await supabase
      .from("hitl_approval_gates")
      .select("required_role")
      .eq("id", gateId)
      .maybeSingle();

    const currentRole = (current as { required_role: UserRole } | null)
      ?.required_role;

    if (!currentRole) {
      return { ok: false, error: "Gate not found." };
    }

    if (!isRole(escalateTo)) {
      return { ok: false, error: "Pick a tier to escalate to." };
    }

    if (ROLE_POWER[escalateTo] <= ROLE_POWER[currentRole]) {
      return {
        ok: false,
        error: `Escalating to ${escalateTo} would not raise the bar above ${currentRole}.`,
      };
    }

    update.required_role = escalateTo;
  }

  const { data, error } = await supabase
    .from("hitl_approval_gates")
    .update(update)
    .eq("id", gateId)
    .in("status", OPEN_STATUSES)
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

  // Escalation queues nothing. The gate is still open, so there is no
  // continuation to run — a resume job would claim the graph, find the gate
  // undecided, and return `waiting_hitl` having done nothing but occupy a
  // worker and the one active-job slot the graph is allowed.
  if (decision === "escalate") {
    revalidatePath("/dashboard");
    return {
      ok: true,
      error: null,
      message: `Escalated to ${escalateTo}. The run stays paused until someone at that tier decides.`,
    };
  }

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

export type ExpireState = { error: string | null; message: string | null };

/**
 * Closes a gate nobody answered within the review window.
 *
 * A deliberate act by a person, never a background sweep. A gate exists because
 * a decision needs a human; letting the platform close it by clock would be the
 * platform deciding by inaction, which is the failure the gate was raised to
 * prevent. What the platform does is measure the wait and say so loudly — this
 * is the operator agreeing that nobody is coming.
 *
 * Authorization lives in the RPC, which compares the caller's power against the
 * gate's `required_role` — the same predicate `hitl_resolve` uses. Whoever
 * could have answered the gate is who may declare that nobody did.
 */
export async function expireGate(
  _prev: ExpireState,
  formData: FormData,
): Promise<ExpireState> {
  const gateId = String(formData.get("gateId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!gateId) return { error: "No gate selected.", message: null };

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("expire_hitl_gate", {
    p_gate_id: gateId,
    p_reason: reason || null,
  });

  if (error) return { error: error.message, message: null };

  // Outcome words rather than exceptions, matching requeueJob: two operators
  // clearing the same stale queue have not done anything wrong.
  const outcome = String(data);
  const messages: Record<string, string> = {
    expired: "Gate expired. The run behind it was stopped and nothing was committed.",
    not_open: "That gate has already been resolved.",
    not_overdue: `Not yet overdue — a gate can only be expired after ${REVIEW_SLA_HOURS} hours.`,
    forbidden: "Your role cannot act on this gate.",
    not_found: "Gate not found.",
  };

  if (outcome === "expired") {
    revalidatePath("/dashboard");
    return { error: null, message: messages.expired };
  }

  return { error: messages[outcome] ?? `Unexpected outcome: ${outcome}`, message: null };
}

/**
 * Takes a gate, so the queue shows who is working on it.
 *
 * `hitl_approval_gates.assigned_user_id` has existed since migration ...03 and
 * was written by nothing. The consequence was measurable: gates routed to a
 * ROLE are gates no particular person owns, and the open ones were averaging
 * 89 hours against 16 for the ones that got decided.
 *
 * A CLAIM, not an assignment. The RBAC blueprint routes gates to roles and says
 * nothing about directing one at an individual, so nothing here decides who
 * ought to act — it records who says they are. Claims lapse after an hour so an
 * abandoned gate returns to the queue.
 *
 * No membership pre-check: the RPC is SECURITY INVOKER and the `hitl_resolve`
 * policy already answers "may you act on this gate", which is exactly the
 * question. Duplicating it here would be a second copy free to drift from the
 * authority.
 */
export async function claimGate(
  _prev: ExpireState,
  formData: FormData,
): Promise<ExpireState> {
  const gateId = String(formData.get("gateId") ?? "");
  if (!gateId) return { error: "No gate selected.", message: null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_hitl_gate", {
    p_gate_id: gateId,
  });

  if (error) return { error: `Could not claim: ${error.message}`, message: null };

  const outcome = (data as string | null) ?? "not_found";

  const messages: Record<string, string> = {
    claimed: "Yours for the next hour.",
    already_yours: "You already have this one.",
    // Deliberately does not name the holder: the queue row already shows it,
    // and an error message is not the place to introduce a person.
    held_by_other: "Someone else is reviewing this right now.",
    not_open: "That gate has already been decided.",
    // `hitl_select` hides gates above the caller's rank, so a gate they may not
    // open is indistinguishable from one that does not exist — correctly.
    not_found: "That gate is not available to you.",
    forbidden: "Your role cannot act on this gate.",
  };

  revalidatePath("/dashboard");

  return outcome === "claimed" || outcome === "already_yours"
    ? { error: null, message: messages[outcome] }
    : { error: messages[outcome] ?? outcome, message: null };
}

/**
 * Gives a gate back to the queue.
 *
 * Only the holder may release their own claim. Clearing somebody else's would
 * be deciding on their behalf that they are not working on something — the
 * dispatch behaviour this design avoids. A claim held by someone unavailable is
 * handled by the TTL, which needs nobody's judgement.
 */
export async function releaseGate(
  _prev: ExpireState,
  formData: FormData,
): Promise<ExpireState> {
  const gateId = String(formData.get("gateId") ?? "");
  if (!gateId) return { error: "No gate selected.", message: null };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_hitl_gate", {
    p_gate_id: gateId,
  });

  if (error) return { error: `Could not release: ${error.message}`, message: null };

  const outcome = (data as string | null) ?? "not_found";

  const messages: Record<string, string> = {
    released: "Back in the queue.",
    not_claimed: "Nobody is holding that gate.",
    not_yours: "That claim is not yours to release.",
    not_found: "That gate is not available to you.",
    forbidden: "Your role cannot act on this gate.",
  };

  revalidatePath("/dashboard");

  return outcome === "released"
    ? { error: null, message: messages.released }
    : { error: messages[outcome] ?? outcome, message: null };
}
