import "server-only";

import { CRITIC_RISK_THRESHOLD, reviewOutput } from "@/lib/governance/critic";
import { screenForInjection } from "@/lib/governance/injection";
import { maskPii } from "@/lib/governance/pii";
import { createServiceClient } from "@/lib/supabase/service";

import { lookupCache, storeCache } from "./cache";
import { buildRunReport } from "./report";
import {
  MODEL_TIERS,
  ROUTING_TIER_LABEL,
  estimateCostUsd,
  getGenAI,
  isModelTier,
  normalizeUsage,
  type ModelTier,
} from "./client";

/** Below this, a node hands off to a human instead of committing its output. */
const CONFIDENCE_THRESHOLD = 0.7;

/** Hard ceiling on plan size, independent of the per-workspace recursion cap. */
const MAX_NODES = 6;

type Db = ReturnType<typeof createServiceClient>;

type PlannedStep = {
  node_id: string;
  agent_role: string;
  objective: string;
  depends_on: string[];
  tier: ModelTier;
};

type WorkerOutput = {
  summary: string;
  confidence: number;
  result: Record<string, unknown>;
  risk_factors?: string[];
};

export type RunStatus = "completed" | "waiting_hitl" | "failed" | "halted_finops";

export type RunResult = {
  graphExecutionId: string;
  status: RunStatus;
  message: string;
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          node_id: { type: "string", description: "Short id, e.g. task_01." },
          agent_role: { type: "string", description: "PascalCase worker name." },
          objective: { type: "string" },
          depends_on: { type: "array", items: { type: "string" } },
          tier: {
            type: "string",
            enum: ["cheap", "default", "reasoning"],
            description:
              "cheap for extraction/routing, default for ordinary work, reasoning only for genuinely hard analysis.",
          },
        },
        required: ["node_id", "agent_role", "objective", "depends_on", "tier"],
      },
    },
  },
  required: ["steps"],
};

const WORKER_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "One line describing what was done." },
    confidence: {
      type: "number",
      description: "0-1 confidence this output is correct and safe to commit.",
    },
    /*
     * `result` was previously declared as a bare `{ type: "object" }` with no
     * properties. Structured output only emits keys the schema declares, so the
     * model had nowhere to write and every node returned `result: {}` — runs
     * completed carrying nothing but their own one-line summaries. The shape
     * below is deliberately generic enough for any agent role while still
     * giving the deliverable a declared home.
     */
    result: {
      type: "object",
      description: "The structured work product.",
      properties: {
        heading: {
          type: "string",
          description: "Short title for this work product.",
        },
        content_markdown: {
          type: "string",
          description:
            "The complete work product itself, written out in full as Markdown. This is the deliverable, not a description of one.",
        },
        key_findings: {
          type: "array",
          items: { type: "string" },
          description: "The load-bearing points, one per entry.",
        },
        data: {
          type: "array",
          description: "Optional tabular facts backing the work product.",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
              note: { type: "string" },
            },
            required: ["label", "value"],
          },
        },
      },
      required: ["heading", "content_markdown"],
    },
    risk_factors: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "confidence", "result"],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parses model JSON defensively — a malformed response must not throw mid-graph. */
function parseJson<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Orders steps so dependencies run first; ignores edges pointing outside the plan. */
function topoSort(steps: PlannedStep[]): PlannedStep[] {
  const byId = new Map(steps.map((s) => [s.node_id, s]));
  const done = new Set<string>();
  const ordered: PlannedStep[] = [];

  let progressed = true;
  while (ordered.length < steps.length && progressed) {
    progressed = false;
    for (const step of steps) {
      if (done.has(step.node_id)) continue;
      if (step.depends_on.every((d) => !byId.has(d) || done.has(d))) {
        ordered.push(step);
        done.add(step.node_id);
        progressed = true;
      }
    }
  }

  // A dependency cycle would otherwise spin forever; append the remainder so
  // the run surfaces the problem instead of hanging.
  for (const step of steps) if (!done.has(step.node_id)) ordered.push(step);
  return ordered;
}

