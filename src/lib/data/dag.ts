import "server-only";

import { createClient } from "@/lib/supabase/server";

import { getRunSpend } from "./finops";

export type DagNodeStatus =
  | "completed"
  | "running"
  | "waiting_hitl"
  | "failed";

export type DagNode = {
  id: string;
  agentRole: string;
  model: string;
  status: DagNodeStatus;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  dependencies: string[];
  outputSnippet: string;
  /** The actual work product. Without this the UI shows only a one-line summary. */
  result: unknown;
  /** True when this node was served from the semantic cache (cost $0). */
  fromCache: boolean;
};

/**
 * The assembled deliverable written by the runtime at completion. Older runs
 * predate it and stored only `{ steps }`, so this is null for them rather than
 * being reconstructed — a half-built document would misrepresent the run.
 */
export type RunDeliverable = {
  markdown: string;
  generatedAt: string | null;
  cachedNodeCount: number;
};

export type GraphExecution = {
  id: string;
  orchestratorName: string;
  status: string;
  rootPrompt: string;
  startedAt: string;
  /**
   * True cost of the run, from the token log.
   *
   * Summing the node rows misses the planning call and every critic gate, which
   * are billed against the run but belong to no node. Null when the run has no
   * logged calls.
   */
  trueCostUsd: number | null;
  trueTokens: number | null;
  deliverable: RunDeliverable | null;
  nodes: DagNode[];
};

const NODE_STATUSES: DagNodeStatus[] = [
  "completed",
  "running",
  "waiting_hitl",
  "failed",
];

function toStatus(raw: unknown): DagNodeStatus {
  return NODE_STATUSES.includes(raw as DagNodeStatus)
    ? (raw as DagNodeStatus)
    : "running";
}

/**
 * Extracts a short human-readable line from a node's jsonb output for the trace
 * card. The runtime is expected to write `{ summary }`; anything else falls
 * back to a truncated serialization rather than rendering raw JSON at full
 * length.
 */
function toSnippet(raw: unknown): string {
  if (raw == null) return "Awaiting output…";
  const value = raw as Record<string, unknown>;
  if (typeof value.summary === "string") return value.summary;
  if (typeof value.outputSnippet === "string") return value.outputSnippet;

  const serialized = JSON.stringify(raw);
  return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized;
}

/**
 * `final_output` is jsonb, so its shape is not enforced by the schema. Accept
 * only a report that actually carries rendered markdown.
 */
function toDeliverable(raw: unknown): RunDeliverable | null {
  if (raw == null || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.markdown !== "string" || value.markdown.length === 0) {
    return null;
  }
  const totals = (value.totals ?? {}) as Record<string, unknown>;
  return {
    markdown: value.markdown,
    generatedAt:
      typeof value.generatedAt === "string" ? value.generatedAt : null,
    cachedNodeCount:
      typeof totals.cachedNodeCount === "number" ? totals.cachedNodeCount : 0,
  };
}

/**
 * Most recent executions with their nodes, for the DAG trace visualizer.
 *
 * Nodes are fetched in the same round trip via the FK relationship rather than
 * per-execution, to avoid an N+1 as the run list grows.
 */
export async function getRecentExecutions(
  workspaceId: string,
  limit = 5,
): Promise<GraphExecution[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("agent_graph_executions")
    .select(
      `id,
       orchestrator_name,
       status,
       root_prompt,
       started_at,
       final_output,
       agent_node_executions (
         node_id,
         agent_role,
         model_routing_used,
         node_status,
         latency_ms,
         prompt_tokens,
         completion_tokens,
         cost_usd,
         depends_on,
         output_payload,
         interaction_id,
         created_at
       )`,
    )
    .eq("workspace_id", workspaceId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load executions: ${error.message}`);
  }

  const spendByRun = await getRunSpend(workspaceId, limit);

  type NodeRow = {
    node_id: string;
    agent_role: string;
    model_routing_used: string;
    node_status: string;
    latency_ms: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    cost_usd: number | string | null;
    depends_on: string[] | null;
    output_payload: unknown;
    interaction_id: string | null;
    created_at: string;
  };

  type Row = {
    id: string;
    orchestrator_name: string;
    status: string;
    root_prompt: string;
    started_at: string;
    final_output: unknown;
    agent_node_executions: NodeRow[] | null;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    orchestratorName: row.orchestrator_name,
    status: row.status,
    rootPrompt: row.root_prompt,
    startedAt: row.started_at,
    trueCostUsd: spendByRun.get(row.id)?.totalCostUsd ?? null,
    trueTokens: spendByRun.get(row.id)?.totalTokens ?? null,
    deliverable: toDeliverable(row.final_output),
    nodes: (row.agent_node_executions ?? [])
      .slice()
      // All nodes of a plan are inserted in one statement and so share a
      // created_at; node_id breaks the tie deterministically.
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) ||
          a.node_id.localeCompare(b.node_id),
      )
      .map((node) => ({
        id: node.node_id,
        agentRole: node.agent_role,
        model: node.model_routing_used,
        status: toStatus(node.node_status),
        latencyMs: node.latency_ms ?? 0,
        // numeric columns arrive as strings over the wire; coerce explicitly so
        // the UI never renders "0.0372" concatenated as text.
        tokensUsed: (node.prompt_tokens ?? 0) + (node.completion_tokens ?? 0),
        costUsd: Number(node.cost_usd ?? 0),
        dependencies: node.depends_on ?? [],
        outputSnippet: toSnippet(node.output_payload),
        result:
          node.output_payload &&
          typeof node.output_payload === "object" &&
          "result" in node.output_payload
            ? (node.output_payload as { result: unknown }).result
            : null,
        // A completed node with no interaction_id was served from cache: the
        // runtime only records an id when it actually called the model.
        fromCache: node.node_status === "completed" && !node.interaction_id,
      })),
  }));
}

export async function countActiveExecutions(
  workspaceId: string,
): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("agent_graph_executions")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    // "pending" counts as live: the run exists and is queued, and showing it
    // only once a worker picks it up would make a busy queue look idle.
    .in("status", ["pending", "running", "waiting_hitl"]);

  if (error) {
    throw new Error(`Failed to count executions: ${error.message}`);
  }

  return count ?? 0;
}
