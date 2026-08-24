"use server";

import { revalidatePath } from "next/cache";

import { buildSopFromRun } from "@/lib/workforce/sop";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export type OutcomeState = { error: string | null; message: string | null };

/** Roles that own commercial reporting and the team's procedures. */
const REPORTING_ROLES = ["workspace_owner", "ai_administrator"];

async function assertReporter(workspaceId: string): Promise<string | null> {
  if (!workspaceId) return "No workspace selected.";

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return "Not signed in.";

  // Filtered by user_id: the workspace_members SELECT policy admits the whole
  // roster, so RLS alone returns a row per member rather than per caller.
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) return "You are not a member of this workspace.";
  if (!REPORTING_ROLES.includes(membership.role as string)) {
    return "Your role cannot record baselines or outcomes.";
  }

  return null;
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export async function recordBaseline(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const metricKey = String(formData.get("metricKey") ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  const description = String(formData.get("description") ?? "").trim();
  const minutes = Number(formData.get("minutesPerOccurrence"));
  const rate = Number(formData.get("hourlyRateUsd"));

  if (!metricKey) return { error: "Name the task being measured.", message: null };
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { error: "Minutes per occurrence must be greater than zero.", message: null };
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: "An hourly rate is required to value the time saved.", message: null };
  }

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase.from("bio_baseline_metrics").upsert(
    {
      workspace_id: workspaceId,
      metric_key: metricKey,
      description: description || null,
      baseline_value: minutes,
      unit: "minutes_per_occurrence",
      hourly_rate_usd: rate,
    },
    { onConflict: "workspace_id,metric_key" },
  );

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return {
    error: null,
    message: `Baseline recorded: ${metricKey} takes ${minutes} min at $${rate}/hr manually.`,
  };
}

export async function deleteBaseline(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const baselineId = String(formData.get("baselineId") ?? "");

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bio_baseline_metrics")
    .delete()
    .eq("id", baselineId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: "Baseline removed." };
}

// ---------------------------------------------------------------------------
// Outcome attribution
// ---------------------------------------------------------------------------

/**
 * Attributes a completed run to a baseline, producing the saving it represents.
 *
 * This is the only way an ROI figure enters the system. The runtime never
 * estimates what a run saved — that would be the platform grading its own
 * homework. A person states what the work used to cost, and a person says this
 * run replaced it.
 */
export async function attributeRunOutcome(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const graphExecutionId = String(formData.get("graphExecutionId") ?? "");
  const baselineId = String(formData.get("baselineId") ?? "");
  const occurrences = Number(formData.get("occurrences") ?? 1);

  if (!graphExecutionId) return { error: "Pick a run.", message: null };
  if (!baselineId) return { error: "Pick a baseline.", message: null };
  if (!Number.isFinite(occurrences) || occurrences <= 0) {
    return { error: "Occurrences must be greater than zero.", message: null };
  }

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();

  const { data: baseline } = await supabase
    .from("bio_baseline_metrics")
    .select("metric_key, baseline_value, hourly_rate_usd")
    .eq("id", baselineId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!baseline) return { error: "Baseline not found.", message: null };

  // The run must exist, belong here, and have completed. Attributing a saving
  // to a run that failed or halted would claim work that never landed.
  const { data: run } = await supabase
    .from("agent_graph_executions")
    .select("id, status")
    .eq("id", graphExecutionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!run) return { error: "Run not found in this workspace.", message: null };
  if (run.status !== "completed") {
    return {
      error: `That run is ${run.status}; only a completed run represents work delivered.`,
      message: null,
    };
  }

  const minutesSaved = Number(baseline.baseline_value) * occurrences;
  const deflectedCost = (minutesSaved / 60) * Number(baseline.hourly_rate_usd);

  const { error } = await supabase.from("bio_outcome_logs").insert({
    workspace_id: workspaceId,
    graph_execution_id: graphExecutionId,
    metric_key: baseline.metric_key,
    measured_value: occurrences,
    time_saved_minutes: minutesSaved,
    deflected_cost_usd: deflectedCost,
  });

  if (error) {
    // The unique index on (graph_execution_id, metric_key) is the likely cause.
    return {
      error:
        error.code === "23505"
          ? "This run has already been attributed to that baseline."
          : error.message,
      message: null,
    };
  }

  revalidatePath("/dashboard");
  return {
    error: null,
    message: `Recorded ${(minutesSaved / 60).toFixed(1)}h saved, worth $${deflectedCost.toFixed(2)}.`,
  };
}