async function recordLedger(
  db: Db,
  entry: {
    workspaceId: string;
    graphExecutionId: string;
    nodeExecutionId?: string | null;
    agentId: string;
    actionType: string;
    payload: Record<string, unknown>;
  },
) {
  // previous_hash/current_hash are NOT NULL but are overwritten by the
  // compute_ledger_hash trigger; whatever is sent here is discarded.
  await db.from("agent_audit_ledger").insert({
    workspace_id: entry.workspaceId,
    graph_execution_id: entry.graphExecutionId,
    node_execution_id: entry.nodeExecutionId ?? null,
    agent_id: entry.agentId,
    action_type: entry.actionType,
    payload: entry.payload,
    previous_hash: "",
    current_hash: "",
  });
}

/** Writes a row to the governance audit trail for one gate evaluation. */
async function recordGuardrail(
  db: Db,
  entry: {
    workspaceId: string;
    graphExecutionId: string;
    gateLayer: string;
    verdict: string;
    riskScore?: number | null;
    // Truncated: this column exists for triage, not for re-storing whole
    // payloads that a gate just judged unsafe.
    snippet?: string | null;
    sanitized?: Record<string, unknown> | null;
  },
) {
  await db.from("guardrail_events").insert({
    workspace_id: entry.workspaceId,
    graph_execution_id: entry.graphExecutionId,
    gate_layer: entry.gateLayer,
    verdict: entry.verdict,
    risk_score: entry.riskScore ?? null,
    raw_payload_snippet: entry.snippet ? entry.snippet.slice(0, 500) : null,
    sanitized_payload: entry.sanitized ?? null,
  });
}

/**
 * Adds spend to the workspace total.
 *
 * Read-modify-write, so two concurrent runs can lose an update. Acceptable
 * while runs are launched by hand; make this an atomic SQL increment before it
 * drives real billing.
 */
async function bumpSpend(db: Db, workspaceId: string, delta: number) {
  if (delta <= 0) return;
  const { data } = await db
    .from("finops_budget_controls")
    .select("current_spend_usd")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  await db
    .from("finops_budget_controls")
    .update({ current_spend_usd: Number(data?.current_spend_usd ?? 0) + delta })
    .eq("workspace_id", workspaceId);
}

async function markFailed(db: Db, graphId: string, message: string): Promise<RunResult> {
  await db
    .from("agent_graph_executions")
    .update({ status: "failed", completed_at: new Date().toISOString() })
    .eq("id", graphId);
  return { graphExecutionId: graphId, status: "failed", message };
}

// ---------------------------------------------------------------------------
// Execution engine — shared by launch and resume
// ---------------------------------------------------------------------------

type NodeRow = {
  id: string;
  node_id: string;
  agent_role: string;
  model_routing_used: string;
  input_payload: { objective?: string } | null;
  node_status: string;
  depends_on: string[] | null;
  interaction_id: string | null;
  output_payload: { summary?: string } | null;
};

/**
 * Runs every pending node of a graph in order, pausing at the first that needs
 * a human.
 *
 * Shared by `launchGraph` and `resumeGraph`, which is the whole point of
 * persisting the plan upfront: resuming is just "run the pending nodes again",
 * with conversational continuity restored from the last completed node's
 * `interaction_id` via `previous_interaction_id`.
 */
