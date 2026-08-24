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
