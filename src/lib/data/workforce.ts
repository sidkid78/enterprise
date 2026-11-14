import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { SopContent, SopStep } from "@/lib/workforce/sop";

export type { SopStep };

export type TrainingModule = {
  id: string;
  title: string;
  workflowDomain: string;
  version: number;
  /** Mean completion across enrolled people, 0-100. */
  completion: number;
  agentsAssigned: number;
  /** How many people have started this procedure. */
  humans: number;
  isPublished: boolean;

  // ---- the procedure itself -------------------------------------------
  // Four SOPs were generated, three published to the team, and none of them
  // could be read anywhere in the product: "Review SOP" was a bare button with
  // no handler, so `sop_content` was reachable only through SQL. A published
  // procedure nobody can open is not guidance.
  overview: string;
  steps: SopStep[];
  systemsTouched: string[];
  sourceRunId: string | null;
  generatedAt: string | null;

  // ---- the viewer's own record ----------------------------------------
  /** Null when this person has not started the procedure. */
  myCompletedSteps: number[] | null;
};

type ProgressRow = {
  user_id: string;
  completed_steps: number[] | null;
};

type Row = {
  id: string;
  title: string;
  workflow_domain: string;
  version: number;
  is_published: boolean;
  generated_from_graph_id: string | null;
  sop_content: SopContent | null;
  user_upskilling_progress: ProgressRow[] | null;
};

/**
 * Every SOP in the workspace, with its content and the caller's own progress.
 *
 * The denominator for completion is the SOP's own step count, read from
 * `sop_content`, never a number stored on the progress row. `total_modules`
 * used to default to 10 against four-step procedures, so any percentage
 * computed from it was arithmetic over an undefined quantity.
 *
 * A supervisor sees every enrolled person's rows (the `upskilling_select`
 * policy allows owner/administrator); everyone else sees only their own. That
 * means `humans` is a floor rather than a count for ordinary members — stated
 * where it is rendered rather than quietly presented as the whole roster.
 */
export async function getTrainingModules(
  workspaceId: string,
  viewerId: string | null,
): Promise<TrainingModule[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("workforce_sop_templates")
    .select(
      `id,
       title,
       workflow_domain,
       version,
       is_published,
       generated_from_graph_id,
       sop_content,
       user_upskilling_progress ( user_id, completed_steps )`,
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Failed to load SOP templates: ${error.message}`);
  }

  const rows = (data ?? []) as Row[];

  // How many distinct agent roles produced each source graph. One query for all
  // SOPs rather than per row.
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
    const content = row.sop_content;
    const steps = content?.steps ?? [];
    const progress = row.user_upskilling_progress ?? [];

    // Only steps that still exist in this version count. A stored order that no
    // longer appears in the procedure is not progress through it.
    const valid = new Set(steps.map((s) => s.order));
    const ticked = (list: number[] | null) =>
      (list ?? []).filter((order) => valid.has(order)).length;

    const completion =
      steps.length === 0 || progress.length === 0
        ? 0
        : Math.round(
            (progress.reduce((sum, p) => sum + ticked(p.completed_steps), 0) /
              (progress.length * steps.length)) *
              100,
          );

    const mine = viewerId
      ? progress.find((p) => p.user_id === viewerId)
      : undefined;

    return {
      id: row.id,
      title: row.title,
      workflowDomain: row.workflow_domain,
      version: row.version,
      completion,
      agentsAssigned: row.generated_from_graph_id
        ? (agentsByGraph.get(row.generated_from_graph_id)?.size ?? 0)
        : 0,
      humans: progress.length,
      isPublished: row.is_published,

      overview: content?.overview ?? "",
      steps,
      systemsTouched: content?.systemsTouched ?? [],
      sourceRunId: content?.sourceRunId ?? row.generated_from_graph_id,
      generatedAt: content?.generatedAt ?? null,

      // `undefined` (not enrolled) and `[]` (started, nothing ticked) are
      // different facts, and the control needs to tell them apart.
      myCompletedSteps: mine
        ? (mine.completed_steps ?? []).filter((o) => valid.has(o))
        : null,
    };
  });
}
