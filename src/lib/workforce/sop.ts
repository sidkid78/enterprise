import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

export type SopStep = {
  order: number;
  heading: string;
  /**
   * What this step is for. Taken from the node's objective, because a procedure
   * has to say what to do — the outcome below says what happened once.
   */
  objective: string;
  /**
   * What happened the last time it ran.
   *
   * Empty when the node's summary carries no information: a human-approved node
   * is stored as "Approved by human reviewer", which is true and useless as an
   * instruction. Better to show nothing than to fill a procedure with it.
   */
  outcome: string;
  agentRole: string;
  /** True when this step needed a person the last time it ran. */
  requiredHuman: boolean;
};

/** Summaries the runtime writes that describe bookkeeping, not work done. */
const UNINFORMATIVE_SUMMARIES = [
  "approved by human reviewer.",
  "blocked by input guardrail.",
  "model returned structurally invalid output.",
];

export type SopContent = {
  version: 1;
  overview: string;
  sourceRunId: string;
  sourcePrompt: string;
  steps: SopStep[];
  /** Tools the run actually invoked, so the SOP names the systems involved. */
  systemsTouched: string[];
  generatedAt: string;
};

export type SopBuildResult =
  | { content: SopContent; title: string; error: null }
  | { content: null; title: null; error: string };

/**
 * Turns a completed run into a draft standard operating procedure.
 *
 * Deterministic, with no model call — the same reasoning as buildRunReport. A
 * synthesis pass would cost money, sit outside the per-node gates, and could
 * describe a procedure that differs from the one the run actually followed,
 * which is the one thing an SOP must not do. Every step here corresponds to a
 * node that ran.
 *
 * The result is always a draft. Observing how something was done once is not
 * the same as endorsing it as how the team should work, so publishing is a
 * separate, human act.
 */
export async function buildSopFromRun(
  db: Db,
  params: { workspaceId: string; graphExecutionId: string },
): Promise<SopBuildResult> {
  const empty = { content: null, title: null } as const;

  const { data: graph } = await db
    .from("agent_graph_executions")
    .select("id, workspace_id, root_prompt, status, final_output")
    .eq("id", params.graphExecutionId)
    .eq("workspace_id", params.workspaceId)
    .maybeSingle();

  if (!graph) {
    return { ...empty, error: "Run not found in this workspace." };
  }

  if (graph.status !== "completed") {
    // A halted or failed run describes a procedure that did not work.
    return {
      ...empty,
      error: `This run is ${graph.status}. Only a completed run can become an SOP.`,
    };
  }

  const { data: nodes } = await db
    .from("agent_node_executions")
    .select("node_id, agent_role, node_status, depends_on, input_payload, output_payload")
    .eq("graph_execution_id", params.graphExecutionId)
    .order("created_at", { ascending: true });

  type NodeRow = {
    node_id: string;
    agent_role: string;
    node_status: string;
    depends_on: string[] | null;
    input_payload: { objective?: string } | null;
    output_payload: { summary?: string; result?: { heading?: string } } | null;
  };

  const rows = ((nodes ?? []) as NodeRow[]).filter(
    (n) => n.node_status === "completed",
  );

  if (rows.length === 0) {
    return { ...empty, error: "This run has no completed steps." };
  }

  // Which steps needed a person. A procedure that hides its approval points is
  // worse than no procedure — the reviewer is the control.
  const { data: gates } = await db
    .from("hitl_approval_gates")
    .select("node_execution_id")
    .eq("graph_execution_id", params.graphExecutionId);

  const { data: gateNodes } = await db
    .from("agent_node_executions")
    .select("node_id, id")
    .eq("graph_execution_id", params.graphExecutionId);

  const nodeIdByPk = new Map(
    ((gateNodes ?? []) as { node_id: string; id: string }[]).map((n) => [
      n.id,
      n.node_id,
    ]),
  );
  const humanTouched = new Set(
    ((gates ?? []) as { node_execution_id: string | null }[])
      .map((g) => (g.node_execution_id ? nodeIdByPk.get(g.node_execution_id) : null))
      .filter((v): v is string => Boolean(v)),
  );

  // Systems the run actually reached, taken from the ledger rather than from
  // the registry: what matters is what this procedure touched, not what the
  // workspace happens to have connected.
  const { data: ledger } = await db
    .from("agent_audit_ledger")
    .select("payload")
    .eq("graph_execution_id", params.graphExecutionId)
    .eq("action_type", "tool_invocation");

  const systemsTouched = [
    ...new Set(
      ((ledger ?? []) as { payload: Record<string, unknown> | null }[])
        .map((row) => {
          const server = row.payload?.server;
          const tool = row.payload?.tool;
          return typeof server === "string" && typeof tool === "string"
            ? `${server}.${tool}`
            : null;
        })
        .filter((v): v is string => Boolean(v)),
    ),
  ].sort();

  const ordered = inDependencyOrder(rows);

  const content: SopContent = {
    version: 1,
    overview:
      typeof graph.root_prompt === "string" && graph.root_prompt.trim()
        ? graph.root_prompt.trim()
        : "Procedure derived from a completed agent run.",
    sourceRunId: graph.id,
    sourcePrompt: graph.root_prompt ?? "",
    steps: ordered.map((node, index) => {
      const summary = (node.output_payload?.summary ?? "").trim();
      const objective = (node.input_payload?.objective ?? "").trim();

      return {
        order: index + 1,
        heading:
          node.output_payload?.result?.heading?.trim() ||
          objective ||
          node.node_id,
        objective: objective || node.node_id,
        outcome: UNINFORMATIVE_SUMMARIES.includes(summary.toLowerCase())
          ? ""
          : summary,
        agentRole: node.agent_role,
        requiredHuman: humanTouched.has(node.node_id),
      };
    }),
    systemsTouched,
    generatedAt: new Date().toISOString(),
  };

  const firstLine = (graph.root_prompt ?? "").split("\n")[0]?.trim() ?? "";
  const title =
    firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine || "Untitled procedure";

  return { content, title, error: null };
}

/**
 * Dependency order, with node_id as the tiebreak.
 *
 * Same reason as the run report: a whole plan is inserted in one statement and
 * shares a created_at to the microsecond, so ordering by it alone produces an
 * arbitrary sequence — which in a procedure means steps in the wrong order.
 */
function inDependencyOrder<
  T extends { node_id: string; depends_on: string[] | null },
>(rows: T[]): T[] {
  const remaining = [...rows].sort((a, b) => a.node_id.localeCompare(b.node_id));
  const emitted = new Set<string>();
  const ordered: T[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((row) =>
      (row.depends_on ?? []).every(
        (dep) => emitted.has(dep) || !rows.some((r) => r.node_id === dep),
      ),
    );
    const [next] = remaining.splice(index === -1 ? 0 : index, 1);
    emitted.add(next.node_id);
    ordered.push(next);
  }

  return ordered;
}
