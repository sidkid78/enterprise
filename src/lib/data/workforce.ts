import "server-only";

import { createClient } from "@/lib/supabase/server";

export type TrainingModule = {
  id: string;
  title: string;
  workflowDomain: string;
  /** Mean completion across enrolled operators, 0-100. */
  completion: number;
  agentsAssigned: number;
  humans: number;
  isPublished: boolean;
};

export async function getTrainingModules(
  workspaceId: string,
): Promise<TrainingModule[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workforce_sop_templates")
    .select(
      `id,
       title,
       workflow_domain,
       is_published,
       generated_from_graph_id,
       user_upskilling_progress ( completed_modules, total_modules )`,
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to load SOP templates: ${error.message}`);
  }

  type ProgressRow = {
    completed_modules: number | null;
    total_modules: number | null;
  };

  type Row = {
    id: string;
    title: string;
    workflow_domain: string;
    is_published: boolean;
    generated_from_graph_id: string | null;
    user_upskilling_progress: ProgressRow[] | null;
  };

  const rows = (data ?? []) as Row[];

  // How many distinct agent roles produced each source graph. Fetched in one
  // query for all SOPs rather than per row.
  const graphIds = rows
    .map((r) => r.generated_from_graph_id)
    .filter((id): id is string => Boolean(id));

  const agentsByGraph = new Map<string, Set<string>>();

  if (graphIds.length > 0) {
    const { data: nodes, error: nodeError } = await supabase
      .from("agent_node_executions")
      .select("graph_execution_id, agent_role")
      .in("graph_execution_id", graphIds);

    if (nodeError) {
      throw new Error(`Failed to load agent roles: ${nodeError.message}`);
    }

    for (const node of (nodes ?? []) as {
      graph_execution_id: string;
      agent_role: string;
    }[]) {
      const set = agentsByGraph.get(node.graph_execution_id) ?? new Set();
      set.add(node.agent_role);
      agentsByGraph.set(node.graph_execution_id, set);
    }
  }

  return rows.map((row) => {
    const progress = row.user_upskilling_progress ?? [];

    const completion =
      progress.length === 0
        ? 0
        : Math.round(
            (progress.reduce((sum, p) => {
              const total = p.total_modules ?? 0;
              // Skip rows with a zero denominator instead of producing NaN.
              if (total <= 0) return sum;
              return sum + (p.completed_modules ?? 0) / total;
            }, 0) /
              progress.length) *
              100,
          );

    return {
      id: row.id,
      title: row.title,
      workflowDomain: row.workflow_domain,
      completion,
      agentsAssigned: row.generated_from_graph_id
        ? (agentsByGraph.get(row.generated_from_graph_id)?.size ?? 0)
        : 0,
      humans: progress.length,
      isPublished: row.is_published,
    };
  });
}
