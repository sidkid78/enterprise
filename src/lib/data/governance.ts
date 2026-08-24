import "server-only";

import { createClient } from "@/lib/supabase/server";

/** Roles the `audit_ledger_select` policy admits. */
export const LEDGER_ROLES = [
  "workspace_owner",
  "ai_administrator",
  "compliance_auditor",
];

export type GuardrailEvent = {
  id: string;
  gateLayer: string;
  verdict: string;
  riskScore: number | null;
  snippet: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  graphExecutionId: string | null;
};

export type LedgerEntry = {
  sequenceId: number;
  agentId: string;
  actionType: string;
  payload: Record<string, unknown> | null;
  currentHash: string;
  createdAt: string;
  graphExecutionId: string | null;
};

export type ChainVerification = {
  entryCount: number;
  verifiedThrough: number | null;
  brokenAt: number | null;
  failure: string | null;
};

export type GateTally = {
  gateLayer: string;
  verdict: string;
  count: number;
};

export async function getGuardrailEvents(
  workspaceId: string,
  limit = 100,
): Promise<GuardrailEvent[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("guardrail_events")
    .select(
      "id, gate_layer, verdict, risk_score, raw_payload_snippet, sanitized_payload, created_at, graph_execution_id",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load guardrail events: ${error.message}`);
  }

  type Row = {
    id: string;
    gate_layer: string;
    verdict: string;
    risk_score: number | string | null;
    raw_payload_snippet: string | null;
    sanitized_payload: Record<string, unknown> | null;
    created_at: string;
    graph_execution_id: string | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    gateLayer: row.gate_layer,
    verdict: row.verdict,
    // numeric arrives as a string over the wire.
    riskScore: row.risk_score === null ? null : Number(row.risk_score),
    snippet: row.raw_payload_snippet,
    details: row.sanitized_payload,
    createdAt: row.created_at,
    graphExecutionId: row.graph_execution_id,
  }));
}

/**
 * Ledger entries.
 *
 * The `audit_ledger_select` policy admits only owners, administrators and
 * compliance auditors, so a member without one of those roles gets zero rows
 * rather than an error. Callers should check the viewer's role to tell "nothing
 * recorded" apart from "not yours to read".
 */
export async function getLedgerEntries(
  workspaceId: string,
  limit = 100,
): Promise<LedgerEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_audit_ledger")
    .select(
      "sequence_id, agent_id, action_type, payload, current_hash, created_at, graph_execution_id",
    )
    .eq("workspace_id", workspaceId)
    .order("sequence_id", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load ledger: ${error.message}`);
  }

  type Row = {
    sequence_id: number;
    agent_id: string;
    action_type: string;
    payload: Record<string, unknown> | null;
    current_hash: string;
    created_at: string;
    graph_execution_id: string | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    sequenceId: row.sequence_id,
    agentId: row.agent_id,
    actionType: row.action_type,
    payload: row.payload,
    currentHash: row.current_hash,
    createdAt: row.created_at,
    graphExecutionId: row.graph_execution_id,
  }));
}

/**
 * Recomputes the hash chain server-side.
 *
 * The RPC is SECURITY INVOKER, so this verifies only what the caller may
 * already read — and returns null when they may read nothing, which the UI
 * renders as "not available to your role" rather than as a passing check. A
 * verification the viewer cannot actually perform must never look like a pass.
 */
export async function verifyLedgerChain(
  workspaceId: string,
): Promise<ChainVerification | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("verify_ledger_chain", {
    p_workspace_id: workspaceId,
  });

  if (error) return null;

  type Row = {
    entry_count: number | string | null;
    verified_through: number | string | null;
    broken_at: number | string | null;
    failure: string | null;
  };

  const row = (data as Row[] | null)?.[0];
  if (!row) return null;

  return {
    entryCount: Number(row.entry_count ?? 0),
    verifiedThrough:
      row.verified_through === null ? null : Number(row.verified_through),
    brokenAt: row.broken_at === null ? null : Number(row.broken_at),
    failure: row.failure,
  };
}

/** Counts by gate and verdict, for the summary strip. */
export function tallyGates(events: GuardrailEvent[]): GateTally[] {
  const counts = new Map<string, GateTally>();

  for (const event of events) {
    const key = `${event.gateLayer}::${event.verdict}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, {
        gateLayer: event.gateLayer,
        verdict: event.verdict,
        count: 1,
      });
    }
  }

  return [...counts.values()].sort((a, b) => b.count - a.count);
}
