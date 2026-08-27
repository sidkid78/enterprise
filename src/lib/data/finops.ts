import "server-only";

import { createClient } from "@/lib/supabase/server";

export type BudgetStatus = {
  currentSpendUsd: number;
  monthlyBudgetUsd: number;
  hardStopEnabled: boolean;
  overBudget: boolean;
  maxTokensPerExecution: number;
  /** null when no cap is configured, so callers do not divide by zero. */
  fractionUsed: number | null;
};

export type RunSpend = {
  graphExecutionId: string;
  totalCostUsd: number;
  totalTokens: number;
  callCount: number;
  /** Cost per routing tier, e.g. { critic_gate: 0.0016 }. */
  tierBreakdown: Record<string, number>;
};

export async function getBudgetStatus(
  workspaceId: string,
): Promise<BudgetStatus | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_budget_state", {
    p_workspace_id: workspaceId,
  });

  if (error) return null;

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;

  const spend = Number(row.current_spend_usd ?? 0);
  const cap = Number(row.monthly_budget_usd ?? 0);

  return {
    currentSpendUsd: spend,
    monthlyBudgetUsd: cap,
    hardStopEnabled: row.hard_stop_enabled !== false,
    overBudget: row.over_budget === true,
    maxTokensPerExecution: Number(row.max_tokens_per_execution ?? 0),
    fractionUsed: cap > 0 ? spend / cap : null,
  };
}

/**
 * True cost per run, keyed by execution id.
 *
 * Summed from `finops_token_logs` rather than from `agent_node_executions`,
 * which records only what each node's own worker call cost. The planning call
 * and every critic gate are billed against the run but belong to no node, so
 * summing node rows under-reports — measurably: one run showed $0.015374 by
 * node rows against $0.017575 actually logged.
 */
export async function getRunSpend(
  workspaceId: string,
  limit = 20,
): Promise<Map<string, RunSpend>> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("run_spend_summary", {
    p_workspace_id: workspaceId,
    p_limit: limit,
  });

  if (error) return new Map();

  type Row = {
    graph_execution_id: string;
    total_cost_usd: number | string | null;
    total_tokens: number | string | null;
    call_count: number | string | null;
    tier_breakdown: Record<string, number | string> | null;
  };

  const entries = ((data ?? []) as Row[]).map((row): [string, RunSpend] => [
    row.graph_execution_id,
    {
      graphExecutionId: row.graph_execution_id,
      totalCostUsd: Number(row.total_cost_usd ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      callCount: Number(row.call_count ?? 0),
      tierBreakdown: Object.fromEntries(
        Object.entries(row.tier_breakdown ?? {}).map(([tier, cost]) => [
          tier,
          Number(cost),
        ]),
      ),
    },
  ]);

  return new Map(entries);
}

/**
 * What the cost controls actually did, over the last seven days.
 *
 * Every field is counted from rows written as work happened. There is
 * deliberately no projected spend, no savings rate and no annualised figure:
 * those are forecasts, and this platform does not render forecasts next to
 * measurements — the same rule that keeps ROI out of the runtime's hands.
 */
export type FinopsSummary = {
  windowHours: number;
  totalSpendUsd: number;
  modelCalls: number;
  cacheHits: number;
  /**
   * Hits whose cached entry had a recorded production cost.
   *
   * Distinct from `cacheHits` on purpose. Entries written before migration
   * `…27` carry no cost, so they are real hits that contribute nothing to the
   * money figure. Showing one number for both would overstate the priced
   * evidence or understate the cache's work, depending which you picked.
   */
  cacheHitsPriced: number;
  /** Measured: what those answers cost when they were first produced. */
  avoidedCostUsd: number;
  avoidedTokens: number;
  cheapCalls: number;
  defaultCalls: number;
  reasoningCalls: number;
  criticCalls: number;
  totalTokens: number;
};

export async function getFinopsSummary(
  workspaceId: string,
): Promise<FinopsSummary | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("workspace_finops_summary", {
    p_workspace_id: workspaceId,
    p_window_hours: 168,
  });

  if (error) {
    throw new Error(`Failed to load FinOps summary: ${error.message}`);
  }

  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) return null;

  return {
    windowHours: Number(row.window_hours ?? 168),
    totalSpendUsd: Number(row.total_spend_usd ?? 0),
    modelCalls: Number(row.model_calls ?? 0),
    cacheHits: Number(row.cache_hits ?? 0),
    cacheHitsPriced: Number(row.cache_hits_priced ?? 0),
    avoidedCostUsd: Number(row.avoided_cost_usd ?? 0),
    avoidedTokens: Number(row.avoided_tokens ?? 0),
    cheapCalls: Number(row.cheap_calls ?? 0),
    defaultCalls: Number(row.default_calls ?? 0),
    reasoningCalls: Number(row.reasoning_calls ?? 0),
    criticCalls: Number(row.critic_calls ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
  };
}
