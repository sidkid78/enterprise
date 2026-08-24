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
  /**
   * Measured downtime behind `uptimeSlaActual`, and how many incidents were
   * recorded — which is a different question. Only a queue stall consumes
   * availability; a failed run is an incident that leaves uptime alone, because
   * the platform was up and gave a bad answer rather than being unreachable.
   */
  downtimeSeconds: number;
  incidentCount: number;
  openIncidentCount: number;
  worstSeverity: string | null;
  /**
   * False when no availability window could be computed. The uptime figure then
   * has no measurement behind it and must not be rendered as a passing SLA —
   * "nothing was recorded" and "nothing went wrong" are different claims.
   */
  availabilityMeasured: boolean;
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

  const [outcomes, tokens, subscription, availability, agents] = await Promise.all([
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
    // Availability is computed in SQL rather than counted here: the definition
    // of downtime (which breach types consume it, how overlapping outages
    // merge, how an interval straddling the window edge is clipped) has to live
    // in one place, the same reason `over_budget` is a SQL predicate.
    supabase.rpc("workspace_availability", {
      p_workspace_id: workspaceId,
      p_window_hours: 168,
    }),
    supabase
      .from("agent_node_executions")
      .select("agent_role")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
  ]);

  const firstError =
    outcomes.error ?? tokens.error ?? availability.error ?? agents.error;
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

  type AvailabilityRow = {
    downtime_seconds: number | string | null;
    uptime_pct: number | string | null;
    incident_count: number | string | null;
    open_incident_count: number | string | null;
    worst_severity: string | null;
  };

  const availabilityRow = (availability.data as AvailabilityRow[] | null)?.[0] ?? null;

  // No row means the window could not be measured. Reporting 100% here is what
  // the old placeholder did, and it is the one answer that must not be given:
  // an unmeasured SLA rendered as a perfect one is a fabricated compliance
  // claim, which is precisely what the ledger and the critic exist to prevent.
  const availabilityMeasured = availabilityRow !== null;
  const uptimeSlaActual = Number(availabilityRow?.uptime_pct ?? 0);

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
    downtimeSeconds: Number(availabilityRow?.downtime_seconds ?? 0),
    incidentCount: Number(availabilityRow?.incident_count ?? 0),
    openIncidentCount: Number(availabilityRow?.open_incident_count ?? 0),
    worstSeverity: availabilityRow?.worst_severity ?? null,
    availabilityMeasured,
    activeAgents,
    dailyDeflectedCost,
  };
}

export type Baseline = {
  id: string;
  metricKey: string;
  description: string | null;
  minutesPerOccurrence: number;
  hourlyRateUsd: number;
  /** What one occurrence is worth, precomputed for the UI. */
  valuePerOccurrenceUsd: number;
};

export type Outcome = {
  id: string;
  graphExecutionId: string;
  metricKey: string;
  occurrences: number;
  timeSavedMinutes: number;
  deflectedCostUsd: number;
  createdAt: string;
};

export type AttributableRun = {
  id: string;
  rootPrompt: string;
  startedAt: string;
  /** Metric keys this run has already been attributed to. */
  attributedTo: string[];
};

export async function getBaselines(workspaceId: string): Promise<Baseline[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bio_baseline_metrics")
    .select("id, metric_key, description, baseline_value, hourly_rate_usd")
    .eq("workspace_id", workspaceId)
    .order("metric_key", { ascending: true });

  if (error) throw new Error(`Failed to load baselines: ${error.message}`);

  type Row = {
    id: string;
    metric_key: string;
    description: string | null;
    baseline_value: number | string | null;
    hourly_rate_usd: number | string | null;
  };

  return ((data ?? []) as Row[]).map((row) => {
    const minutes = Number(row.baseline_value ?? 0);
    const rate = Number(row.hourly_rate_usd ?? 0);
    return {
      id: row.id,
      metricKey: row.metric_key,
      description: row.description,
      minutesPerOccurrence: minutes,
      hourlyRateUsd: rate,
      valuePerOccurrenceUsd: (minutes / 60) * rate,
    };
  });
}

export async function getOutcomes(
  workspaceId: string,
  limit = 50,
): Promise<Outcome[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("bio_outcome_logs")
    .select(
      "id, graph_execution_id, metric_key, measured_value, time_saved_minutes, deflected_cost_usd, created_at",
    )
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load outcomes: ${error.message}`);

  type Row = {
    id: string;
    graph_execution_id: string;
    metric_key: string;
    measured_value: number | string | null;
    time_saved_minutes: number | string | null;
    deflected_cost_usd: number | string | null;
    created_at: string;
  };

  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id,
    graphExecutionId: row.graph_execution_id,
    metricKey: row.metric_key,
    occurrences: Number(row.measured_value ?? 0),
    timeSavedMinutes: Number(row.time_saved_minutes ?? 0),
    deflectedCostUsd: Number(row.deflected_cost_usd ?? 0),
    createdAt: row.created_at,
  }));
}

/**
 * Completed runs, with what each has already been attributed to.
 *
 * Only completed runs: a halted or failed run delivered nothing, so letting one
 * be attributed would put imaginary savings on the ROI tab.
 */
export async function getAttributableRuns(
  workspaceId: string,
  limit = 25,
): Promise<AttributableRun[]> {
  const supabase = await createClient();

  const [runs, outcomes] = await Promise.all([
    supabase
      .from("agent_graph_executions")
      .select("id, root_prompt, started_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(limit),
    supabase
      .from("bio_outcome_logs")
      .select("graph_execution_id, metric_key")
      .eq("workspace_id", workspaceId),
  ]);

  if (runs.error) {
    throw new Error(`Failed to load runs: ${runs.error.message}`);
  }

  const claimed = new Map<string, string[]>();
  for (const row of (outcomes.data ?? []) as {
    graph_execution_id: string;
    metric_key: string;
  }[]) {
    const list = claimed.get(row.graph_execution_id) ?? [];
    list.push(row.metric_key);
    claimed.set(row.graph_execution_id, list);
  }

  return (
    (runs.data ?? []) as {
      id: string;
      root_prompt: string;
      started_at: string;
    }[]
  ).map((row) => ({
    id: row.id,
    rootPrompt: row.root_prompt,
    startedAt: row.started_at,
    attributedTo: claimed.get(row.id) ?? [],
  }));
}