export async function deleteOutcome(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const outcomeId = String(formData.get("outcomeId") ?? "");

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("bio_outcome_logs")
    .delete()
    .eq("id", outcomeId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: "Attribution removed." };
}

// ---------------------------------------------------------------------------
// SOPs
// ---------------------------------------------------------------------------

export async function generateSop(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const graphExecutionId = String(formData.get("graphExecutionId") ?? "");
  const workflowDomain =
    String(formData.get("workflowDomain") ?? "").trim() || "general";

  if (!graphExecutionId) return { error: "Pick a run.", message: null };

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  // Reads across nodes, gates and the ledger with the service role, so the
  // membership check above is the authorization — same contract as launchGraph.
  const built = await buildSopFromRun(createServiceClient(), {
    workspaceId,
    graphExecutionId,
  });

  // Narrows the union: content and title are non-null exactly when error is.
  if (built.error !== null) return { error: built.error, message: null };

  const supabase = await createClient();

  // A re-generated SOP for the same run supersedes the previous draft rather
  // than accumulating near-identical entries.
  const { data: existing } = await supabase
    .from("workforce_sop_templates")
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq("generated_from_graph_id", graphExecutionId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("workforce_sop_templates").insert({
    workspace_id: workspaceId,
    title: built.title,
    workflow_domain: workflowDomain,
    generated_from_graph_id: graphExecutionId,
    sop_content: built.content,
    version: (existing?.version ?? 0) + 1,
    // Always a draft. Observing how something was done once is not the same as
    // endorsing it as how the team should work.
    is_published: false,
  });

  if (error) return { error: error.message, message: null };

  return {
    error: null,
    message: `Drafted "${built.title}" from ${built.content.steps.length} completed steps. Review it before publishing.`,
  };
}

export async function setSopPublished(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const sopId = String(formData.get("sopId") ?? "");
  const publish = String(formData.get("publish") ?? "") === "true";

  const denied = await assertReporter(workspaceId);
  if (denied) return { error: denied, message: null };

  const supabase = await createClient();
  const { error } = await supabase
    .from("workforce_sop_templates")
    .update({ is_published: publish })
    .eq("id", sopId)
    .eq("workspace_id", workspaceId);

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return {
    error: null,
    message: publish ? "Published to the team." : "Unpublished.",
  };
}

/**
 * Records the caller's own progress through an SOP.
 *
 * Writes the caller's row only — the `upskilling_insert` / `upskilling_update`
 * policies pin user_id to auth.uid(), so this cannot mark a colleague as
 * trained even if the form is tampered with.
 */
export async function updateOwnProgress(
  _prev: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const workspaceId = String(formData.get("workspaceId") ?? "");
  const sopId = String(formData.get("sopId") ?? "");
  const completed = Number(formData.get("completedModules") ?? 0);
  const total = Number(formData.get("totalModules") ?? 0);

  if (!sopId) return { error: "No procedure selected.", message: null };
  if (!Number.isFinite(completed) || completed < 0) {
    return { error: "Invalid progress value.", message: null };
  }

  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return { error: "Not signed in.", message: null };

  const totalModules = Number.isFinite(total) && total > 0 ? total : 1;

  const { error } = await supabase.from("user_upskilling_progress").upsert(
    {
      workspace_id: workspaceId,
      user_id: userId,
      sop_id: sopId,
      completed_modules: Math.min(completed, totalModules),
      total_modules: totalModules,
      last_active_at: new Date().toISOString(),
    },
    { onConflict: "user_id,sop_id" },
  );

  if (error) return { error: error.message, message: null };

  revalidatePath("/dashboard");
  return { error: null, message: null };
}
