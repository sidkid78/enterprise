import "server-only";

import { createClient } from "@/lib/supabase/server";

export type RoiSummary = {
  deflectedHumanHours: number;
  totalDeflectedCostUsd: number;
  apiComputeCostUsd: number;
  netRoiUsd: number;
  /** null when there is no compute spend yet — see note below. */
  roiPercentage: number | null;
  uptimeSlaTarget: number;
  uptimeSlaActual: number;
  activeAgents: number;
  dailyDeflectedCost: { date: string; value: number }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

/**
 * Aggregates the Baseline-Instrument-Outcome tables into the commercialization
 * figures the ROI tab renders.
 *
 * Aggregation happens in TypeScript rather than SQL because the row counts here
 * are small (7 days of outcomes for one workspace). If a workspace ever pushes
 * this past a few thousand rows, move the sums into a Postgres RPC instead of
 * paginating here.
 */
export async function getRoiSummary(workspaceId: string): Promise<RoiSummary> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString();

  const [outcomes, tokens, subscription, breaches, agents] = await Promise.all([
    supabase
      .from("bio_outcome_logs")
      .select("deflected_cost_usd, time_saved_minutes, created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
    supabase
      .from("finops_token_logs")
      .select("estimated_cost_usd")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
    supabase
      .from("client_subscriptions")
      .select("sla_uptime_target")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase
      .from("sla_breach_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
    supabase
      .from("agent_node_executions")
      .select("agent_role")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
  ]);

  const firstError =
    outcomes.error ?? tokens.error ?? breaches.error ?? agents.error;
  if (firstError) {
    throw new Error(`Failed to load ROI summary: ${firstError.message}`);
  }

  type OutcomeRow = {
    deflected_cost_usd: number | string | null;
    time_saved_minutes: number | string | null;
    created_at: string;
  };

  const outcomeRows = (outcomes.data ?? []) as OutcomeRow[];

  let totalDeflectedCostUsd = 0;
  let deflectedMinutes = 0;
  const byDay = new Map<string, number>();

  for (const row of outcomeRows) {
    const cost = Number(row.deflected_cost_usd ?? 0);
    totalDeflectedCostUsd += cost;
    deflectedMinutes += Number(row.time_saved_minutes ?? 0);
    byDay.set(dayKey(row.created_at), (byDay.get(dayKey(row.created_at)) ?? 0) + cost);
  }

  const apiComputeCostUsd = (
    (tokens.data ?? []) as { estimated_cost_usd: number | string | null }[]
  ).reduce((sum, row) => sum + Number(row.estimated_cost_usd ?? 0), 0);

  // Build a dense 7-day series so the chart keeps a stable x-axis on days with
  // no activity, rather than silently compressing.
  const dailyDeflectedCost: { date: string; value: number }[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = dayKey(new Date(Date.now() - i * DAY_MS).toISOString());
    dailyDeflectedCost.push({ date: key, value: byDay.get(key) ?? 0 });
  }

  const activeAgents = new Set(
    ((agents.data ?? []) as { agent_role: string }[]).map((r) => r.agent_role),
  ).size;

  const uptimeSlaTarget = Number(
    (subscription.data as { sla_uptime_target: number | string } | null)
      ?.sla_uptime_target ?? 99.9,
  );

  // Crude but honest: each breach event costs an hour of the 7-day window.
  // Replace with real incident durations once sla_breach_events records them.
  const breachHours = breaches.count ?? 0;
  const uptimeSlaActual = Math.max(
    0,
    100 - (breachHours / (7 * 24)) * 100,
  );

  const netRoiUsd = totalDeflectedCostUsd - apiComputeCostUsd;

  return {
    deflectedHumanHours: deflectedMinutes / 60,
    totalDeflectedCostUsd,
    apiComputeCostUsd,
    netRoiUsd,
    // Guard the division: a workspace with no compute spend would otherwise
    // yield Infinity and render as "Infinity%".
    roiPercentage:
      apiComputeCostUsd > 0 ? (netRoiUsd / apiComputeCostUsd) * 100 : null,
    uptimeSlaTarget,
    uptimeSlaActual,
    activeAgents,
    dailyDeflectedCost,
  };
}
