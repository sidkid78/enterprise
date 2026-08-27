import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * A gate is OPEN until somebody decides it. Escalation raises the rank needed
 * to decide; it does not answer the question, so an escalated gate belongs in
 * the queue — filtering to `pending` alone made an escalated gate invisible to
 * the very people it had just been handed to.
 */
const OPEN_STATUSES = ["pending", "escalated"];

/**
 * Mirrors `private.hitl_review_sla_hours()`. A UI affordance only — the
 * database re-checks it, and `expire_hitl_gate` refuses a gate that is not
 * actually overdue.
 */
export const REVIEW_SLA_HOURS = 24;

import type { UserRole } from "@/lib/roles";

export type ReasoningSummary = {
  primaryCause: string;
  triggerDescription: string;
  riskFactors: string[];
};

export type PendingGate = {
  id: string;
  graphExecutionId: string;
  agentRole: string;
  triggerReason: string;
  confidenceScore: number | null;
  requiredRole: UserRole;
  /**
   * True once a reviewer has handed this gate upward. The gate is still open —
   * this only says the bar in `requiredRole` was raised by a person rather than
   * set by the trigger evaluator.
   */
  escalated: boolean;
  createdAt: string;
  /**
   * Hours this gate has been waiting, measured server-side.
   *
   * Not derived in the component: the dashboard is a server component that
   * changes only on navigation, so a `Date.now()` during render would age a
   * gate against rows frozen at page load. Same reason `QueueHealth` carries
   * `observedAt`, and React's compiler lint rejects the impure call anyway.
   */
  ageHours: number;
  /** Past the review SLA — nobody has looked at this in time. */
  overdue: boolean;
  reasoningSummary: ReasoningSummary;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
};

/**
 * `reasoning_log_summary` is jsonb written by the agent runtime, so its shape is
 * not guaranteed by the schema. Normalize defensively — a malformed row should
 * degrade one card, not throw the whole page.
 */
function toReasoningSummary(raw: unknown): ReasoningSummary {
  const value = (raw ?? {}) as Record<string, unknown>;
  const riskFactors = Array.isArray(value.riskFactors)
    ? value.riskFactors.filter((f): f is string => typeof f === "string")
    : [];

  return {
    primaryCause:
      typeof value.primaryCause === "string"
        ? value.primaryCause
        : "No cause recorded.",
    triggerDescription:
      typeof value.triggerDescription === "string"
        ? value.triggerDescription
        : "",
    riskFactors,
  };
}

/** Normalizes a PostgREST embedded relation that may arrive as object or array. */
function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function getPendingGates(
  workspaceId: string,
): Promise<PendingGate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("hitl_approval_gates")
    .select(
      `id,
       graph_execution_id,
       trigger_reason,
       confidence_score,
       required_role,
       created_at,
       reasoning_log_summary,
       input_payload,
       output_payload,
       status,
       agent_node_executions ( agent_role )`,
    )
    .eq("workspace_id", workspaceId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    throw new Error(`Failed to load HITL gates: ${error.message}`);
  }

  type Row = {
    id: string;
    graph_execution_id: string;
    trigger_reason: string;
    confidence_score: number | null;
    required_role: UserRole;
    status: string;
    created_at: string;
    reasoning_log_summary: unknown;
    input_payload: Record<string, unknown> | null;
    output_payload: Record<string, unknown> | null;
    // PostgREST embeds a to-one relation as an object, but the generated
    // typings widen it to an array. Accept both and normalize.
    agent_node_executions:
      | { agent_role: string }
      | { agent_role: string }[]
      | null;
  };

  const observedAt = Date.now();

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const ageHours =
      (observedAt - new Date(row.created_at).getTime()) / 3_600_000;
    return {
    id: row.id,
    graphExecutionId: row.graph_execution_id,
    agentRole: firstOf(row.agent_node_executions)?.agent_role ?? "UnknownAgent",
    triggerReason: row.trigger_reason,
    confidenceScore: row.confidence_score,
    requiredRole: row.required_role,
    escalated: row.status === "escalated",
    createdAt: row.created_at,
    reasoningSummary: toReasoningSummary(row.reasoning_log_summary),
    inputPayload: row.input_payload ?? {},
    outputPayload: row.output_payload ?? {},
    ageHours,
    overdue: ageHours >= REVIEW_SLA_HOURS,
    };
  });
}

export async function countPendingGates(workspaceId: string): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("hitl_approval_gates")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .in("status", OPEN_STATUSES);

  if (error) {
    throw new Error(`Failed to count HITL gates: ${error.message}`);
  }

  return count ?? 0;
}

/**
 * Gates still open past the review SLA.
 *
 * Counted in SQL rather than filtered from `getPendingGates`, because the badge
 * is rendered on every tab while the gate list is fetched only on the HITL one.
 * The RPC is SECURITY INVOKER and `hitl_select` already restricts gates by
 * role, so this is the count of what THIS viewer is responsible for — not the
 * workspace total. An operator being nagged about an administrator's gate they
 * cannot open would be noise.
 */
export async function countOverdueGates(workspaceId: string): Promise<number> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("overdue_gate_count", {
    p_workspace_id: workspaceId,
  });

  // A missing badge is better than a dead dashboard. The gates themselves are
  // still listed with their ages on the HITL tab either way.
  if (error) return 0;

  return Number(data ?? 0);
}

/**
 * One gate a person decided.
 *
 * `resolved_by` and `resolved_at` have been written since Phase 3 and read by
 * nothing: a gate left the interface the instant it was resolved. For a
 * governance product the decision log is the evidence the controls were
 * actually exercised, so it is not a nice-to-have view.
 */
export type Decision = {
  gateId: string;
  graphExecutionId: string;
  nodeId: string | null;
  agentRole: string | null;
  triggerReason: string;
  requiredRole: UserRole;
  status: string;
  confidenceScore: number | null;
  humanFeedback: string | null;
  resolvedBy: string | null;
  /** Email when the viewer may see it, else null — never a bare uuid. */
  resolvedByEmail: string | null;
  resolvedAt: string | null;
  createdAt: string;
  /** How long the gate waited before someone acted. */
  waitSeconds: number;
};

/**
 * Decisions on this workspace's gates, newest first.
 *
 * The RPC is SECURITY INVOKER and `hitl_select` filters by role, so a viewer
 * sees the history of gates they could have opened — not a workspace-wide log
 * that would leak the subject of gates above their rank.
 */
export async function getDecisionHistory(
  workspaceId: string,
  directory: Map<string, string>,
): Promise<Decision[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("workspace_decision_history", {
    p_workspace_id: workspaceId,
    p_limit: 50,
  });

  if (error) {
    throw new Error(`Failed to load decision history: ${error.message}`);
  }

  type Row = {
    gate_id: string;
    graph_execution_id: string;
    node_id: string | null;
    agent_role: string | null;
    trigger_reason: string;
    required_role: UserRole;
    status: string;
    confidence_score: number | null;
    human_feedback: string | null;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
    wait_seconds: number | string;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    gateId: row.gate_id,
    graphExecutionId: row.graph_execution_id,
    nodeId: row.node_id,
    agentRole: row.agent_role,
    triggerReason: row.trigger_reason,
    requiredRole: row.required_role,
    status: row.status,
    confidenceScore: row.confidence_score,
    humanFeedback: row.human_feedback,
    resolvedBy: row.resolved_by,
    resolvedByEmail: row.resolved_by
      ? (directory.get(row.resolved_by) ?? null)
      : null,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    waitSeconds: Number(row.wait_seconds ?? 0),
  }));
}
