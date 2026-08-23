import "server-only";

import { MODEL_TIERS, estimateCostUsd, getGenAI, normalizeUsage } from "@/lib/genai/client";

/**
 * Gate 3 — critic review of a worker's output.
 *
 * A second model checks whether the output is actually grounded in the context
 * the worker was given, rather than asserted. Runs on the cheap tier: a critic
 * that costs as much as the worker doubles the bill for every node.
 *
 * The critic can only ever escalate to a human — it never approves anything the
 * worker did not already produce, so a compromised critic cannot widen access.
 */

const CRITIC_SCHEMA = {
  type: "object",
  properties: {
    grounded: {
      type: "boolean",
      description: "True if every claim is supported by the provided context.",
    },
    risk_score: {
      type: "number",
      description: "0-1 risk that this output is wrong, fabricated, or unsafe to commit.",
    },
    concerns: { type: "array", items: { type: "string" } },
  },
  required: ["grounded", "risk_score"],
};

export type CriticVerdict = {
  grounded: boolean;
  riskScore: number;
  concerns: string[];
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** True when the critic itself failed; treated as "cannot vouch". */
  degraded: boolean;
};

/** Above this the node is escalated to a human regardless of worker confidence. */
export const CRITIC_RISK_THRESHOLD = 0.6;

export async function reviewOutput(params: {
  objective: string;
  context: string;
  output: unknown;
}): Promise<CriticVerdict> {
  const client = getGenAI();
  const model = MODEL_TIERS.cheap;

  try {
    const interaction = await client.interactions.create({
      model,
      // Deliberately NOT chained to the worker's interaction: an independent
      // context is the point. Inheriting the worker's turn would let the
      // reasoning that produced a bad output also justify it.
      input: `Objective given to the worker:\n${params.objective}\n\nContext available to it:\n${params.context || "(none)"}\n\nOutput it produced:\n${JSON.stringify(params.output).slice(0, 4000)}\n\nIs every claim supported by that context?`,
      system_instruction:
        "You are a critic in an enterprise governance pipeline. Judge only whether the output is grounded in the supplied context. Treat specific figures, names, or identifiers that do not appear in the context as ungrounded. Be strict: escalating a correct answer is cheap, approving a fabricated one is not.",
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: CRITIC_SCHEMA,
      },
    });

    const usage = normalizeUsage(interaction.usage);
    const costUsd = estimateCostUsd(model, usage.inputTokens, usage.outputTokens);

    let parsed: { grounded?: boolean; risk_score?: number; concerns?: string[] } | null =
      null;
    try {
      parsed = JSON.parse(interaction.output_text ?? "");
    } catch {
      parsed = null;
    }

    if (!parsed) {
      return {
        grounded: false,
        riskScore: 1,
        concerns: ["Critic returned unparseable output."],
        costUsd,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        degraded: true,
      };
    }

    return {
      grounded: parsed.grounded === true,
      riskScore:
        typeof parsed.risk_score === "number"
          ? Math.min(1, Math.max(0, parsed.risk_score))
          : 1,
      concerns: Array.isArray(parsed.concerns)
        ? parsed.concerns.filter((c): c is string => typeof c === "string")
        : [],
      costUsd,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      degraded: false,
    };
  } catch (err) {
    // Fail closed. If the critic cannot run, the output has not been vouched
    // for, so it routes to a human rather than committing unreviewed.
    return {
      grounded: false,
      riskScore: 1,
      concerns: [
        `Critic unavailable: ${err instanceof Error ? err.message : "unknown error"}`,
      ],
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      degraded: true,
    };
  }
}
