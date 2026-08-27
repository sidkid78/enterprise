import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * A gate is OPEN until somebody decides it. Escalation raises the rank needed
 * to decide; it does not answer the question, so an escalated gate belongs in
 * the queue — filtering to `pending` alone made an escalated gate invisible to
 * the very people it had just been handed to.
 */
const OPEN_STATUSES = ["pending", "escalated"];

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

  return ((data ?? []) as unknown as Row[]).map((row) => ({
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
  }));
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