async function executePending(
  db: Db,
  graph: { id: string; workspace_id: string; root_interaction_id: string | null },
  /**
   * Cost already incurred by the caller (the planning call). Included so the
   * reported figure matches what finops_token_logs actually recorded — without
   * it a fully cached run reports $0.000000 while still having been billed for
   * decomposition.
   */
  priorCost = 0,
): Promise<RunResult> {
  const client = getGenAI();
  const graphId = graph.id;
  const workspaceId = graph.workspace_id;
  let totalCost = 0;
  const reportedCost = () => totalCost + priorCost;

  const { data: rows, error } = await db
    .from("agent_node_executions")
    .select(
      "id, node_id, agent_role, model_routing_used, input_payload, node_status, depends_on, interaction_id, output_payload",
    )
    .eq("graph_execution_id", graphId)
    .order("created_at", { ascending: true });

  if (error) return await markFailed(db, graphId, `Could not load nodes: ${error.message}`);

  const nodes = (rows ?? []) as NodeRow[];
  const completed = nodes.filter((n) => n.node_status === "completed");

  // Continuity: resume from the newest completed node's interaction, falling
  // back to the planning interaction for a graph that has run nothing yet.
  let previousInteractionId =
    completed.at(-1)?.interaction_id ?? graph.root_interaction_id ?? undefined;

  const priorContext = completed.map(
    (n) => `- ${n.node_id}: ${n.output_payload?.summary ?? "(no summary)"}`,
  );

  try {
    for (const node of nodes) {
      if (node.node_status !== "pending") continue;

      const model = node.model_routing_used;
      const tier = (Object.keys(MODEL_TIERS) as ModelTier[]).find(
        (t) => MODEL_TIERS[t] === model,
      );
      const objective = node.input_payload?.objective ?? "Complete the assigned step.";
      const startedAt = Date.now();

      await db
        .from("agent_node_executions")
        .update({ node_status: "running" })
        .eq("id", node.id);

      const context = priorContext.length
        ? `\n\nCompleted so far:\n${priorContext.join("\n")}`
        : "";

      const rawInput = `You are ${node.agent_role}. Objective: ${objective}${context}\n\nProduce the actual deliverable in result.content_markdown — the finished work itself, written out in full, not a plan or a description of what you would produce. The summary field is a one-line label for it, not a substitute.\n\nReport your confidence honestly; low confidence routes to a human reviewer rather than counting against you.`;

      /** Pauses the graph at this node and hands off to a human. */
      const escalate = async (params: {
        reason: string;
        confidence: number | null;
        primaryCause: string;
        riskFactors: string[];
        output: Record<string, unknown>;
      }): Promise<RunResult> => {
        await db.from("hitl_approval_gates").insert({
          workspace_id: workspaceId,
          graph_execution_id: graphId,
          node_execution_id: node.id,
          trigger_reason: params.reason,
          confidence_score: params.confidence,
          required_role: "agent_operator",
          reasoning_log_summary: {
            primaryCause: params.primaryCause,
            triggerDescription: `Objective: ${objective}`,
            riskFactors: params.riskFactors,
          },
          input_payload: { objective },
          output_payload: params.output,
        });

        await db
          .from("agent_graph_executions")
          .update({ status: "waiting_hitl" })
          .eq("id", graphId);

        await bumpSpend(db, workspaceId, totalCost);
        return {
          graphExecutionId: graphId,
          status: "waiting_hitl",
          message: `Paused at ${node.node_id} for human review.`,
        };
      };

      // === GATE 1: input guardrails ===================================
      // Masking happens before anything leaves the process. Interactions are
      // stored server-side for 55 days, so a post-filter would be too late.
      const { masked: maskedInput, matches: piiMatches } = maskPii(rawInput);

      if (piiMatches.length > 0) {
        await recordGuardrail(db, {
          workspaceId,
          graphExecutionId: graphId,
          gateLayer: "pii_leakage",
          verdict: "redacted",
          riskScore: null,
          // Record only what was masked, never the values themselves.
          sanitized: {
            node_id: node.node_id,
            masked: piiMatches.map((m) => ({ kind: m.kind, token: m.token })),
          },
        });
      }

      const injection = screenForInjection(maskedInput);
      if (injection.verdict !== "passed") {
        await recordGuardrail(db, {
          workspaceId,
          graphExecutionId: graphId,
          gateLayer: "input_jailbreak",
          verdict: injection.verdict,
          riskScore: injection.riskScore,
          snippet: maskedInput,
          sanitized: { signals: injection.signals.map((s) => s.pattern) },
        });
      }

      if (injection.verdict === "blocked") {
        await db
          .from("agent_node_executions")
          .update({
            node_status: "waiting_hitl",
            latency_ms: Date.now() - startedAt,
            output_payload: { summary: "Blocked by input guardrail." },
          })
          .eq("id", node.id);

        await recordLedger(db, {
          workspaceId,
          graphExecutionId: graphId,
          nodeExecutionId: node.id,
          agentId: node.agent_role,
          actionType: "guardrail_block",
          payload: {
            node_id: node.node_id,
            risk_score: injection.riskScore,
            signals: injection.signals.map((s) => s.pattern),
          },
        });

        return await escalate({
          reason: "injection_blocked",
          confidence: null,
          primaryCause: `Input guardrail blocked this step (risk ${injection.riskScore.toFixed(2)}).`,
          riskFactors: injection.signals.map((s) => `Injection signal: ${s.pattern}`),
          output: {},
        });
      }

      // === FinOps: semantic cache before spending on a model call =====
      // Keyed on the masked text, so the cache never stores raw PII.
      const cached = await lookupCache(db, workspaceId, maskedInput, graphId);

      let output: WorkerOutput | null;
      let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
      let cost = 0;
      let interactionId: string | null = null;
      let routingTier = tier ? ROUTING_TIER_LABEL[tier] : "model_cascade_default";

      if (cached) {
        output = cached.responsePayload as unknown as WorkerOutput;
        routingTier = "semantic_cache_hit";
        // previousInteractionId is deliberately left unchanged: there is no new
        // interaction to chain from. Continuity is preserved textually via
        // priorContext, which every node's input already carries.
        await recordGuardrail(db, {
          workspaceId,
          graphExecutionId: graphId,
          gateLayer: "semantic_cache",
          verdict: "passed",
          riskScore: null,
          sanitized: {
            node_id: node.node_id,
            similarity: cached.similarity,
            reused_model: cached.modelUsed,
          },
        });
      } else {
        const interaction = await client.interactions.create({
          model,
          ...(previousInteractionId
            ? { previous_interaction_id: previousInteractionId }
            : {}),
          input: maskedInput,
          // Interaction-scoped: must be re-sent on every turn, not set once.
          system_instruction:
            "You are a worker agent in a governed enterprise pipeline. Never fabricate data you were not given. If the objective cannot be completed from available context, say so in `summary` and report low confidence. Placeholders like [EMAIL_1] are redacted values — treat them as opaque identifiers and never guess what they contain.",
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: WORKER_SCHEMA,
          },
        });

        previousInteractionId = interaction.id;
        interactionId = interaction.id;
        usage = normalizeUsage(interaction.usage);
        cost = estimateCostUsd(model, usage.inputTokens, usage.outputTokens);
        totalCost += cost;
        output = parseJson<WorkerOutput>(interaction.output_text);
      }

      // === GATE 2: structural validation ==============================
      // response_format constrains the shape but does not guarantee it; a
      // truncated or refused response still has to be caught here.
      const structurallyValid =
        !!output &&
        typeof output.summary === "string" &&
        typeof output.confidence === "number" &&
        output.result !== undefined;

      if (!structurallyValid) {
        await recordGuardrail(db, {
          workspaceId,
          graphExecutionId: graphId,
          gateLayer: "structural_json",
          verdict: "blocked",
          riskScore: 1,
          snippet: JSON.stringify(output ?? null).slice(0, 500),
        });
      }

      const confidence =
        structurallyValid && typeof output?.confidence === "number"
          ? output.confidence
          : 0;

      await db.from("finops_token_logs").insert({
        workspace_id: workspaceId,
        graph_execution_id: graphId,
        node_execution_id: node.id,
        model_name: cached ? cached.modelUsed : model,
        prompt_tokens: usage.inputTokens,
        completion_tokens: usage.outputTokens,
        cached_tokens: usage.cachedTokens,
        estimated_cost_usd: cost,
        routing_tier: routingTier,
      });

      // === GATE 3: critic review ======================================
      // Only worth paying for when the output is otherwise committable — a node
      // already heading to a human does not need a second opinion.
      let critic: Awaited<ReturnType<typeof reviewOutput>> | null = null;
      if (structurallyValid && confidence >= CONFIDENCE_THRESHOLD && !cached) {
        critic = await reviewOutput({
          objective,
          context: priorContext.join("\n"),
          output: output?.result,
          // No retrieval layer exists yet, so the only context a worker ever
          // has is the prior steps of its own run.
          retrievalAvailable: false,
        });
        totalCost += critic.costUsd;

        await db.from("finops_token_logs").insert({
          workspace_id: workspaceId,
          graph_execution_id: graphId,
          node_execution_id: node.id,
          model_name: MODEL_TIERS.cheap,
          prompt_tokens: critic.inputTokens,
          completion_tokens: critic.outputTokens,
          estimated_cost_usd: critic.costUsd,
          routing_tier: "critic_gate",
        });

        await recordGuardrail(db, {
          workspaceId,
          graphExecutionId: graphId,
          gateLayer: "output_hallucination",
          verdict:
            critic.riskScore >= CRITIC_RISK_THRESHOLD ? "flagged" : "passed",
          riskScore: critic.riskScore,
          sanitized: {
            node_id: node.node_id,
            grounded: critic.grounded,
            concerns: critic.concerns,
            degraded: critic.degraded,
          },
        });
      }

      const criticFlagged = !!critic && critic.riskScore >= CRITIC_RISK_THRESHOLD;
      const needsHuman =
        !structurallyValid || confidence < CONFIDENCE_THRESHOLD || criticFlagged;

      await db
        .from("agent_node_executions")
        .update({
          output_payload: structurallyValid
            ? { summary: output!.summary, result: output!.result }
            : { summary: "Model returned structurally invalid output." },
          node_status: needsHuman ? "waiting_hitl" : "completed",
          latency_ms: Date.now() - startedAt,
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          cost_usd: cost,
          interaction_id: interactionId,
        })
        .eq("id", node.id);

      await recordLedger(db, {
        workspaceId,
        graphExecutionId: graphId,
        nodeExecutionId: node.id,
        agentId: node.agent_role,
        actionType: needsHuman ? "hitl_escalation" : "tool_invocation",
        payload: {
          node_id: node.node_id,
          model: cached ? cached.modelUsed : model,
          routing_tier: routingTier,
          confidence,
          critic_risk: critic?.riskScore ?? null,
          cost_usd: cost,
          interaction_id: interactionId,
        },
      });

      if (needsHuman) {
        const primaryCause = !structurallyValid
          ? "Model output failed structural validation."
          : criticFlagged
            ? `Critic flagged this output as ungrounded (risk ${critic!.riskScore.toFixed(2)}).`
            : `${node.agent_role} reported ${(confidence * 100).toFixed(0)}% confidence, below the ${CONFIDENCE_THRESHOLD * 100}% threshold.`;

        return await escalate({
          reason: !structurallyValid
            ? "unparseable_output"
            : criticFlagged
              ? "critic_flagged"
              : "low_confidence_score",
          confidence: structurallyValid ? confidence : null,
          primaryCause,
          riskFactors: [
            ...(output?.risk_factors ?? []),
            ...(critic?.concerns ?? []),
          ],
          output: structurallyValid ? (output!.result ?? {}) : {},
        });
      }

      // Committable and not from cache — worth storing for reuse.
      if (!cached && structurallyValid) {
        await storeCache(db, {
          workspaceId,
          maskedInput,
          responsePayload: output as unknown as Record<string, unknown>,
          modelUsed: model,
          graphExecutionId: graphId,
        });
      }

      priorContext.push(`- ${node.node_id}: ${output!.summary}`);
    }

    // The deliverable. Previously `final_output` held only the step summaries,
    // so a finished run's actual work product was scattered across node rows
    // with no assembled form. Built from the database, after every node has
    // been written, so a resumed run includes its pre-pause steps.
    const report = await buildRunReport(db, graphId);

    await db
      .from("agent_graph_executions")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        final_output: report ?? { steps: priorContext },
      })
      .eq("id", graphId);

    await bumpSpend(db, workspaceId, totalCost);
    return {
      graphExecutionId: graphId,
      status: "completed",
      message: `Completed. Spend this run: $${reportedCost().toFixed(6)}.`,
    };
  } catch (err) {
    await bumpSpend(db, workspaceId, totalCost);
    return await markFailed(
      db,
      graphId,
      err instanceof Error ? err.message : "Unknown runtime error.",
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Plans a graph, persists every node upfront, then runs it.
 *
 * Runs inline in the request — fine for the 3-6 node plans this produces, but a
 * larger graph will outlive a serverless request budget. Every step is
 * persisted as it completes, so moving this to a queue later is a change of
 * caller, not of engine.
 *
 * The caller MUST have already verified the user's membership of workspaceId:
 * this writes with the service role and has no RLS backstop.
 */
export async function launchGraph(params: {
  workspaceId: string;
  rootPrompt: string;
  userId: string;
}): Promise<RunResult> {
  const { workspaceId, rootPrompt, userId } = params;
  const db = createServiceClient();
  const client = getGenAI();

  // --- FinOps gate: refuse to start an over-budget workspace ------------
  const { data: budget } = await db
    .from("finops_budget_controls")
    .select("monthly_budget_usd, current_spend_usd, hard_stop_enabled, max_agent_loop_recursion")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  const spend = Number(budget?.current_spend_usd ?? 0);
  const cap = Number(budget?.monthly_budget_usd ?? 0);

  if ((budget?.hard_stop_enabled ?? true) && cap > 0 && spend >= cap) {
    const { data: halted } = await db
      .from("agent_graph_executions")
      .insert({
        workspace_id: workspaceId,
        orchestrator_name: "DecompositionOrchestrator",
        root_prompt: rootPrompt,
        status: "halted_finops",
        created_by: userId,
        completed_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    return {
      graphExecutionId: halted?.id ?? "",
      status: "halted_finops",
      message: `Budget exhausted: $${spend.toFixed(2)} of $${cap.toFixed(2)} used.`,
    };
  }

  const nodeBudget = Math.min(
    MAX_NODES,
    Number(budget?.max_agent_loop_recursion ?? MAX_NODES),
  );

  const { data: graph, error: graphError } = await db
    .from("agent_graph_executions")
    .insert({
      workspace_id: workspaceId,
      orchestrator_name: "DecompositionOrchestrator",
      framework_type: "interactions_api",
      root_prompt: rootPrompt,
      status: "running",
      created_by: userId,
    })
    .select("id, workspace_id, root_interaction_id")
    .single();

  if (graphError || !graph) {
    throw new Error(`Could not create execution: ${graphError?.message}`);
  }

  const graphId = graph.id as string;

  // === GATE 1 on the root prompt ======================================
  // This is the one piece of genuinely user-supplied text in the pipeline, so
  // it is screened before it reaches the planner.
  const { masked: maskedRoot, matches: rootPii } = maskPii(rootPrompt);

  if (rootPii.length > 0) {
    await recordGuardrail(db, {
      workspaceId,
      graphExecutionId: graphId,
      gateLayer: "pii_leakage",
      verdict: "redacted",
      sanitized: {
        scope: "root_prompt",
        masked: rootPii.map((m) => ({ kind: m.kind, token: m.token })),
      },
    });
  }

  const rootInjection = screenForInjection(maskedRoot);
  if (rootInjection.verdict !== "passed") {
    await recordGuardrail(db, {
      workspaceId,
      graphExecutionId: graphId,
      gateLayer: "input_jailbreak",
      verdict: rootInjection.verdict,
      riskScore: rootInjection.riskScore,
      snippet: maskedRoot,
      sanitized: {
        scope: "root_prompt",
        signals: rootInjection.signals.map((s) => s.pattern),
      },
    });
  }

  if (rootInjection.verdict === "blocked") {
    await recordLedger(db, {
      workspaceId,
      graphExecutionId: graphId,
      agentId: "InputGuardrail",
      actionType: "guardrail_block",
      payload: {
        scope: "root_prompt",
        risk_score: rootInjection.riskScore,
        signals: rootInjection.signals.map((s) => s.pattern),
      },
    });

    return await markFailed(
      db,
      graphId,
      `Blocked by input guardrail (risk ${rootInjection.riskScore.toFixed(2)}): ${rootInjection.signals.map((s) => s.pattern).join(", ")}.`,
    );
  }

  try {
    const planInteraction = await client.interactions.create({
      model: MODEL_TIERS.cheap,
      input: `Decompose this enterprise task into at most ${nodeBudget} DAG steps:\n\n${maskedRoot}`,
      system_instruction:
        "You are a decomposition orchestrator for an enterprise multi-agent platform. Produce the smallest plan that fully covers the task, and assign the cheapest tier that can do each step.",
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: PLAN_SCHEMA,
      },
    });

    const planUsage = normalizeUsage(planInteraction.usage);
    const planCost = estimateCostUsd(
      MODEL_TIERS.cheap,
      planUsage.inputTokens,
      planUsage.outputTokens,
    );

    await db.from("finops_token_logs").insert({
      workspace_id: workspaceId,
      graph_execution_id: graphId,
      model_name: MODEL_TIERS.cheap,
      prompt_tokens: planUsage.inputTokens,
      completion_tokens: planUsage.outputTokens,
      cached_tokens: planUsage.cachedTokens,
      estimated_cost_usd: planCost,
      routing_tier: ROUTING_TIER_LABEL.cheap,
    });
    await bumpSpend(db, workspaceId, planCost);

    // Storing the planning interaction id is what lets the first worker inherit
    // the plan's context, and what a resume falls back to.
    await db
      .from("agent_graph_executions")
      .update({ root_interaction_id: planInteraction.id })
      .eq("id", graphId);

    const plan = parseJson<{ steps: PlannedStep[] }>(planInteraction.output_text);
    const steps = (plan?.steps ?? [])
      .filter((s) => s?.node_id && s?.agent_role)
      .slice(0, nodeBudget)
      .map((s) => ({
        ...s,
        depends_on: Array.isArray(s.depends_on) ? s.depends_on : [],
        tier: isModelTier(s.tier) ? s.tier : ("default" as ModelTier),
      }));

    if (steps.length === 0) {
      return await markFailed(db, graphId, "Decomposition produced no usable steps.");
    }

    await recordLedger(db, {
      workspaceId,
      graphExecutionId: graphId,
      agentId: "DecompositionOrchestrator",
      actionType: "delegation",
      payload: {
        plan: steps.map((s) => s.node_id),
        interaction_id: planInteraction.id,
      },
    });

    // Persist the whole plan before running any of it, so the DAG visualizer
    // shows the full graph immediately and a resume has nodes to pick up.
    const ordered = topoSort(steps);
    const { error: insertError } = await db.from("agent_node_executions").insert(
      ordered.map((step) => ({
        graph_execution_id: graphId,
        workspace_id: workspaceId,
        node_id: step.node_id,
        agent_role: step.agent_role,
        model_routing_used: MODEL_TIERS[step.tier],
        input_payload: { objective: step.objective },
        node_status: "pending",
        depends_on: step.depends_on,
      })),
    );

    if (insertError) {
      return await markFailed(db, graphId, `Could not persist plan: ${insertError.message}`);
    }

    return await executePending(
      db,
      {
        id: graphId,
        workspace_id: workspaceId,
        root_interaction_id: planInteraction.id,
      },
      planCost,
    );
  } catch (err) {
    return await markFailed(
      db,
      graphId,
      err instanceof Error ? err.message : "Planning failed.",
    );
  }
}

/**
 * Resumes a graph after a human resolved its gate.
 *
 * Approving commits the (possibly overridden) payload as the gated node's
 * output and continues; rejecting ends the run. Called by the HITL server
 * action once the gate row is already updated.
 */
export async function resumeGraph(graphExecutionId: string): Promise<RunResult> {
  const db = createServiceClient();

  const { data: graph } = await db
    .from("agent_graph_executions")
    .select("id, workspace_id, root_interaction_id, status")
    .eq("id", graphExecutionId)
    .maybeSingle();

  if (!graph) {
    return {
      graphExecutionId,
      status: "failed",
      message: "Execution not found.",
    };
  }

  const { data: gate } = await db
    .from("hitl_approval_gates")
    .select("id, status, node_execution_id, output_payload, human_feedback")
    .eq("graph_execution_id", graphExecutionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!gate || gate.status === "pending") {
    return {
      graphExecutionId,
      status: "waiting_hitl",
      message: "Still awaiting human decision.",
    };
  }

  if (gate.status === "rejected") {
    await db
      .from("agent_graph_executions")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", graphExecutionId);

    if (gate.node_execution_id) {
      await db
        .from("agent_node_executions")
        .update({ node_status: "failed" })
        .eq("id", gate.node_execution_id);
    }

    await recordLedger(db, {
      workspaceId: graph.workspace_id,
      graphExecutionId,
      nodeExecutionId: gate.node_execution_id,
      agentId: "HumanReviewer",
      actionType: "hitl_rejection",
      payload: { gate_id: gate.id, feedback: gate.human_feedback ?? null },
    });

    return {
      graphExecutionId,
      status: "failed",
      message: "Run terminated by human rejection.",
    };
  }

  if (gate.status !== "approved") {
    return {
      graphExecutionId,
      status: "waiting_hitl",
      message: `Gate is ${gate.status}; not resuming.`,
    };
  }

  // Commit the human-approved payload as the node's output. If the reviewer
  // overrode it, that override is what downstream nodes now build on.
  if (gate.node_execution_id) {
    await db
      .from("agent_node_executions")
      .update({
        node_status: "completed",
        output_payload: {
          summary: "Approved by human reviewer.",
          result: gate.output_payload ?? {},
        },
      })
      .eq("id", gate.node_execution_id);
  }

  await recordLedger(db, {
    workspaceId: graph.workspace_id,
    graphExecutionId,
    nodeExecutionId: gate.node_execution_id,
    agentId: "HumanReviewer",
    actionType: "hitl_approval",
    payload: { gate_id: gate.id, feedback: gate.human_feedback ?? null },
  });

  await db
    .from("agent_graph_executions")
    .update({ status: "running" })
    .eq("id", graphExecutionId);

  return await executePending(db, {
    id: graph.id,
    workspace_id: graph.workspace_id,
    root_interaction_id: graph.root_interaction_id,
  });
}
